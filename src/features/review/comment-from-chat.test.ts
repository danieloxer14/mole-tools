import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentEvent,
	AgentTurn,
	ReviewAgent,
} from "../../ports/review-agent";
import type { ParsedFileDiff } from "../../shared/diff-parse";
import {
	appendGeneratedBody,
	buildCommentConversationMarkdown,
	markdownFence,
	runCommentFromChat,
} from "./comment-from-chat";
import type { Draft } from "./state";
import type { ChatEntry } from "./store";

const diff: ParsedFileDiff[] = [
	{
		oldPath: "src/app.ts",
		newPath: "src/app.ts",
		status: "modified",
		binary: false,
		insertions: 1,
		deletions: 0,
		hunks: [
			{
				header: "@@ -1 +1,2 @@",
				oldStart: 1,
				oldLines: 1,
				newStart: 1,
				newLines: 2,
				lines: [
					{ kind: "context", oldLine: 1, newLine: 1, text: "const a = 1;" },
					{ kind: "add", oldLine: null, newLine: 2, text: "const b = 2;" },
				],
			},
		],
	},
];

const lineDraft: Draft = {
	id: "draft-1",
	body: "Existing comment",
	selection: { path: "src/app.ts", side: "new", startLine: 2, endLine: 2 },
	filePath: "src/app.ts",
	status: "draft",
	error: null,
	postedDiscussionId: null,
	staleSince: null,
};

const entries: ChatEntry[] = [
	{
		role: "user",
		text: "Why?",
		tags: [
			{ path: "src/app.ts", side: "new", startLine: 2, endLine: 2, hunk: "h" },
			{ kind: "markdown", path: "README.md", startLine: 3, endLine: 4 },
			{ kind: "file", path: "src/lib.ts" },
		],
		at: "2026-01-01T00:00:00.000Z",
		sessionId: null,
		partial: false,
	},
	{
		role: "assistant",
		text: "It needs validation.",
		tags: [],
		at: "2026-01-01T00:00:01.000Z",
		sessionId: null,
		partial: true,
	},
];

class OutputAgent implements ReviewAgent {
	constructor(
		private readonly output: string | null,
		private readonly event?: AgentEvent,
	) {}

	async preflight(): Promise<void> {}

	async *run(turn: AgentTurn): AsyncIterable<AgentEvent> {
		if (this.output !== null) {
			await Bun.write(join(turn.writeDir ?? ".", "comment.md"), this.output);
		}
		if (this.event) yield this.event;
	}
}

class HangingAgent implements ReviewAgent {
	async preflight(): Promise<void> {}

	async *run(turn: AgentTurn): AsyncIterable<AgentEvent> {
		await new Promise<void>((resolve) => {
			if (turn.signal?.aborted) resolve();
			else
				turn.signal?.addEventListener("abort", () => resolve(), { once: true });
		});
	}
}

function draftRun(
	overrides: Partial<Parameters<typeof runCommentFromChat>[0]> = {},
) {
	return {
		agent: new OutputAgent("generated\n"),
		worktreePath: "/tmp/worktree",
		runDir: join(tmpdir(), `mole-comment-test-${crypto.randomUUID()}`),
		promptText: "Prompt",
		conversationMarkdown: "Conversation",
		timeoutMs: 1_000,
		signal: new AbortController().signal,
		...overrides,
	};
}

describe("comment from chat", () => {
	test("conversation markdown renders line anchor, existing text, tags and interrupted marker", () => {
		expect(
			buildCommentConversationMarkdown({
				draft: lineDraft,
				chatLabel: "Review chat",
				entries,
				diffs: [diff],
			}),
		).toBe(
			"# Comment anchor\n\n" +
				"File: `src/app.ts`\n" +
				"Lines: 2 (new side)\n\n" +
				"## Diff excerpt\n\n" +
				"```text\n" +
				"  1\t1\t const a = 1;\n" +
				"> \t2\t+const b = 2;\n" +
				"```\n\n" +
				"## Existing comment text\n\n" +
				"```text\nExisting comment\n```\n\n" +
				"# Conversation: Review chat\n\n" +
				"## User (2026-01-01T00:00:00.000Z)\n\n" +
				"Context: `src/app.ts` new 2; `README.md` lines 3-4 (Markdown); `src/lib.ts` (whole file)\n\n" +
				"Why?\n\n" +
				"## Assistant (2026-01-01T00:00:01.000Z)\n\n" +
				"It needs validation.\n\n_(interrupted)_",
		);
	});

	test("markdown anchor renders quoted lines", () => {
		const draft: Draft = {
			...lineDraft,
			body: "",
			selection: {
				kind: "markdown",
				path: "README.md",
				startLine: 3,
				endLine: 4,
				quote: "one\ntwo",
			},
			filePath: "README.md",
		};
		expect(
			buildCommentConversationMarkdown({
				draft,
				chatLabel: "New chat 2",
				entries: [],
				diffs: [],
			}),
		).toBe(
			"# Comment anchor\n\nFile: `README.md`\nLines: 3-4 (rendered Markdown block)\n\n## Quoted Markdown\n\n> one\n> two\n\n# Conversation: New chat 2",
		);
	});

	test("fence grows past backticks in content", () => {
		expect(markdownFence("a```b")).toBe("````");
		expect(markdownFence("plain")).toBe("```");
	});

	test("appendGeneratedBody replaces blank and appends with one blank line", () => {
		expect(appendGeneratedBody(" \n\t", "generated")).toBe("generated");
		expect(appendGeneratedBody("old \n\n", "generated")).toBe(
			"old\n\ngenerated",
		);
	});

	test("run returns trimmed output file text and deletes the run dir", async () => {
		const run = draftRun();
		const result = await runCommentFromChat(run);
		expect(result).toEqual({ status: "ok", text: "generated" });
		expect(await Bun.file(run.runDir).exists()).toBe(false);
	});

	test("run fails when output missing", async () => {
		const result = await runCommentFromChat(
			draftRun({ agent: new OutputAgent(null) }),
		);
		expect(result).toEqual({
			status: "failed",
			error: "Agent returned no comment text",
		});
	});

	test("run reports agent error", async () => {
		const result = await runCommentFromChat(
			draftRun({
				agent: new OutputAgent(null, {
					kind: "error",
					message: "agent failed",
				}),
			}),
		);
		expect(result).toEqual({ status: "failed", error: "agent failed" });
	});

	test("run times out", async () => {
		const result = await runCommentFromChat(
			draftRun({ agent: new HangingAgent(), timeoutMs: 20 }),
		);
		expect(result).toEqual({
			status: "failed",
			error: "Comment generation timed out after 0.02 seconds",
		});
	});

	test("run returns stopped on external abort and deletes the run dir", async () => {
		const controller = new AbortController();
		const run = draftRun({
			agent: new HangingAgent(),
			signal: controller.signal,
		});
		const pending = runCommentFromChat(run);
		controller.abort();
		expect(await pending).toEqual({ status: "stopped" });
		expect(await Bun.file(run.runDir).exists()).toBe(false);
	});
});

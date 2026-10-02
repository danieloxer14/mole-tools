import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentEvent,
	AgentTurn,
	ReviewAgent,
} from "../../ports/review-agent";
import type { ParsedFileDiff } from "../../shared/diff-parse";
import {
	generateImportance,
	ImportanceDocSchema,
	ImportanceResultSchema,
	ImportanceSpanSchema,
	readImportanceResult,
	renderImportanceInput,
	writeImportanceResult,
} from "./importance";
import { ReviewStateSchema } from "./state";

let tempDir: string;

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "mole-review-importance-"));
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

const appDiff: ParsedFileDiff = {
	oldPath: "src/app.ts",
	newPath: "src/app.ts",
	status: "modified",
	binary: false,
	insertions: 1,
	deletions: 1,
	hunks: [
		{
			header: "@@ -1,2 +1,2 @@",
			oldStart: 1,
			oldLines: 2,
			newStart: 1,
			newLines: 2,
			lines: [
				{ kind: "context", oldLine: 1, newLine: 1, text: "before" },
				{ kind: "del", oldLine: 2, newLine: null, text: "removed" },
				{ kind: "add", oldLine: null, newLine: 2, text: "added" },
			],
		},
	],
};

function reviewState() {
	return ReviewStateSchema.parse({
		version: 1,
		mode: "code",
		mr: {
			host: "gitlab.example.com",
			projectPath: "group/project",
			iid: 42,
			webUrl: "https://gitlab.example.com/group/project/-/merge_requests/42",
			title: "Review importance",
			description: "",
			sourceBranch: "feature",
			targetBranch: "main",
		},
		revision: {
			headSha: "head",
			mergeBaseSha: "base",
			diffRefs: { baseSha: "base", startSha: "base", headSha: "head" },
			syncedAt: "2026-01-01T00:00:00.000Z",
		},
		showWhitespaceChanges: false,
		worktreePath: join(tempDir, "worktree"),
		repoRoot: tempDir,
		layerStatus: "pending",
		layerError: null,
		layers: [],
		viewedFiles: [],
		collapsedDiscussionIds: [],
		chats: [],
		activeChatId: null,
		drafts: [],
	});
}

class OutputAgent implements ReviewAgent {
	readonly turns: AgentTurn[] = [];
	private outputIndex = 0;

	constructor(private readonly outputs: (object | string)[]) {}

	async preflight(): Promise<void> {}

	async *run(turn: AgentTurn): AsyncIterable<AgentEvent> {
		this.turns.push(turn);
		const output =
			this.outputs[Math.min(this.outputIndex++, this.outputs.length - 1)];
		const outputPath = turn.message.match(/Output file: ([^\n]+)/)?.[1];
		if (outputPath)
			await Bun.write(
				outputPath,
				typeof output === "string" ? output : JSON.stringify(output),
			);
		yield { kind: "turn_end" };
	}
}

function generationOptions(agent: ReviewAgent) {
	return {
		agent,
		state: reviewState(),
		parsedDiff: [appDiff],
		dir: tempDir,
		promptText: "Score changed lines.",
		runId: "run-1",
	};
}

const validDoc = {
	version: 1,
	files: [
		{
			path: "src/app.ts",
			spans: [
				{
					side: "new",
					startLine: 2,
					endLine: 2,
					score: 4,
					reason: "This changes request validation behavior.",
				},
			],
		},
	],
};

describe("review importance", () => {
	test("validates spans and normalizes supported output aliases", () => {
		expect(
			ImportanceSpanSchema.safeParse(validDoc.files[0]?.spans[0]).success,
		).toBe(true);
		expect(
			ImportanceSpanSchema.safeParse({
				...validDoc.files[0]?.spans[0],
				score: 6,
			}).success,
		).toBe(false);
		expect(
			ImportanceSpanSchema.safeParse({
				...validDoc.files[0]?.spans[0],
				reason: "  ",
			}).success,
		).toBe(false);
		expect(
			ImportanceDocSchema.parse({
				files: {
					"src/app.ts": {
						spans: [
							{
								side: "added",
								start_line: "2",
								line: "2",
								score: 4,
								rationale: "A useful reason.",
							},
						],
					},
				},
			}),
		).toEqual({
			version: 1,
			files: [
				{
					path: "src/app.ts",
					spans: [
						{
							side: "new",
							startLine: 2,
							endLine: 2,
							score: 4,
							reason: "A useful reason.",
						},
					],
				},
			],
		});
	});

	test("renders the diff, retries invalid output, and clips spans to changed coordinates", async () => {
		const rendered = renderImportanceInput({
			title: "Review",
			mergeBaseSha: "base",
			headSha: "head",
			files: [appDiff],
		});
		expect(rendered).toContain("## src/app.ts (modified)");
		expect(rendered).toContain("@@ -1,2 +1,2 @@");
		const agent = new OutputAgent([
			"not JSON",
			{
				...validDoc,
				files: [
					{
						path: "src/app.ts",
						spans: [
							{
								side: "new",
								startLine: 1,
								endLine: 99,
								score: 4,
								reason: "This change affects request handling.",
							},
							{
								side: "old",
								startLine: 2,
								endLine: 2,
								score: 3,
								reason: "This removes old validation behavior.",
							},
						],
					},
					{ path: "outside.ts", spans: [] },
				],
			},
		]);
		const result = await generateImportance(generationOptions(agent));
		expect(result.status).toBe("ready");
		expect(result.attempts).toBe(2);
		expect(result.files).toEqual([
			{
				path: "src/app.ts",
				spans: [
					{
						side: "new",
						startLine: 1,
						endLine: 2,
						score: 4,
						reason: "This change affects request handling.",
					},
					{
						side: "old",
						startLine: 2,
						endLine: 2,
						score: 3,
						reason: "This removes old validation behavior.",
					},
				],
			},
		]);
		expect(agent.turns).toHaveLength(2);
		expect(agent.turns[1]?.message).toContain(
			"Previous output validation failed",
		);
	});

	test("persists validated snapshots atomically and treats invalid cached data as absent", async () => {
		const result = {
			version: 1 as const,
			revision: { headSha: "head", mergeBaseSha: "base" },
			status: "ready" as const,
			error: null,
			files: validDoc.files,
			generatedAt: "2026-01-01T00:00:00.000Z",
		};
		expect(ImportanceResultSchema.safeParse(result).success).toBe(true);
		const path = join(tempDir, "importance", "importance.json");
		expect(await readImportanceResult(path)).toBeNull();
		await writeImportanceResult(path, result);
		expect(await readImportanceResult(path)).toEqual(result);
		await Bun.write(path, "{");
		expect(await readImportanceResult(path)).toBeNull();
	});
});

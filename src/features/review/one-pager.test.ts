import { describe, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentEvent,
	AgentTurn,
	ReviewAgent,
} from "../../ports/review-agent";
import type { ParsedFileDiff } from "../../shared/diff-parse";
import {
	buildOnePagerInput,
	generateOnePager,
	type OnePagerGenerationOptions,
	onePagerLocation,
	readOnePagerDocument,
} from "./one-pager";
import type { ReviewState } from "./state";

const MISSING = Symbol("missing output");
type AgentOutput = string | typeof MISSING;

const appDiff: ParsedFileDiff = {
	oldPath: "src/app.ts",
	newPath: "src/app.ts",
	status: "modified",
	binary: false,
	insertions: 1,
	deletions: 1,
	hunks: [
		{
			header: "@@ -4,1 +4,1 @@",
			oldStart: 4,
			oldLines: 1,
			newStart: 4,
			newLines: 1,
			lines: [
				{ kind: "del", oldLine: 4, newLine: null, text: "return false;" },
				{ kind: "add", oldLine: null, newLine: 4, text: "return true;" },
			],
		},
	],
};

function makeState(worktreePath: string): ReviewState {
	return {
		version: 1,
		mode: "code",
		mr: {
			host: "gitlab.example.com",
			projectPath: "group/project",
			iid: 42,
			webUrl: "https://gitlab.example.com/group/project/-/merge_requests/42",
			title: "Add one pager generation",
			description: "Summarize the merge request for reviewers.",
			sourceBranch: "feature/one-pager",
			targetBranch: "main",
		},
		revision: {
			headSha: "head-sha",
			mergeBaseSha: "base-sha",
			diffRefs: {
				baseSha: "base-sha",
				startSha: "start-sha",
				headSha: "head-sha",
			},
			syncedAt: "2026-01-01T00:00:00.000Z",
		},
		showWhitespaceChanges: false,
		worktreePath,
		repoRoot: "/repo",
		layerStatus: "pending",
		layerError: null,
		layers: [],
		viewedFiles: [],
		collapsedDiscussionIds: [],
		chatSessionId: null,
		chats: [],
		activeChatId: null,
		activeOnePagerChatId: null,
		drafts: [],
	};
}

class WritingAgent implements ReviewAgent {
	readonly turns: AgentTurn[] = [];
	readonly systemPrompts: string[] = [];
	private outputIndex = 0;

	constructor(
		private readonly outputs: AgentOutput[],
		readonly supportsScopedWrites = false,
	) {}

	async preflight(): Promise<void> {}

	async *run(turn: AgentTurn): AsyncIterable<AgentEvent> {
		this.turns.push(turn);
		this.systemPrompts.push(await Bun.file(turn.systemPromptFile).text());
		const output = this.outputs[this.outputIndex++] ?? MISSING;
		const outputPath = turn.message.match(/absolute path: (\S+)/)?.[1];
		if (output !== MISSING) {
			if (outputPath && turn.writeDir) {
				await Bun.write(outputPath, output);
			} else {
				const split = Math.floor(output.length / 2);
				yield { kind: "text", delta: output.slice(0, split) };
				yield { kind: "text", delta: output.slice(split) };
			}
		}
		yield { kind: "turn_end" };
	}
}

function generationOptions(
	dir: string,
	agent: ReviewAgent,
	extra: Partial<OnePagerGenerationOptions> = {},
): OnePagerGenerationOptions {
	return {
		agent,
		state: makeState(join(dir, "worktree")),
		parsedDiff: [appDiff],
		dir,
		promptText: "Write a reviewer-facing summary.",
		runId: "run-1",
		...extra,
	};
}

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), "mole-review-one-pager-"));
	try {
		return await run(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

describe("review one pager", () => {
	test("builds MR metadata with bounded before-and-after hunk evidence", () => {
		const state = makeState("/repo/worktree");
		const renamedDiff: ParsedFileDiff = {
			...appDiff,
			oldPath: "src/old.ts",
			newPath: "src/new.ts",
			status: "renamed",
		};
		const pathlessDiff: ParsedFileDiff = {
			...appDiff,
			oldPath: null,
			newPath: null,
		};

		const input = JSON.parse(
			buildOnePagerInput(state, [renamedDiff, pathlessDiff]),
		);
		expect(input.mr).toEqual({
			title: "Add one pager generation",
			description: "Summarize the merge request for reviewers.",
			webUrl: "https://gitlab.example.com/group/project/-/merge_requests/42",
			sourceBranch: "feature/one-pager",
			targetBranch: "main",
			headSha: "head-sha",
			mergeBaseSha: "base-sha",
		});
		expect(input.files).toEqual([
			{
				path: "src/new.ts",
				status: "renamed",
				insertions: 1,
				deletions: 1,
				binary: false,
				hunks: [
					{
						header: "@@ -4,1 +4,1 @@",
						oldStart: 4,
						oldLines: 1,
						newStart: 4,
						newLines: 1,
						lines: [
							{ kind: "del", oldLine: 4, newLine: null, text: "return false;" },
							{ kind: "add", oldLine: null, newLine: 4, text: "return true;" },
						],
					},
				],
			},
		]);
	});

	test("bounds serialized metadata and file rows under the total input limit", () => {
		const state = makeState("/repo/worktree");
		state.mr.title = "title ".repeat(5_000);
		state.mr.description = "description ".repeat(20_000);
		state.mr.webUrl = `https://example.test/${"url".repeat(2_000)}`;
		state.mr.sourceBranch = "source-branch-".repeat(1_000);
		state.mr.targetBranch = "target-branch-".repeat(1_000);
		state.revision.headSha = "head-sha-".repeat(1_000);
		state.revision.mergeBaseSha = "base-sha-".repeat(1_000);
		const files = Array.from({ length: 32 }, (_, index) => ({
			...appDiff,
			oldPath: null,
			newPath: `src/${"界".repeat(2_000)}/${index}.ts`,
			insertions: index,
			deletions: 0,
			hunks: [],
		}));
		const serialized = buildOnePagerInput(state, files);
		const input = JSON.parse(serialized);

		expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(
			64 * 1024,
		);
		for (const [value, limit] of [
			[input.mr.title, 2_048],
			[input.mr.description, 8_192],
			[input.mr.webUrl, 2_048],
			[input.mr.sourceBranch, 1_024],
			[input.mr.targetBranch, 1_024],
			[input.mr.headSha, 512],
			[input.mr.mergeBaseSha, 512],
		] as const) {
			expect(
				new TextEncoder().encode(JSON.stringify(value)).byteLength,
			).toBeLessThanOrEqual(limit);
		}
		expect(input.descriptionTruncated).toBe(true);
		expect(typeof input.descriptionTruncationMarker).toBe("string");
		expect(input.metadataTruncated).toBe(true);
		expect(typeof input.metadataTruncationMarker).toBe("string");
		expect(input.filesTruncated).toBe(true);
		expect(typeof input.filesTruncationMarker).toBe("string");
		expect(input.omittedFileCount).toBe(files.length - input.files.length);
		expect(input.omittedFileCount).toBeGreaterThan(0);
		expect(input.files[0].status).toBe("modified");
		expect(
			new TextEncoder().encode(input.files[0].path).byteLength,
		).toBeLessThanOrEqual(4_096);
	});

	test("fails clearly when bounded MR metadata cannot fit", () => {
		expect(() =>
			buildOnePagerInput(makeState("/repo/worktree"), [], 64),
		).toThrow(
			"One-pager MR metadata cannot fit within the 64-byte input limit",
		);
	});

	test("shrinks MR description to fit the remaining input budget", () => {
		const state = makeState("/repo/worktree");
		state.mr.description = "large description ".repeat(10_000);
		const inputText = buildOnePagerInput(state, [], 4_096);
		const input = JSON.parse(inputText);

		expect(new TextEncoder().encode(inputText).byteLength).toBeLessThanOrEqual(
			4_096,
		);
		expect(input.descriptionTruncated).toBe(true);
		expect(input.mr.description.length).toBeLessThan(8_192);
	});

	test("bounds oversized hunk evidence and marks omitted content explicitly", () => {
		const oversized: ParsedFileDiff = {
			...appDiff,
			hunks: [
				{
					header: "@@ -4,1 +4,1 @@",
					oldStart: 4,
					oldLines: 1,
					newStart: 4,
					newLines: 1,
					lines: Array.from({ length: 15 }, (_, index) => ({
						kind: "add" as const,
						oldLine: null,
						newLine: index + 1,
						text: "🍉".repeat(index === 14 ? 2_000 : 175),
					})),
				},
			],
		};
		const oversizedFiles = Array.from({ length: 7 }, (_, index) => ({
			...oversized,
			oldPath: `src/large-${index}.ts`,
			newPath: `src/large-${index}.ts`,
		}));
		const input = JSON.parse(
			buildOnePagerInput(makeState("/repo/worktree"), oversizedFiles),
		);
		const [file] = input.files;
		const totalHunkBytes = input.files.reduce(
			(total: number, entry: { hunks: unknown[] }) =>
				total +
				new TextEncoder().encode(JSON.stringify(entry.hunks)).byteLength,
			0,
		);

		expect(totalHunkBytes).toBeLessThanOrEqual(48_000);
		expect(
			input.files.every(
				(entry: { hunks: unknown[] }) =>
					new TextEncoder().encode(JSON.stringify(entry.hunks)).byteLength <=
					12_000,
			),
		).toBe(true);
		expect(
			input.files.some(
				(entry: { diffTruncated?: boolean }) => entry.diffTruncated,
			),
		).toBe(true);
		expect(file.diffTruncated).toBe(true);
		expect(input.diffTruncated).toBe(true);
		expect(typeof input.diffTruncationMarker).toBe("string");
		expect(
			file.hunks[0].lines.every(
				(line: { text: string }) =>
					new TextEncoder().encode(line.text).byteLength <= 1_024,
			),
		).toBe(true);
	});

	test("keeps later diff evidence after truncating an overlong line", () => {
		const withLongLine: ParsedFileDiff = {
			...appDiff,
			hunks: [
				{
					header: "@@ -4,2 +4,2 @@",
					oldStart: 4,
					oldLines: 2,
					newStart: 4,
					newLines: 2,
					lines: [
						{
							kind: "add",
							oldLine: null,
							newLine: 4,
							text: "x".repeat(2_000),
						},
						{
							kind: "add",
							oldLine: null,
							newLine: 5,
							text: "later line",
						},
					],
				},
				{
					header: "@@ -20,1 +20,1 @@",
					oldStart: 20,
					oldLines: 1,
					newStart: 20,
					newLines: 1,
					lines: [
						{ kind: "add", oldLine: null, newLine: 20, text: "second hunk" },
					],
				},
			],
		};
		const input = JSON.parse(
			buildOnePagerInput(makeState("/repo/worktree"), [withLongLine]),
		);
		const [file] = input.files;

		expect(file.hunks[0].lines).toEqual([
			{
				kind: "add",
				oldLine: null,
				newLine: 4,
				text: "x".repeat(1_024),
				textTruncated: true,
			},
			{
				kind: "add",
				oldLine: null,
				newLine: 5,
				text: "later line",
			},
		]);
		expect(file.hunks[1].lines[0].text).toBe("second hunk");
		expect(file.diffTruncated).toBe(true);
		expect(typeof file.truncationMarker).toBe("string");
		expect(input.diffTruncated).toBe(true);
		expect(typeof input.diffTruncationMarker).toBe("string");
	});

	test("preserves binary and stat-only file metadata without unsafe diff content", () => {
		const binary: ParsedFileDiff = {
			...appDiff,
			oldPath: "assets/old.png",
			newPath: "assets/new.png",
			status: "renamed",
			binary: true,
			insertions: 0,
			deletions: 0,
			hunks: [],
		};
		const statOnly: ParsedFileDiff = {
			...appDiff,
			oldPath: "src/empty.ts",
			newPath: "src/empty.ts",
			insertions: 3,
			deletions: 2,
			hunks: [],
		};
		const { files } = JSON.parse(
			buildOnePagerInput(makeState("/repo/worktree"), [binary, statOnly]),
		);

		expect(files).toEqual([
			{
				path: "assets/new.png",
				status: "renamed",
				insertions: 0,
				deletions: 0,
				binary: true,
				hunks: [],
			},
			{
				path: "src/empty.ts",
				status: "modified",
				insertions: 3,
				deletions: 2,
				binary: false,
				hunks: [],
			},
		]);
	});

	test("writes scoped Markdown in the run directory and commits the document", async () => {
		await withTempDir(async (dir) => {
			const markdown = "# Summary\n\nThe MR adds reviewer context.\n";
			const agent = new WritingAgent([markdown], true);
			const options = generationOptions(dir, agent, {
				promptSourceDir: join(dir, "prompts"),
				promptText: undefined,
			});
			const location = onePagerLocation(dir);
			const runDir = join(location.runsDir, "run-1");

			expect(await generateOnePager(options)).toEqual({
				status: "ready",
				markdown,
			});
			expect(await Bun.file(location.documentPath).text()).toBe(markdown);
			expect(await readdir(location.runsDir)).toEqual([]);
			expect(agent.turns).toHaveLength(1);
			expect(agent.turns[0]?.writeDir).toBe(runDir);
			expect(agent.turns[0]?.writeScope).toBe("directory");
			expect(agent.turns[0]?.cwd).toBe(options.state.worktreePath);
			expect(agent.turns[0]?.writeDir).not.toBe(options.state.worktreePath);
			expect(agent.turns[0]?.message).toContain(
				`absolute path: ${join(runDir, "one-pager.md")}`,
			);
			expect(agent.turns[0]?.message).toContain("return false;");
			expect(agent.turns[0]?.message).toContain("return true;");
		});
	});

	test("rejects a custom prompt that leaves no room for bounded input", async () => {
		await withTempDir(async (dir) => {
			const agent = new WritingAgent([MISSING]);
			const result = await generateOnePager(
				generationOptions(dir, agent, {
					promptText: "p".repeat(100 * 1024),
				}),
			);

			expect(result.status).toBe("failed");
			if (result.status === "failed") {
				expect(result.error).toContain("96 KiB total prompt");
			}
			expect(agent.turns).toHaveLength(0);
		});
	});

	test("writes streamed Markdown in the host", async () => {
		await withTempDir(async (dir) => {
			const markdown = "# Generated through text events.\n";
			const agent = new WritingAgent([" \t\n", markdown]);
			const options = generationOptions(dir, agent);
			const location = onePagerLocation(dir);

			expect(await generateOnePager(options)).toEqual({
				status: "ready",
				markdown,
			});
			expect(agent.turns).toHaveLength(2);
			expect(agent.turns[0]?.writeScope).toBe("directory");
			expect(agent.turns[0]?.writeDir).toBeUndefined();
			expect(agent.turns[0]?.cwd).toBe(options.state.worktreePath);
			expect(await Bun.file(location.documentPath).text()).toBe(markdown);
		});
	});

	test("reserves retry room for a near-limit changed-file list", async () => {
		await withTempDir(async (dir) => {
			const markdown = "# Summary\n\nRetry fit.\n";
			const agent = new WritingAgent([MISSING, markdown]);
			const parsedDiff = Array.from({ length: 1_000 }, (_, index) => ({
				...appDiff,
				oldPath: null,
				newPath: `src/file-${index}-${"x".repeat(48)}.ts`,
				hunks: [],
			}));

			expect(
				await generateOnePager(generationOptions(dir, agent, { parsedDiff })),
			).toEqual({ status: "ready", markdown });
			expect(agent.turns).toHaveLength(2);
			const firstBytes = new TextEncoder().encode(
				agent.turns[0]?.message ?? "",
			).byteLength;
			const retryBytes = new TextEncoder().encode(
				agent.turns[1]?.message ?? "",
			).byteLength;
			const systemPromptBytes = new TextEncoder().encode(
				agent.systemPrompts[0] ?? "",
			).byteLength;
			expect(firstBytes).toBeGreaterThan(60 * 1024);
			expect(retryBytes).toBeLessThanOrEqual(64 * 1024);
			expect(systemPromptBytes + retryBytes).toBeLessThanOrEqual(96 * 1024);
			expect(await Bun.file(onePagerLocation(dir).documentPath).text()).toBe(
				markdown,
			);
		});
	});

	test("retries whitespace-only text and returns valid Markdown after two turns", async () => {
		await withTempDir(async (dir) => {
			const markdown = "## Summary\n\nValid on retry.\n";
			const agent = new WritingAgent([" \t\n", markdown], true);
			const location = onePagerLocation(dir);

			expect(await generateOnePager(generationOptions(dir, agent))).toEqual({
				status: "ready",
				markdown,
			});
			expect(agent.turns).toHaveLength(2);
			expect(await Bun.file(location.documentPath).text()).toBe(markdown);
		});
	});

	test("fails after two missing outputs without changing the existing document", async () => {
		await withTempDir(async (dir) => {
			const location = onePagerLocation(dir);
			const previousDocument = Buffer.from(
				"# Existing summary\r\n\r\nKeep bytes.\n",
			);
			await mkdir(location.documentDir, { recursive: true });
			await writeFile(location.documentPath, previousDocument);
			const agent = new WritingAgent([MISSING, MISSING], true);

			const result = await generateOnePager(generationOptions(dir, agent));
			expect(result.status).toBe("failed");
			if (result.status === "failed") {
				expect(result.error).toContain(
					"One pager agent did not write output file",
				);
			}
			expect(agent.turns).toHaveLength(2);
			expect(await readFile(location.documentPath)).toEqual(previousDocument);
			expect(await readdir(location.runsDir)).toEqual([]);
		});
	});

	test("returns null for missing and blank documents", async () => {
		await withTempDir(async (dir) => {
			const documentPath = onePagerLocation(dir).documentPath;
			expect(await readOnePagerDocument(documentPath)).toBeNull();

			await mkdir(onePagerLocation(dir).documentDir, { recursive: true });
			await writeFile(documentPath, " \t\r\n");
			expect(await readOnePagerDocument(documentPath)).toBeNull();
		});
	});
});

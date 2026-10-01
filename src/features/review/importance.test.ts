import { describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "../../core/logger";
import type {
	AgentEvent,
	AgentTurn,
	ReviewAgent,
} from "../../ports/review-agent";
import type { ParsedFileDiff } from "../../shared/diff-parse";
import {
	generateImportance,
	type ImportanceDoc,
	ImportanceDocSchema,
	type ImportanceGenerationOptions,
	type ImportanceResult,
	ImportanceResultSchema,
	ImportanceSpanSchema,
	importanceFilePath,
	readImportanceResult,
	renderImportanceInput,
	writeImportanceResult,
} from "./importance";
import type { ReviewState } from "./state";

const MISSING = Symbol("missing output");
type AgentOutput = string | object | typeof MISSING;

const appDiff: ParsedFileDiff = {
	oldPath: "src/app.ts",
	newPath: "src/app.ts",
	status: "modified",
	binary: false,
	insertions: 1,
	deletions: 1,
	hunks: [
		{
			header: "@@ -4,2 +4,2 @@ function sample",
			oldStart: 4,
			oldLines: 2,
			newStart: 4,
			newLines: 2,
			lines: [
				{ kind: "context", oldLine: 4, newLine: 4, text: "before" },
				{ kind: "del", oldLine: 5, newLine: null, text: "removed" },
				{ kind: "add", oldLine: null, newLine: 5, text: "added" },
			],
		},
	],
};
const statOnlyDiff: ParsedFileDiff = {
	oldPath: "docs/stats.json",
	newPath: "docs/stats.json",
	status: "modified",
	binary: false,
	insertions: 3,
	deletions: 0,
	hunks: [],
};
const binaryDiff: ParsedFileDiff = {
	oldPath: "assets/logo.png",
	newPath: "assets/logo.png",
	status: "modified",
	binary: true,
	insertions: 0,
	deletions: 0,
	hunks: [],
};

const validDoc: ImportanceDoc = {
	version: 1,
	files: [
		{
			path: "src/app.ts",
			spans: [
				{
					side: "new",
					startLine: 5,
					endLine: 5,
					score: 3,
					reason: "This changes request validation behavior.",
				},
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
			title: "Add importance scoring",
			description: "",
			sourceBranch: "feature/importance",
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
	readonly prompts: string[] = [];
	private outputIndex = 0;

	constructor(
		private readonly outputs: AgentOutput[],
		private readonly errorEvent?: string,
		private readonly thrown?: Error,
	) {}

	async preflight(): Promise<void> {}

	async *run(turn: AgentTurn): AsyncIterable<AgentEvent> {
		this.turns.push(turn);
		this.prompts.push(await Bun.file(turn.systemPromptFile).text());
		if (this.thrown) throw this.thrown;
		const output =
			this.outputs[Math.min(this.outputIndex++, this.outputs.length - 1)];
		const match = turn.message.match(/Output file: ([^\n]+)/);
		if (output !== MISSING && match?.[1]) {
			await Bun.write(
				match[1],
				typeof output === "string" ? output : JSON.stringify(output),
			);
		}
		if (this.errorEvent !== undefined) {
			yield { kind: "error", message: this.errorEvent };
		}
		yield { kind: "turn_end" };
	}
}

class HangingAgent implements ReviewAgent {
	readonly started: Promise<void>;
	private signal: AbortSignal | undefined;
	private markStarted!: () => void;

	constructor() {
		const { promise, resolve } = Promise.withResolvers<void>();
		this.started = promise;
		this.markStarted = resolve;
	}

	async preflight(): Promise<void> {}

	async *run(turn: AgentTurn): AsyncIterable<AgentEvent> {
		this.signal = turn.signal;
		this.markStarted();
		if (this.signal && !this.signal.aborted) {
			const { promise, resolve } = Promise.withResolvers<void>();
			this.signal.addEventListener("abort", resolve, { once: true });
			await promise;
		}
		yield { kind: "turn_end" };
	}
}

function generationOptions(
	dir: string,
	agent: ReviewAgent,
	extra: Partial<ImportanceGenerationOptions> = {},
): ImportanceGenerationOptions {
	return {
		agent,
		state: makeState(join(dir, "worktree")),
		parsedDiff: [appDiff],
		dir,
		promptText: "Score changed lines.",
		runId: "run-1",
		...extra,
	};
}

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), "mole-review-importance-"));
	try {
		return await run(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

describe("review importance", () => {
	test("renders fixed-width diff rows, verbatim hunk headers, and unscorable files", () => {
		const rendered = renderImportanceInput({
			title: "Update API",
			mergeBaseSha: "base-sha",
			headSha: "head-sha",
			files: [appDiff, statOnlyDiff, binaryDiff],
		});
		const lines = rendered.split("\n");

		expect(lines.slice(0, 4)).toEqual([
			"# Merge request: Update API",
			"Merge base: base-sha",
			"Head: head-sha",
			"",
		]);
		expect(lines).toContain("## src/app.ts (modified)");
		expect(lines).toContain("@@ -4,2 +4,2 @@ function sample");
		expect(lines).toContain("     4      4   before");
		expect(lines).toContain("     5        - removed");
		expect(lines).toContain("            5 + added");
		expect(lines).toContain("## docs/stats.json (modified)");
		expect(lines).toContain("## assets/logo.png (modified)");
		expect(
			lines.filter((line) => line === "(no textual diff — do not score)"),
		).toHaveLength(2);
	});

	test("importance schemas enforce score bounds, required reason rules, and ordered spans", () => {
		const span = {
			side: "new",
			startLine: 4,
			endLine: 4,
			score: 3,
			reason: "This changes request validation behavior.",
		};
		expect(ImportanceSpanSchema.safeParse(span).success).toBe(true);
		expect(
			ImportanceSpanSchema.safeParse({
				side: "new",
				startLine: 4,
				endLine: 3,
				score: 3,
				reason: span.reason,
			}).success,
		).toBe(false);
		expect(
			ImportanceSpanSchema.safeParse({
				...span,
				score: 9,
			}).success,
		).toBe(false);
		expect(
			ImportanceSpanSchema.safeParse({
				side: "new",
				startLine: 4,
				endLine: 4,
				score: 3,
			}).success,
		).toBe(false);
		expect(
			ImportanceSpanSchema.safeParse({ ...span, reason: "  \t " }).success,
		).toBe(false);
		expect(
			ImportanceSpanSchema.safeParse({ ...span, reason: "x".repeat(145) })
				.success,
		).toBe(false);
		expect(
			ImportanceSpanSchema.safeParse({
				...span,
				reason: "x".repeat(144),
			}).success,
		).toBe(true);
		expect(
			ImportanceSpanSchema.safeParse({
				...span,
				reason: "First line.\nSecond.",
			}).success,
		).toBe(false);
		expect(
			ImportanceSpanSchema.safeParse({
				...span,
				reason: "First line.\rSecond.",
			}).success,
		).toBe(false);
		expect(ImportanceDocSchema.safeParse(validDoc).success).toBe(true);
		expect(
			ImportanceResultSchema.safeParse({
				version: 1,
				revision: { headSha: "head", mergeBaseSha: "base" },
				status: "ready",
				error: null,
				files: validDoc.files,
				generatedAt: "2026-01-01T00:00:00.000Z",
			}).success,
		).toBe(true);
	});

	test("normalizes alternate importance document shapes without inventing span data", () => {
		const parsed = ImportanceDocSchema.safeParse({
			files: {
				"src/app.ts": {
					spans: [
						{
							side: "added",
							start_line: "4",
							end_line: "5",
							score: 3,
							rationale: "This changes request validation behavior.",
						},
					],
				},
			},
		});
		expect(parsed).toEqual({
			success: true,
			data: {
				version: 1,
				files: [
					{
						path: "src/app.ts",
						spans: [
							{
								side: "new",
								startLine: 4,
								endLine: 5,
								score: 3,
								reason: "This changes request validation behavior.",
							},
						],
					},
				],
			},
		});
		expect(ImportanceDocSchema.safeParse({ version: 1 }).success).toBe(false);
		expect(
			ImportanceDocSchema.safeParse({
				version: 1,
				files: [
					{
						path: "src/app.ts",
						spans: [{ side: "new", score: 3, reason: "A reason." }],
					},
				],
			}).success,
		).toBe(false);
	});

	test("importance file path falls back to old path for deletions", () => {
		expect(
			importanceFilePath({ ...appDiff, newPath: null, oldPath: "old.ts" }),
		).toBe("old.ts");
	});

	test("drops spans for binary and stat-only files without warning for known paths", async () => {
		await withTempDir(async (dir) => {
			const agent = new WritingAgent([
				{
					...validDoc,
					files: [
						...validDoc.files,
						{
							path: "docs/stats.json",
							spans: [
								{
									side: "new",
									startLine: 1,
									endLine: 1,
									score: 2,
									reason: "The change affects request validation.",
								},
							],
						},
						{
							path: "assets/logo.png",
							spans: [
								{
									side: "new",
									startLine: 1,
									endLine: 1,
									score: 5,
									reason: "Binary assets do not have scorable text.",
								},
							],
						},
						{
							path: "outside.ts",
							spans: [
								{
									side: "new",
									startLine: 1,
									endLine: 1,
									score: 4,
									reason: "This path is outside the changed files.",
								},
							],
						},
					],
				},
			]);
			const warning = spyOn(logger, "warn");
			try {
				const result = await generateImportance(
					generationOptions(dir, agent, {
						parsedDiff: [appDiff, statOnlyDiff, binaryDiff],
					}),
				);
				expect(result.status).toBe("ready");
				expect(result.files).toEqual(validDoc.files);
				expect(warning).toHaveBeenCalledTimes(1);
				expect(warning).toHaveBeenCalledWith("review.importance.unknown-file", {
					path: "outside.ts",
				});
			} finally {
				warning.mockRestore();
			}
		});
	});
	test("clips extreme coordinates into diff runs and preserves each reason", async () => {
		await withTempDir(async (dir) => {
			const separatedDiff: ParsedFileDiff = {
				...appDiff,
				hunks: [
					...appDiff.hunks,
					{
						header: "@@ -8 +9 @@",
						oldStart: 8,
						oldLines: 1,
						newStart: 9,
						newLines: 1,
						lines: [
							{
								kind: "context",
								oldLine: 8,
								newLine: 9,
								text: "after",
							},
						],
					},
				],
			};
			const reason = "This changes request validation behavior.";
			const agent = new WritingAgent([
				{
					version: 1,
					files: [
						{
							path: "src/app.ts",
							spans: [
								{
									side: "new",
									startLine: 5,
									endLine: Number.MAX_SAFE_INTEGER,
									score: 4,
									reason,
								},
								{
									side: "new",
									startLine: 100,
									endLine: 200,
									score: 5,
									reason: "This range is outside the diff.",
								},
							],
						},
					],
				},
			]);
			const result = await generateImportance(
				generationOptions(dir, agent, { parsedDiff: [separatedDiff] }),
			);

			expect(result.status).toBe("ready");
			expect(result.files).toEqual([
				{
					path: "src/app.ts",
					spans: [
						{
							side: "new",
							startLine: 5,
							endLine: 5,
							score: 4,
							reason,
						},
						{
							side: "new",
							startLine: 9,
							endLine: 9,
							score: 4,
							reason,
						},
					],
				},
			]);
		});
	});

	test("returns validated known files and warns while dropping unknown paths", async () => {
		await withTempDir(async (dir) => {
			const agent = new WritingAgent([
				{
					...validDoc,
					files: [...validDoc.files, { path: "outside.ts", spans: [] }],
				},
			]);
			const warning = spyOn(logger, "warn");
			try {
				const result = await generateImportance(generationOptions(dir, agent));
				expect(result).toEqual({
					status: "ready",
					error: null,
					files: validDoc.files,
					runId: "run-1",
					attempts: 1,
				});
				expect(warning).toHaveBeenCalledWith("review.importance.unknown-file", {
					path: "outside.ts",
				});
				expect(agent.turns[0]?.cwd).toBe(join(dir, "worktree"));
				expect(agent.turns[0]?.writeDir).toBe(join(dir, "run-1"));
				expect(agent.prompts[0]).toContain(
					"- Reply with only the output file path.",
				);
				expect(await Bun.file(join(dir, "run-1")).exists()).toBe(false);
			} finally {
				warning.mockRestore();
			}
		});
	});

	test("retries invalid JSON once with correction instructions", async () => {
		await withTempDir(async (dir) => {
			const agent = new WritingAgent(["not JSON", validDoc]);
			const result = await generateImportance(generationOptions(dir, agent));

			expect(result.status).toBe("ready");
			expect(result.attempts).toBe(2);
			expect(agent.turns).toHaveLength(2);
			expect(result.files).toEqual(validDoc.files);
			expect(await Bun.file(join(dir, "run-1")).exists()).toBe(false);
		});
	});

	test("fails after one schema correction retry", async () => {
		await withTempDir(async (dir) => {
			const invalidDoc = {
				version: 1,
				files: [
					{
						path: "src/app.ts",
						spans: [
							{
								side: "new",
								startLine: 6,
								endLine: 5,
								score: 9,
								reason: "Invalid range and score.",
							},
						],
					},
				],
			};
			const agent = new WritingAgent([invalidDoc, invalidDoc]);
			const result = await generateImportance(generationOptions(dir, agent));

			expect(result.status).toBe("failed");
			expect(result.error).toContain(
				"Importance output failed schema validation:",
			);
			expect(result.attempts).toBe(2);
			expect(agent.turns).toHaveLength(2);
			expect(await Bun.file(join(dir, "run-1")).exists()).toBe(false);
		});
	});

	test("retries missing output once and returns the second validation error", async () => {
		await withTempDir(async (dir) => {
			const agent = new WritingAgent([MISSING, MISSING]);
			const result = await generateImportance(generationOptions(dir, agent));

			expect(result.status).toBe("failed");
			expect(result.error).toContain(
				"Importance agent did not write output file:",
			);
			expect(result.attempts).toBe(2);
			expect(agent.turns).toHaveLength(2);
			expect(await Bun.file(join(dir, "run-1")).exists()).toBe(false);
		});
	});

	test("agent error events and thrown errors fail without retry", async () => {
		await withTempDir(async (dir) => {
			const eventAgent = new WritingAgent([validDoc], "agent reported failure");
			const eventResult = await generateImportance(
				generationOptions(dir, eventAgent),
			);
			expect(eventResult).toMatchObject({
				status: "failed",
				error: "agent reported failure",
				attempts: 1,
			});
			expect(eventAgent.turns).toHaveLength(1);
			expect(await Bun.file(join(dir, "run-1")).exists()).toBe(false);

			const thrownAgent = new WritingAgent(
				[validDoc],
				undefined,
				new Error("run exploded"),
			);
			const thrownResult = await generateImportance(
				generationOptions(dir, thrownAgent, { runId: "thrown-run" }),
			);
			expect(thrownResult).toMatchObject({
				status: "failed",
				error: "run exploded",
				attempts: 1,
			});
			expect(thrownAgent.turns).toHaveLength(1);
			expect(await Bun.file(join(dir, "thrown-run")).exists()).toBe(false);
		});
	});
	test("empty agent error event does not fail importance generation", async () => {
		await withTempDir(async (dir) => {
			const agent = new WritingAgent([validDoc], "");
			const result = await generateImportance(generationOptions(dir, agent));
			expect(result.status).toBe("ready");
			expect(result.files).toEqual(validDoc.files);
		});
	});

	test("times out after one agent attempt and removes run directory", async () => {
		await withTempDir(async (dir) => {
			const agent = new HangingAgent();
			const result = await generateImportance(
				generationOptions(dir, agent, {
					config: { review: { layerTimeoutSeconds: 0.05 } },
				}),
			);

			expect(result).toMatchObject({
				status: "failed",
				error: "Importance agent timed out after 0.05 seconds",
				attempts: 1,
			});
			await expect(agent.started).resolves.toBeUndefined();
			expect(await Bun.file(join(dir, "run-1")).exists()).toBe(false);
		});
	});

	test("aborted signal fails with cancellation message and no retry", async () => {
		await withTempDir(async (dir) => {
			const agent = new HangingAgent();
			const controller = new AbortController();
			const resultPromise = generateImportance(
				generationOptions(dir, agent, { signal: controller.signal }),
			);
			await agent.started;
			controller.abort();
			const result = await resultPromise;

			expect(result).toMatchObject({
				status: "failed",
				error: "Importance run was cancelled",
				attempts: 1,
			});
			expect(await Bun.file(join(dir, "run-1")).exists()).toBe(false);
		});
	});

	test("reads missing or invalid result as null and round-trips stored result", async () => {
		await withTempDir(async (dir) => {
			const resultPath = join(dir, "importance", "importance.json");
			expect(await readImportanceResult(resultPath)).toBeNull();

			const result: ImportanceResult = {
				version: 1,
				revision: { headSha: "head-sha", mergeBaseSha: "base-sha" },
				status: "ready",
				error: null,
				files: validDoc.files,
				generatedAt: "2026-01-01T00:00:00.000Z",
			};
			await writeImportanceResult(resultPath, result);
			expect(await readImportanceResult(resultPath)).toEqual(result);

			await Bun.write(resultPath, "{");
			expect(await readImportanceResult(resultPath)).toBeNull();
		});
	});
});

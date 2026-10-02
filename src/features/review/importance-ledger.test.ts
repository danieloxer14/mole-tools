import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ParsedFileDiff } from "../../shared/diff-parse";
import type { ImportanceSpan } from "./importance";
import {
	appendImportanceLedgerEntry,
	buildImportanceContestReport,
	findImportanceRunEntry,
	IMPORTANCE_LEDGER_FILE,
	type ImportanceLedgerContestEntry,
	ImportanceLedgerEntrySchema,
	type ImportanceLedgerRunEntry,
	importanceSpanExcerpt,
	readImportanceLedger,
} from "./importance-ledger";

let tempDir: string;

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "mole-importance-ledger-"));
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

function runEntry(
	overrides: Partial<ImportanceLedgerRunEntry> = {},
): ImportanceLedgerRunEntry {
	return {
		version: 1,
		kind: "run",
		runId: "run-1",
		recordedAt: "2026-01-01T00:00:00.000Z",
		revision: { headSha: "head", mergeBaseSha: "base" },
		status: "ready",
		error: null,
		attempts: 1,
		prompt: { slot: "review-importance", preset: "default", version: 1 },
		agent: null,
		systemPrompt: "Review importance",
		input: "diff input",
		messages: ["first message"],
		files: [
			{
				path: "src/app.ts",
				spans: [
					{
						side: "new",
						startLine: 5,
						endLine: 5,
						score: 3,
						reason: "Changes request validation.",
					},
				],
			},
		],
		...overrides,
	};
}

function contestEntry(
	overrides: Partial<ImportanceLedgerContestEntry> = {},
): ImportanceLedgerContestEntry {
	const before: ImportanceSpan = {
		side: "new",
		startLine: 1,
		endLine: 1,
		score: 3,
		reason: "Changes request validation.",
	};
	return {
		version: 1,
		kind: "contest",
		contestId: "contest-1",
		recordedAt: "2026-01-01T00:01:00.000Z",
		runId: "run-1",
		revision: { headSha: "head", mergeBaseSha: "base" },
		path: "src/app.ts",
		fileIndex: 0,
		spanIndex: 0,
		before,
		after: { ...before, score: 4, reason: "This is a critical change." },
		report: "Importance contest report",
		...overrides,
	};
}

function reportFile(
	lines: ParsedFileDiff["hunks"][number]["lines"],
): ParsedFileDiff {
	return {
		oldPath: "src/app.ts",
		newPath: "src/app.ts",
		status: "modified",
		binary: false,
		insertions: 0,
		deletions: 0,
		hunks: [
			{
				header: "@@",
				oldStart: 1,
				oldLines: lines.length,
				newStart: 1,
				newLines: lines.length,
				lines,
			},
		],
	};
}

describe("importance ledger", () => {
	test("appends existing records without migration and reads later records after malformed lines", async () => {
		const path = join(tempDir, IMPORTANCE_LEDGER_FILE);
		const existing = runEntry();
		const contest = contestEntry();
		await writeFile(path, `${JSON.stringify(existing)}\n{broken\n`);
		expect(await readImportanceLedger(path)).toEqual([existing]);
		await appendImportanceLedgerEntry(path, contest);
		expect(await readImportanceLedger(path)).toEqual([existing, contest]);
	});

	test("separates a torn final record and serializes concurrent appends", async () => {
		const path = join(tempDir, IMPORTANCE_LEDGER_FILE);
		const torn = '{"version":1,"kind":"run"';
		await writeFile(path, torn);
		const entries = Array.from({ length: 12 }, (_, index) =>
			runEntry({ runId: `run-${index}` }),
		);
		await Promise.all(
			entries.map((entry) => appendImportanceLedgerEntry(path, entry)),
		);
		const lines = (await Bun.file(path).text()).trimEnd().split("\n");
		expect(lines[0]).toBe(torn);
		expect(lines.slice(1)).toHaveLength(entries.length);
		const parsed = lines
			.slice(1)
			.map((line) => ImportanceLedgerEntrySchema.parse(JSON.parse(line)));
		expect(
			new Set(
				parsed
					.filter((entry) => entry.kind === "run")
					.map((entry) => entry.runId),
			).size,
		).toBe(entries.length);
		expect(await findImportanceRunEntry(path, "run-4")).toEqual(entries[4]);
	});

	test("builds contest reports from original score, prompt, agent, and bounded excerpt", () => {
		const before: ImportanceSpan = {
			side: "new",
			startLine: 2,
			endLine: 2,
			score: 3,
			reason: "Changes request validation.",
		};
		const file = reportFile([
			{
				kind: "add",
				oldLine: null,
				newLine: 2,
				text: "const allowed = validate(input);",
			},
		]);
		const report = buildImportanceContestReport({
			appVersion: "1.2.3",
			revision: { headSha: "head", mergeBaseSha: "base" },
			path: "src/app.ts",
			before,
			after: { ...before, score: 4, reason: "This deserves closer review." },
			run: runEntry({
				files: [{ path: "src/app.ts", spans: [before] }],
				agent: { agent: "claude", model: "sonnet", effort: "high" },
			}),
			runId: "run-1",
			fileIndex: 0,
			spanIndex: 0,
			file,
		});
		expect(report).toContain(
			"- Model: 3/5 (Moderate) — Changes request validation.",
		);
		expect(report).toContain(
			"- Contested: 4/5 (High) — This deserves closer review.",
		);
		expect(report).toContain("+const allowed = validate(input);");
		expect(report).toContain("### System prompt");
		expect(report).toContain(
			"- Agent: claude · model `sonnet` · effort `high`",
		);
	});

	test("keeps legacy runs distinct and extracts only matching side lines", () => {
		const span: ImportanceSpan = {
			side: "old",
			startLine: 3,
			endLine: 4,
			score: 2,
			reason: "The removed lines are low risk.",
		};
		const excerpt = importanceSpanExcerpt(
			reportFile([
				{ kind: "del", oldLine: 3, newLine: null, text: "old value" },
				{ kind: "context", oldLine: 4, newLine: 4, text: "same value" },
				{ kind: "add", oldLine: null, newLine: 4, text: "new value" },
			]),
			span,
		);
		expect(excerpt).toEqual({
			lines: ["-old value", " same value"],
			truncated: false,
		});
		const report = buildImportanceContestReport({
			appVersion: "1.2.3",
			revision: { headSha: "head", mergeBaseSha: "base" },
			path: "src/app.ts",
			before: span,
			after: { ...span, score: 3, reason: "Review the changed branch." },
			run: null,
			runId: null,
			fileIndex: 0,
			spanIndex: 0,
			file: undefined,
		});
		expect(report).toContain(
			"unavailable (scored before the importance ledger)",
		);
	});
});

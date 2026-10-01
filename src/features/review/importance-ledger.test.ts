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
	const span = {
		side: "new" as const,
		startLine: 1,
		endLine: 1,
		score: 3 as const,
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
		before: span,
		after: { ...span, score: 4, reason: "This is a critical change." },
		report: "Importance contest report",
		...overrides,
	};
}

describe("importance ledger", () => {
	test("appends entries in order and reads a missing ledger as empty", async () => {
		const path = join(tempDir, IMPORTANCE_LEDGER_FILE);
		const first = runEntry();
		const second = contestEntry();

		expect(await readImportanceLedger(path)).toEqual([]);
		await appendImportanceLedgerEntry(path, first);
		await appendImportanceLedgerEntry(path, second);

		expect(await readImportanceLedger(path)).toEqual([first, second]);
	});
	test("separates a torn final record from the next appended entry", async () => {
		const path = join(tempDir, IMPORTANCE_LEDGER_FILE);
		const partialRecord = '{"version":1,"kind":"run","runId":"torn"';
		const nextEntry = runEntry({ runId: "next" });
		await writeFile(path, partialRecord);

		await appendImportanceLedgerEntry(path, nextEntry);

		const contents = await Bun.file(path).text();
		expect(contents.split("\n")).toEqual([
			partialRecord,
			JSON.stringify(nextEntry),
			"",
		]);
		expect(await readImportanceLedger(path)).toEqual([nextEntry]);
	});

	test("skips malformed and schema-invalid lines without losing valid entries", async () => {
		const path = join(tempDir, IMPORTANCE_LEDGER_FILE);
		const first = runEntry();
		const second = contestEntry();
		await writeFile(
			path,
			[
				JSON.stringify(first),
				"{malformed json",
				JSON.stringify({ version: 1, kind: "run" }),
				JSON.stringify(second),
				"",
			].join("\n"),
		);

		expect(await readImportanceLedger(path)).toEqual([first, second]);
	});

	test("finds the last matching run entry and returns null for an unknown id", async () => {
		const path = join(tempDir, IMPORTANCE_LEDGER_FILE);
		const first = runEntry({ status: "ready" });
		const second = runEntry({ status: "failed", error: "retryable failure" });
		await appendImportanceLedgerEntry(path, first);
		await appendImportanceLedgerEntry(path, contestEntry());
		await appendImportanceLedgerEntry(path, second);

		expect(await findImportanceRunEntry(path, "run-1")).toEqual(second);
		expect(await findImportanceRunEntry(path, "unknown-run")).toBeNull();
	});

	test("serializes concurrent appends into parseable ledger lines", async () => {
		const path = join(tempDir, IMPORTANCE_LEDGER_FILE);
		const entries = Array.from({ length: 20 }, (_, index) =>
			runEntry({ runId: `run-${index}` }),
		);

		await Promise.all(
			entries.map((entry) => appendImportanceLedgerEntry(path, entry)),
		);

		const lines = (await Bun.file(path).text()).trimEnd().split("\n");
		expect(lines).toHaveLength(20);
		const parsed = lines.map((line) =>
			ImportanceLedgerEntrySchema.parse(JSON.parse(line)),
		);
		expect(new Set(parsed.map((entry) => entry.runId)).size).toBe(20);
	});
});

const reportSpan: ImportanceSpan = {
	side: "new",
	startLine: 5,
	endLine: 5,
	score: 3,
	reason: "Changes request validation.",
};

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

function reportInput(
	overrides: Partial<Parameters<typeof buildImportanceContestReport>[0]> = {},
): Parameters<typeof buildImportanceContestReport>[0] {
	return {
		appVersion: "1.2.3",
		revision: { headSha: "head", mergeBaseSha: "base" },
		path: "src/app.ts",
		before: reportSpan,
		after: { ...reportSpan, score: 4, reason: "This deserves closer review." },
		run: runEntry(),
		runId: "run-1",
		fileIndex: 0,
		spanIndex: 0,
		file: reportFile([
			{
				kind: "context",
				oldLine: 5,
				newLine: 5,
				text: "const value = 1;",
			},
		]),
		...overrides,
	};
}

describe("importance contest report", () => {
	test("shows model score and omits unchanged before-contest score", () => {
		const report = buildImportanceContestReport(reportInput());

		expect(report).toContain(
			"- Model: 3/5 (Moderate) — Changes request validation.",
		);
		expect(report).not.toContain("- Before contest:");
	});

	test("shows before-contest score when it differs from model", () => {
		const report = buildImportanceContestReport(
			reportInput({
				before: { ...reportSpan, score: 4, reason: "Updated after review." },
			}),
		);

		expect(report).toContain(
			"- Before contest: 4/5 (High) — Updated after review.",
		);
	});

	test("distinguishes legacy runs from unreadable run metadata and adapts prompt fences", () => {
		const legacy = buildImportanceContestReport(
			reportInput({ run: null, runId: null }),
		);
		expect(legacy).toContain(
			"unavailable (scored before the importance ledger)",
		);
		expect(legacy).toContain("_Prompt unavailable for this run._");

		const unavailableRun = buildImportanceContestReport(
			reportInput({ run: null, runId: "run-1" }),
		);
		expect(unavailableRun).toContain(
			"- Run: unavailable (run metadata unavailable)",
		);
		expect(unavailableRun).not.toContain(
			"unavailable (scored before the importance ledger)",
		);

		const fenced = buildImportanceContestReport(
			reportInput({ run: runEntry({ systemPrompt: "Use ``` in output." }) }),
		);
		expect(fenced).toContain("````text\nUse ``` in output.\n````");
	});

	test("extracts only old-side lines in the requested span", () => {
		const excerpt = importanceSpanExcerpt(
			reportFile([
				{ kind: "del", oldLine: 4, newLine: null, text: "removed" },
				{ kind: "context", oldLine: 5, newLine: 5, text: "same" },
				{ kind: "add", oldLine: null, newLine: 5, text: "added" },
				{ kind: "del", oldLine: 6, newLine: null, text: "outside" },
			]),
			{ ...reportSpan, side: "old", startLine: 4, endLine: 5 },
		);

		expect(excerpt).toEqual({
			lines: ["-removed", " same"],
			truncated: false,
		});
	});

	test("caps matching excerpt at 80 lines and reports truncation", () => {
		const file = reportFile(
			Array.from({ length: 81 }, (_, index) => ({
				kind: "context" as const,
				oldLine: index + 1,
				newLine: index + 1,
				text: `line ${index + 1}`,
			})),
		);
		const excerpt = importanceSpanExcerpt(file, {
			...reportSpan,
			startLine: 1,
			endLine: 81,
		});
		const report = buildImportanceContestReport(
			reportInput({
				before: { ...reportSpan, startLine: 1, endLine: 81 },
				file,
			}),
		);

		expect(excerpt.lines).toHaveLength(80);
		expect(excerpt.truncated).toBe(true);
		expect(report).toContain("_Excerpt truncated to 80 lines._");
	});

	test("reports missing code and single-line span wording", () => {
		const report = buildImportanceContestReport(
			reportInput({ file: undefined }),
		);
		expect(report).toContain("_Code excerpt unavailable._");
		expect(report).toContain("- Lines: new line 5");
	});
});

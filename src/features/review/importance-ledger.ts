import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { ParsedFileDiff } from "../../shared/diff-parse";
import { IMPORTANCE_LABELS } from "../../shared/importance-labels";
import type { ImportanceSpan } from "./importance";
import { ImportanceFileSchema, ImportanceSpanSchema } from "./importance";

const RevisionSchema = z.object({
	headSha: z.string(),
	mergeBaseSha: z.string(),
});

export const ImportanceLedgerRunEntrySchema = z.object({
	version: z.literal(1),
	kind: z.literal("run"),
	runId: z.string().min(1),
	recordedAt: z.string(),
	revision: RevisionSchema,
	status: z.enum(["ready", "failed"]),
	error: z.string().nullable(),
	attempts: z.number().int().nonnegative(),
	prompt: z.object({
		slot: z.literal("review-importance"),
		preset: z.string(),
		version: z.number().int().positive().nullable(),
	}),
	agent: z
		.object({
			agent: z.string(),
			model: z.string().nullable(),
			effort: z.string().nullable(),
		})
		.nullable(),
	systemPrompt: z.string().nullable(),
	input: z.string().nullable(),
	messages: z.array(z.string()),
	files: z.array(ImportanceFileSchema),
});
export type ImportanceLedgerRunEntry = z.infer<
	typeof ImportanceLedgerRunEntrySchema
>;

export const ImportanceLedgerContestEntrySchema = z.object({
	version: z.literal(1),
	kind: z.literal("contest"),
	contestId: z.string().min(1),
	recordedAt: z.string(),
	runId: z.string().nullable(),
	revision: RevisionSchema,
	path: z.string().min(1),
	fileIndex: z.number().int().nonnegative(),
	spanIndex: z.number().int().nonnegative(),
	before: ImportanceSpanSchema,
	after: ImportanceSpanSchema,
	report: z.string(),
});
export type ImportanceLedgerContestEntry = z.infer<
	typeof ImportanceLedgerContestEntrySchema
>;

export const ImportanceLedgerEntrySchema = z.discriminatedUnion("kind", [
	ImportanceLedgerRunEntrySchema,
	ImportanceLedgerContestEntrySchema,
]);
export type ImportanceLedgerEntry = z.infer<typeof ImportanceLedgerEntrySchema>;

export const IMPORTANCE_LEDGER_FILE = "ledger.ndjson";

const appendQueues = new Map<string, Promise<void>>();

export async function appendImportanceLedgerEntry(
	path: string,
	entry: ImportanceLedgerEntry,
): Promise<void> {
	const previous = appendQueues.get(path) ?? Promise.resolve();
	const operation = previous
		.catch(() => undefined)
		.then(async () => {
			await mkdir(dirname(path), { recursive: true });
			const file = await open(path, "a+");
			try {
				const { size } = await file.stat();
				let separator = "";
				if (size > 0) {
					const lastByte = new Uint8Array(1);
					await file.read(lastByte, 0, 1, size - 1);
					if (lastByte[0] !== 0x0a) separator = "\n";
				}
				await file.write(
					`${separator}${JSON.stringify(entry)}\n`,
					undefined,
					"utf8",
				);
			} finally {
				await file.close();
			}
		});
	appendQueues.set(path, operation);
	return operation;
}

export async function readImportanceLedger(
	path: string,
): Promise<ImportanceLedgerEntry[]> {
	const file = Bun.file(path);
	if (!(await file.exists())) return [];

	const entries: ImportanceLedgerEntry[] = [];
	for (const line of (await file.text()).split("\n")) {
		if (line.trim().length === 0) continue;

		try {
			const parsed = ImportanceLedgerEntrySchema.safeParse(JSON.parse(line));
			if (parsed.success) entries.push(parsed.data);
		} catch {
			// Ignore malformed lines so one corrupt entry cannot hide later history.
		}
	}
	return entries;
}

export async function findImportanceRunEntry(
	path: string,
	runId: string,
): Promise<ImportanceLedgerRunEntry | null> {
	const entries = await readImportanceLedger(path);
	let match: ImportanceLedgerRunEntry | null = null;
	for (const entry of entries) {
		if (entry.kind === "run" && entry.runId === runId) match = entry;
	}
	return match;
}

function markdownFence(content: string): string {
	const longestRun = Math.max(
		0,
		...(content.match(/`+/g) ?? []).map((run) => run.length),
	);
	return "`".repeat(Math.max(3, longestRun + 1));
}

export function importanceSpanExcerpt(
	file: ParsedFileDiff | undefined,
	span: ImportanceSpan,
): { lines: string[]; truncated: boolean } {
	const matching: string[] = [];
	if (!file) return { lines: matching, truncated: false };

	for (const hunk of file.hunks) {
		for (const line of hunk.lines) {
			const lineNumber = span.side === "new" ? line.newLine : line.oldLine;
			if (
				lineNumber === null ||
				lineNumber < span.startLine ||
				lineNumber > span.endLine
			) {
				continue;
			}
			matching.push(
				`${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`,
			);
		}
	}

	return {
		lines: matching.slice(0, 80),
		truncated: matching.length > 80,
	};
}

function importanceScoreText(score: ImportanceSpan["score"]): string {
	return `${score}/5 (${IMPORTANCE_LABELS[score]})`;
}

function importanceLinesText(span: ImportanceSpan): string {
	return span.startLine === span.endLine
		? `${span.side} line ${span.startLine}`
		: `${span.side} lines ${span.startLine}–${span.endLine}`;
}

export function buildImportanceContestReport(input: {
	appVersion: string;
	revision: { headSha: string; mergeBaseSha: string };
	path: string;
	before: ImportanceSpan;
	after: ImportanceSpan;
	run: ImportanceLedgerRunEntry | null;
	runId: string | null;
	fileIndex: number;
	spanIndex: number;
	file: ParsedFileDiff | undefined;
}): string {
	const {
		appVersion,
		revision,
		path,
		before,
		after,
		run,
		runId,
		fileIndex,
		spanIndex,
		file,
	} = input;
	const possibleModelSpan = run?.files[fileIndex]?.spans[spanIndex];
	const modelSpan =
		possibleModelSpan &&
		possibleModelSpan.side === before.side &&
		possibleModelSpan.startLine === before.startLine &&
		possibleModelSpan.endLine === before.endLine
			? possibleModelSpan
			: null;
	const runLine = run
		? `\`${run.runId}\` · ${run.recordedAt}`
		: runId === null
			? "unavailable (scored before the importance ledger)"
			: "unavailable (run metadata unavailable)";
	const promptLine = run
		? `\`review-importance\` preset \`${run.prompt.preset}\` ${run.prompt.version === null ? "unknown version" : `v${run.prompt.version}`}`
		: "unavailable";
	const agentLine = run
		? run.agent
			? [
					run.agent.agent,
					run.agent.model === null ? null : `model \`${run.agent.model}\``,
					run.agent.effort === null ? null : `effort \`${run.agent.effort}\``,
				]
					.filter((part) => part !== null)
					.join(" · ")
			: "default agent"
		: "unavailable";
	const excerpt = importanceSpanExcerpt(file, before);
	const excerptContent = excerpt.lines.join("\n");
	const codeSection =
		excerpt.lines.length === 0
			? "_Code excerpt unavailable._"
			: [
					`${markdownFence(excerptContent)}diff`,
					excerptContent,
					markdownFence(excerptContent),
					...(excerpt.truncated ? ["_Excerpt truncated to 80 lines._"] : []),
				].join("\n");
	const promptSection =
		run?.systemPrompt === null || !run
			? "_Prompt unavailable for this run._"
			: [
					"<details>",
					"<summary>review-importance system prompt</summary>",
					"",
					`${markdownFence(run.systemPrompt)}text`,
					run.systemPrompt,
					markdownFence(run.systemPrompt),
					"",
					"</details>",
				].join("\n");
	const scoreLines = [
		...(modelSpan
			? [
					`- Model: ${importanceScoreText(modelSpan.score)} — ${modelSpan.reason}`,
				]
			: []),
		...(!modelSpan ||
		before.score !== modelSpan.score ||
		before.reason !== modelSpan.reason
			? [
					`- Before contest: ${importanceScoreText(before.score)} — ${before.reason}`,
				]
			: []),
		`- Contested: ${importanceScoreText(after.score)} — ${after.reason}`,
	];

	return [
		"## Importance contest",
		"",
		`- mole-tools: ${appVersion}`,
		`- Revision: head \`${revision.headSha}\` · merge base \`${revision.mergeBaseSha}\``,
		`- Run: ${runLine}`,
		`- Prompt: ${promptLine}`,
		`- Agent: ${agentLine}`,
		`- File: \`${path}\``,
		`- Lines: ${importanceLinesText(before)}`,
		"",
		"### Scores",
		"",
		...scoreLines,
		"",
		"### Code",
		"",
		codeSection,
		"",
		"### System prompt",
		"",
		promptSection,
		"",
	].join("\n");
}

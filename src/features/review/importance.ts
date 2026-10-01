import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { loadPrompt } from "../../adapters/prompts/loader";
import { logger } from "../../core/logger";
import type { ReviewAgent } from "../../ports/review-agent";
import type { ParsedFileDiff } from "../../shared/diff-parse";
import {
	type AgentFileAttempt,
	agentAttemptTimeoutSeconds,
	runAgentFileAttempt,
} from "./agent-attempt";
import type { ReviewState } from "./state";

export { importanceRevisionKey } from "../../shared/importance-revision-key";

export const ImportanceScoreSchema = z.union([
	z.literal(1),
	z.literal(2),
	z.literal(3),
	z.literal(4),
	z.literal(5),
]);
export type ImportanceScore = z.infer<typeof ImportanceScoreSchema>;
export const ImportanceReasonSchema = z
	.string()
	.max(144)
	.refine((reason) => reason.trim().length > 0, {
		message: "reason must not be blank",
	})
	.refine((reason) => !/[\r\n]/.test(reason), {
		message: "reason must be a single line",
	});
export const ImportanceSpanSchema = z
	.object({
		side: z.enum(["new", "old"]),
		startLine: z.number().int().positive(),
		endLine: z.number().int().positive(),
		score: ImportanceScoreSchema,
		reason: ImportanceReasonSchema,
	})
	.refine((span) => span.endLine >= span.startLine, {
		message: "endLine must be greater than or equal to startLine",
		path: ["endLine"],
	});
export const ImportanceFileSchema = z.object({
	path: z.string().min(1),
	spans: z.array(ImportanceSpanSchema),
});

function isImportanceRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeImportanceSpanInput(value: unknown): unknown {
	if (!isImportanceRecord(value)) return value;
	const lineNumber = (line: unknown) =>
		typeof line === "string" && /^[1-9]\d*$/.test(line) ? Number(line) : line;
	return {
		...value,
		side:
			value.side === "added"
				? "new"
				: value.side === "deleted"
					? "old"
					: value.side,
		startLine: lineNumber(value.startLine ?? value.start_line ?? value.line),
		endLine: lineNumber(value.endLine ?? value.end_line ?? value.line),
		reason: value.reason ?? value.rationale ?? value.explanation,
	};
}

function normalizeImportanceFileInput(
	value: unknown,
	fallbackPath?: string,
): unknown {
	if (!isImportanceRecord(value)) return value;
	return {
		...value,
		...(value.path === undefined && fallbackPath !== undefined
			? { path: fallbackPath }
			: {}),
		spans: Array.isArray(value.spans)
			? value.spans.map(normalizeImportanceSpanInput)
			: value.spans,
	};
}

function normalizeImportanceDocInput(value: unknown): unknown {
	if (!isImportanceRecord(value)) return value;
	const files = Array.isArray(value.files)
		? value.files.map((file) => normalizeImportanceFileInput(file))
		: isImportanceRecord(value.files)
			? Object.entries(value.files).map(([path, file]) =>
					Array.isArray(file)
						? {
								path,
								spans: file.map(normalizeImportanceSpanInput),
							}
						: normalizeImportanceFileInput(file, path),
				)
			: value.files;
	return {
		...value,
		version: value.version === undefined ? 1 : value.version,
		files,
	};
}

const ImportanceDocObjectSchema = z.object({
	version: z.literal(1),
	files: z.array(ImportanceFileSchema),
});

/** Accept common JSON aliases while keeping line, score, and reason data required. */
export const ImportanceDocSchema = z.preprocess(
	normalizeImportanceDocInput,
	ImportanceDocObjectSchema,
);
export const ImportanceResultSchema = z.object({
	version: z.literal(1),
	revision: z.object({ headSha: z.string(), mergeBaseSha: z.string() }),
	status: z.enum(["ready", "failed"]),
	error: z.string().nullable(),
	files: z.array(ImportanceFileSchema),
	generatedAt: z.string(),
	runId: z.string().min(1).optional(),
});
export const ImportanceContestRequestSchema = z
	.object({
		revisionKey: z.string().min(1),
		path: z.string().min(1),
		fileIndex: z.number().int().nonnegative(),
		spanIndex: z.number().int().nonnegative(),
		expected: ImportanceSpanSchema,
		score: ImportanceScoreSchema,
		reason: z.string(),
	})
	.strict();

export type ImportanceSpan = z.infer<typeof ImportanceSpanSchema>;
export type ImportanceFile = z.infer<typeof ImportanceFileSchema>;
export type ImportanceDoc = z.infer<typeof ImportanceDocSchema>;
export type ImportanceResult = z.infer<typeof ImportanceResultSchema>;

export type ImportanceStatus = "pending" | "running" | "ready" | "failed";

export interface ImportanceSnapshot {
	revisionKey: string;
	status: ImportanceStatus;
	error: string | null;
	files: ImportanceFile[];
}
export type ImportanceContestRequest = z.input<
	typeof ImportanceContestRequestSchema
>;
export type ImportanceContestResponse = {
	snapshot: ImportanceSnapshot;
	report: string;
};

export interface ImportanceGenerationOptions {
	agent: ReviewAgent;
	state: ReviewState;
	parsedDiff: ParsedFileDiff[];
	dir: string;
	promptText?: string;
	promptPreset?: string;
	promptSourceDir?: string;
	config?: { review?: { layerTimeoutSeconds?: number } };
	runId?: string;
	signal?: AbortSignal;
}

export interface ImportanceGenerationResult {
	status: "ready" | "failed";
	error: string | null;
	files: ImportanceFile[];
	runId: string;
	attempts: number;
	systemPrompt: string | null;
	input: string | null;
	messages: string[];
}

const IMPORTANCE_OUTPUT_RULES = [
	"- Read the input file named in the message. Each changed line is shown as `<old line> <new line> <+|-| > <text>`.",
	"- Write exactly one JSON object to the output file named in the message; do not return Markdown, prose, a bare array, or an alternate wrapper.",
	'- The object must have `version: 1` and a `files` array: `{"version":1,"files":[{"path":"<path exactly as listed>","spans":[{"side":"new","startLine":1,"endLine":3,"score":4,"reason":"This changes request authorization behavior."}]}]}`.',
	"- Every file must include its exact `path` and a `spans` array. Every span must include `side` (`new` or `old`), positive integer `startLine` and `endLine`, integer `score` (1–5), and `reason`.",
	'- Use `side: "new"` with new line numbers for added and context lines; use `side: "old"` with old line numbers for deleted lines.',
	"- Every span's `reason` must be exactly one concise sentence explaining its score and hunk, with no line breaks and at most 144 characters. Never omit or invent this field.",
	"- Do not omit `version`, `files`, `path`, `spans`, `side`, `startLine`, `endLine`, `score`, or `reason`, and do not rename these fields.",
	"- Skip files marked `(no textual diff — do not score)`.",
	"- The worktree is read-only; inspect it only with read-only tools. Write only the output file.",
	"- Reply with only the output file path.",
].join("\n");

export function importanceFilePath(file: ParsedFileDiff): string {
	return file.newPath ?? file.oldPath ?? "";
}

function renderLine(
	line: ParsedFileDiff["hunks"][number]["lines"][number],
): string {
	const oldLine =
		line.oldLine === null ? "      " : String(line.oldLine).padStart(6);
	const newLine =
		line.newLine === null ? "      " : String(line.newLine).padStart(6);
	const marker = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
	return `${oldLine} ${newLine} ${marker} ${line.text}`;
}

export function renderImportanceInput(input: {
	title: string;
	mergeBaseSha: string;
	headSha: string;
	files: ParsedFileDiff[];
}): string {
	const sections = input.files.map((file) => {
		const lines =
			file.binary || file.hunks.length === 0
				? ["(no textual diff — do not score)"]
				: file.hunks.flatMap((hunk) => [
						hunk.header,
						...hunk.lines.map(renderLine),
					]);
		return [`## ${importanceFilePath(file)} (${file.status})`, ...lines].join(
			"\n",
		);
	});
	return [
		`# Merge request: ${input.title}`,
		`Merge base: ${input.mergeBaseSha}`,
		`Head: ${input.headSha}`,
		"",
		sections.join("\n\n"),
	].join("\n");
}

export function buildImportanceSystemPrompt(promptText: string): string {
	return `${promptText.trim()}\n\n${IMPORTANCE_OUTPUT_RULES}`;
}

export function buildImportanceMessage(
	inputPath: string,
	outputPath: string,
): string {
	return `Input file: ${inputPath}\nOutput file: ${outputPath}\n\nRead the input file, score every changed line span, then write the JSON to the output file.`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function cancelledImportanceResult(
	runId: string,
	attempts: number,
	systemPrompt: string | null,
	input: string | null,
	messages: string[],
): ImportanceGenerationResult {
	return {
		status: "failed",
		error: "Importance run was cancelled",
		files: [],
		runId,
		attempts,
		systemPrompt,
		input,
		messages,
	};
}

type ImportanceAttempt = AgentFileAttempt<ImportanceDoc>;

interface DiffCoordinates {
	old: number[];
	new: number[];
}

function diffCoordinates(file: ParsedFileDiff): DiffCoordinates {
	const old = new Set<number>();
	const current = new Set<number>();
	for (const hunk of file.hunks) {
		for (const line of hunk.lines) {
			if (line.oldLine !== null) old.add(line.oldLine);
			if (line.newLine !== null) current.add(line.newLine);
		}
	}
	return {
		old: [...old].sort((a, b) => a - b),
		new: [...current].sort((a, b) => a - b),
	};
}

function clipImportanceSpans(
	spans: readonly ImportanceSpan[],
	coordinates: DiffCoordinates,
): ImportanceSpan[] {
	const clipped: ImportanceSpan[] = [];
	for (const span of spans) {
		const lines = coordinates[span.side];
		let runStart: number | null = null;
		let runEnd: number | null = null;
		for (const line of lines) {
			if (line < span.startLine || line > span.endLine) continue;
			if (runEnd !== null && line === runEnd + 1) {
				runEnd = line;
				continue;
			}
			if (runStart !== null && runEnd !== null) {
				clipped.push({
					side: span.side,
					startLine: runStart,
					endLine: runEnd,
					score: span.score,
					reason: span.reason,
				});
			}
			runStart = line;
			runEnd = line;
		}
		if (runStart !== null && runEnd !== null) {
			clipped.push({
				side: span.side,
				startLine: runStart,
				endLine: runEnd,
				score: span.score,
				reason: span.reason,
			});
		}
	}
	return clipped;
}

function importanceCoordinatesByPath(
	parsedDiff: readonly ParsedFileDiff[],
): Map<string, DiffCoordinates | null> {
	const coordinatesByPath = new Map<string, DiffCoordinates | null>();
	for (const file of parsedDiff) {
		const path = importanceFilePath(file);
		coordinatesByPath.set(
			path,
			!file.binary && file.hunks.length > 0 ? diffCoordinates(file) : null,
		);
	}
	return coordinatesByPath;
}

export async function generateImportance(
	options: ImportanceGenerationOptions,
): Promise<ImportanceGenerationResult> {
	const runId = options.runId ?? crypto.randomUUID();
	const runDir = join(options.dir, runId);
	let attempts = 0;
	let systemPrompt: string | null = null;
	let input: string | null = null;
	const messages: string[] = [];
	try {
		await mkdir(runDir, { recursive: true });
		await options.agent.preflight();
		if (options.signal?.aborted)
			return cancelledImportanceResult(
				runId,
				attempts,
				systemPrompt,
				input,
				messages,
			);

		const promptText =
			options.promptText ??
			(await loadPrompt("review-importance", {
				preset: options.promptPreset,
				dir: options.promptSourceDir,
			}));
		const systemPromptPath = join(runDir, "system.md");
		const inputPath = join(runDir, "input.md");
		const outputPath = join(runDir, "output.json");
		systemPrompt = buildImportanceSystemPrompt(promptText);
		input = renderImportanceInput({
			title: options.state.mr.title,
			mergeBaseSha: options.state.revision.mergeBaseSha,
			headSha: options.state.revision.headSha,
			files: options.parsedDiff,
		});
		await Bun.write(systemPromptPath, systemPrompt);
		await Bun.write(inputPath, input);

		const firstMessage = buildImportanceMessage(inputPath, outputPath);
		const attemptOptions = {
			agent: options.agent,
			cwd: options.state.worktreePath,
			systemPromptFile: systemPromptPath,
			writeDir: runDir,
			outputPath,
			timeoutSeconds: agentAttemptTimeoutSeconds(options.config),
			signal: options.signal,
			label: "Importance",
			schema: ImportanceDocSchema,
		};
		let attempt: ImportanceAttempt;
		attempts++;
		messages.push(firstMessage);
		attempt = await runAgentFileAttempt({
			...attemptOptions,
			message: firstMessage,
		});
		if (options.signal?.aborted)
			return cancelledImportanceResult(
				runId,
				attempts,
				systemPrompt,
				input,
				messages,
			);

		if (!attempt.ok && attempt.kind === "output") {
			const retryMessage = `${firstMessage}\n\nPrevious output validation failed. Write a complete replacement JSON file following the required schema exactly: include version 1, a files array, and side, startLine, endLine, score, and reason on every span. Do not return prose or rename fields. Fix every listed validation error:\n${attempt.error}`;
			attempts++;
			messages.push(retryMessage);
			attempt = await runAgentFileAttempt({
				...attemptOptions,
				message: retryMessage,
			});
			if (options.signal?.aborted)
				return cancelledImportanceResult(
					runId,
					attempts,
					systemPrompt,
					input,
					messages,
				);
		}
		if (!attempt.ok) {
			return {
				status: "failed",
				error: attempt.error,
				files: [],
				runId,
				attempts,
				systemPrompt,
				input,
				messages,
			};
		}

		const coordinatesByPath = importanceCoordinatesByPath(options.parsedDiff);
		const files = attempt.doc.files.flatMap((file) => {
			const coordinates = coordinatesByPath.get(file.path);
			if (coordinates === undefined) {
				logger.warn("review.importance.unknown-file", { path: file.path });
				return [];
			}
			if (coordinates === null) return [];
			return [
				{
					path: file.path,
					spans: clipImportanceSpans(file.spans, coordinates),
				},
			];
		});
		return {
			status: "ready",
			error: null,
			files,
			runId,
			attempts,
			systemPrompt,
			input,
			messages,
		};
	} catch (error) {
		return {
			status: "failed",
			error: options.signal?.aborted
				? "Importance run was cancelled"
				: errorMessage(error),
			files: [],
			runId,
			attempts,
			systemPrompt,
			input,
			messages,
		};
	} finally {
		await rm(runDir, { recursive: true, force: true }).catch(() => undefined);
	}
}

export async function readImportanceResult(
	path: string,
): Promise<ImportanceResult | null> {
	try {
		const file = Bun.file(path);
		if (!(await file.exists())) return null;
		const parsed = ImportanceResultSchema.safeParse(
			JSON.parse(await file.text()),
		);
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

export async function writeImportanceResult(
	path: string,
	result: ImportanceResult,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await Bun.write(tempPath, JSON.stringify(result));
		await rename(tempPath, path);
	} finally {
		if (await Bun.file(tempPath).exists()) await unlink(tempPath);
	}
}

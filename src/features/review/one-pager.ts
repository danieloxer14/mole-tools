import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { loadPrompt } from "../../adapters/prompts/loader";
import type { ReviewAgent } from "../../ports/review-agent";
import type { ParsedFileDiff } from "../../shared/diff-parse";
import {
	agentAttemptTimeoutSeconds,
	runAgentFileAttempt,
} from "./agent-attempt";
import type { ReviewState } from "./state";

class OnePagerInputBudgetError extends Error {}

export const ONE_PAGER_FILE_NAME = "one-pager.md";

export interface OnePagerLocation {
	dir: string;
	documentDir: string;
	documentPath: string;
	runsDir: string;
}

export function onePagerLocation(dir: string): OnePagerLocation {
	const documentDir = join(dir, "document");
	return {
		dir,
		documentDir,
		documentPath: join(documentDir, ONE_PAGER_FILE_NAME),
		runsDir: join(dir, "runs"),
	};
}

export type OnePagerStatus = "idle" | "running" | "ready";

export interface OnePagerSnapshot {
	status: OnePagerStatus;
	markdown: string | null;
	updatedAt: string | null;
}

export async function readOnePagerDocument(
	documentPath: string,
): Promise<{ markdown: string; updatedAt: string } | null> {
	try {
		const file = Bun.file(documentPath);
		if (!(await file.exists())) return null;
		const markdown = await file.text();
		if (markdown.trim() === "") return null;
		const fileStat = await stat(documentPath);
		return { markdown, updatedAt: fileStat.mtime.toISOString() };
	} catch {
		return null;
	}
}

interface OnePagerDiffLine {
	kind: string;
	oldLine: number | null;
	newLine: number | null;
	text: string;
	textTruncated?: boolean;
}

interface OnePagerDiffHunk {
	header: string;
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	lines: OnePagerDiffLine[];
}

interface BoundedDiff {
	hunks: OnePagerDiffHunk[];
	truncated: boolean;
	bytes: number;
}

interface BoundedText {
	text: string;
	truncated: boolean;
}

const MAX_FILE_DIFF_BYTES = 12_000;
const MAX_TOTAL_DIFF_BYTES = 48_000;
const MAX_DIFF_LINE_TEXT_BYTES = 1_024;
const MAX_DIFF_HUNK_HEADER_BYTES = 512;
const MAX_FILE_PATH_BYTES = 4_096;
const MAX_TOTAL_INPUT_BYTES = 64 * 1024;
const MAX_TOTAL_MESSAGE_BYTES = 64 * 1024;
const MAX_TOTAL_PROMPT_BYTES = 96 * 1024;
const MAX_TITLE_BYTES = 2_048;
const MAX_DESCRIPTION_BYTES = 8_192;
const MAX_URL_BYTES = 2_048;
const MAX_BRANCH_BYTES = 1_024;
const MAX_REVISION_BYTES = 512;
const MAX_RETRY_ERROR_BYTES = 1_024;
const RETRY_ERROR_TRUNCATION_MARKER = " [truncated]";
const FILE_DIFF_TRUNCATION_MARKER =
	"[diff content omitted; omitted lines were not supplied]";
const INPUT_DIFF_TRUNCATION_MARKER =
	"[diff content omitted; omitted changes were not supplied]";
const FILES_TRUNCATION_MARKER =
	"[changed-file list truncated; omitted paths and stats were not supplied]";
const DESCRIPTION_TRUNCATION_MARKER =
	"[MR description truncated; omitted description text was not supplied]";
const METADATA_TRUNCATION_MARKER =
	"[MR or file metadata truncated; omitted metadata text was not supplied]";

interface OnePagerMrMetadata {
	title: string;
	description: string;
	webUrl: string;
	sourceBranch: string;
	targetBranch: string;
	headSha: string;
	mergeBaseSha: string;
}

interface OnePagerFileMetadata {
	path: string;
	status: ParsedFileDiff["status"];
	insertions: number;
	deletions: number;
	binary: boolean;
}

interface OnePagerFileInput extends OnePagerFileMetadata {
	hunks: OnePagerDiffHunk[];
	diffTruncated?: boolean;
	truncationMarker?: string;
}

interface OnePagerInputCandidate {
	source: ParsedFileDiff;
	metadata: OnePagerFileMetadata;
	pathTruncated: boolean;
	skeleton: OnePagerFileInput;
}

interface OnePagerInputMarkers {
	descriptionTruncated: boolean;
	metadataTruncated: boolean;
	filesTruncated: boolean;
	omittedFileCount: number;
	diffTruncated: boolean;
}

function utf8CodePointWidth(codePoint: number): number {
	return codePoint <= 0x7f
		? 1
		: codePoint <= 0x7ff
			? 2
			: codePoint <= 0xffff
				? 3
				: 4;
}

function utf8Length(value: string): number {
	let bytes = 0;
	for (const character of value) {
		bytes += utf8CodePointWidth(character.codePointAt(0) ?? 0);
	}
	return bytes;
}

function boundedText(value: string, maxBytes: number): BoundedText {
	let bytes = 0;
	let end = 0;
	for (const character of value) {
		const size = utf8CodePointWidth(character.codePointAt(0) ?? 0);
		if (bytes + size > maxBytes) {
			return { text: value.slice(0, end), truncated: true };
		}
		bytes += size;
		end += character.length;
	}
	return { text: value, truncated: false };
}

function boundedJsonText(value: string, maxBytes: number): BoundedText {
	const bounded = boundedText(value, maxBytes);
	if (utf8Length(JSON.stringify(bounded.text)) <= maxBytes) return bounded;

	let textBytes = 0;
	let end = 0;
	for (const character of bounded.text) {
		const serializedCharacterBytes = utf8Length(JSON.stringify(character)) - 2;
		if (textBytes + serializedCharacterBytes + 2 > maxBytes) break;
		textBytes += serializedCharacterBytes;
		end += character.length;
	}
	return {
		text: bounded.text.slice(0, end),
		truncated: true,
	};
}

function boundedDiff(
	file: ParsedFileDiff,
	totalRemaining: number,
): BoundedDiff {
	const budget = Math.min(MAX_FILE_DIFF_BYTES, totalRemaining);
	const hunks: OnePagerDiffHunk[] = [];
	let used = 2; // JSON array brackets
	let truncated = false;
	for (const hunk of file.hunks) {
		const header = boundedText(hunk.header, MAX_DIFF_HUNK_HEADER_BYTES);
		const entry: OnePagerDiffHunk = {
			header: header.text,
			oldStart: hunk.oldStart,
			oldLines: hunk.oldLines,
			newStart: hunk.newStart,
			newLines: hunk.newLines,
			lines: [],
		};
		if (header.truncated) truncated = true;
		let entryBytes = utf8Length(JSON.stringify(entry));
		const hunkSeparatorBytes = hunks.length ? 1 : 0;
		if (used + hunkSeparatorBytes + entryBytes > budget) {
			truncated = true;
			continue;
		}
		for (const line of hunk.lines) {
			const bounded = boundedText(line.text, MAX_DIFF_LINE_TEXT_BYTES);
			const serialized: OnePagerDiffLine = {
				kind: line.kind,
				oldLine: line.oldLine,
				newLine: line.newLine,
				text: bounded.text,
				...(bounded.truncated ? { textTruncated: true } : {}),
			};
			const addedBytes =
				utf8Length(JSON.stringify(serialized)) + (entry.lines.length ? 1 : 0);
			if (used + hunkSeparatorBytes + entryBytes + addedBytes > budget) {
				truncated = true;
				continue;
			}
			entry.lines.push(serialized);
			entryBytes += addedBytes;
			if (bounded.truncated) truncated = true;
		}
		used += hunkSeparatorBytes + entryBytes;
		hunks.push(entry);
	}
	if (hunks.length < file.hunks.length) truncated = true;
	return { hunks, truncated, bytes: used };
}

function onePagerInputObject(
	mr: OnePagerMrMetadata,
	files: OnePagerFileInput[],
	markers: OnePagerInputMarkers,
): Record<string, unknown> {
	return {
		mr,
		files,
		...(markers.descriptionTruncated
			? {
					descriptionTruncated: true,
					descriptionTruncationMarker: DESCRIPTION_TRUNCATION_MARKER,
				}
			: {}),
		...(markers.metadataTruncated
			? {
					metadataTruncated: true,
					metadataTruncationMarker: METADATA_TRUNCATION_MARKER,
				}
			: {}),
		...(markers.filesTruncated
			? {
					filesTruncated: true,
					omittedFileCount: markers.omittedFileCount,
					filesTruncationMarker: FILES_TRUNCATION_MARKER,
				}
			: {}),
		...(markers.diffTruncated
			? {
					diffTruncated: true,
					diffTruncationMarker: INPUT_DIFF_TRUNCATION_MARKER,
				}
			: {}),
	};
}

export function buildOnePagerInput(
	state: ReviewState,
	parsedDiff: readonly ParsedFileDiff[],
	maxBytes = MAX_TOTAL_INPUT_BYTES,
): string {
	if (!Number.isFinite(maxBytes) || maxBytes < 0) {
		throw new Error("One-pager input byte limit must be a non-negative number");
	}
	const inputBudget = Math.min(MAX_TOTAL_INPUT_BYTES, Math.floor(maxBytes));
	const title = boundedJsonText(state.mr.title, MAX_TITLE_BYTES);
	const description = boundedJsonText(
		state.mr.description,
		MAX_DESCRIPTION_BYTES,
	);
	const webUrl = boundedJsonText(state.mr.webUrl, MAX_URL_BYTES);
	const sourceBranch = boundedJsonText(state.mr.sourceBranch, MAX_BRANCH_BYTES);
	const targetBranch = boundedJsonText(state.mr.targetBranch, MAX_BRANCH_BYTES);
	const headSha = boundedJsonText(state.revision.headSha, MAX_REVISION_BYTES);
	const mergeBaseSha = boundedJsonText(
		state.revision.mergeBaseSha,
		MAX_REVISION_BYTES,
	);
	const mr: OnePagerMrMetadata = {
		title: title.text,
		description: description.text,
		webUrl: webUrl.text,
		sourceBranch: sourceBranch.text,
		targetBranch: targetBranch.text,
		headSha: headSha.text,
		mergeBaseSha: mergeBaseSha.text,
	};
	let descriptionTruncated = description.truncated;
	const baseMetadataTruncated = [
		title,
		webUrl,
		sourceBranch,
		targetBranch,
		headSha,
		mergeBaseSha,
	].some((text) => text.truncated);
	let candidateCount = 0;
	let mayTruncateDiff = false;
	for (const file of parsedDiff) {
		if (!(file.newPath ?? file.oldPath)) continue;
		candidateCount++;
		if (file.hunks.length > 0) mayTruncateDiff = true;
	}
	const makeMarkers = (
		omittedFileCount: number,
		metadataTruncated: boolean,
		diffTruncated: boolean,
	): OnePagerInputMarkers => ({
		descriptionTruncated,
		metadataTruncated,
		filesTruncated: omittedFileCount > 0,
		omittedFileCount,
		diffTruncated,
	});
	const envelopeByteCache = new Map<string, number>();
	const getEnvelopeBytes = (
		omittedFileCount: number,
		metadataTruncated: boolean,
		diffTruncated: boolean,
	): number => {
		const omittedDigits =
			omittedFileCount > 0 ? String(omittedFileCount).length : 0;
		const key = `${omittedFileCount > 0}:${omittedDigits}:${metadataTruncated}:${diffTruncated}`;
		const cached = envelopeByteCache.get(key);
		if (cached !== undefined) return cached;
		const representativeCount =
			omittedFileCount > 0 ? 10 ** (omittedDigits - 1) : 0;
		const bytes = utf8Length(
			JSON.stringify(
				onePagerInputObject(
					mr,
					[],
					makeMarkers(representativeCount, metadataTruncated, diffTruncated),
				),
			),
		);
		envelopeByteCache.set(key, bytes);
		return bytes;
	};
	let metadataEnvelopeBytes = getEnvelopeBytes(0, baseMetadataTruncated, false);
	while (metadataEnvelopeBytes > inputBudget && mr.description.length > 0) {
		const currentDescriptionBytes = utf8Length(JSON.stringify(mr.description));
		const nextDescription = boundedJsonText(
			mr.description,
			Math.floor(currentDescriptionBytes / 2),
		);
		if (nextDescription.text === mr.description) break;
		mr.description = nextDescription.text;
		descriptionTruncated = true;
		envelopeByteCache.clear();
		metadataEnvelopeBytes = getEnvelopeBytes(0, baseMetadataTruncated, false);
	}
	if (metadataEnvelopeBytes > inputBudget) {
		throw new OnePagerInputBudgetError(
			`One-pager MR metadata cannot fit within the ${inputBudget}-byte input limit`,
		);
	}

	const selectedCandidates: OnePagerInputCandidate[] = [];
	let selectedRowsBytes = 0;
	let selectedPathTruncated = false;
	let candidateIndex = 0;
	for (const file of parsedDiff) {
		const path = file.newPath ?? file.oldPath;
		if (!path) continue;
		const boundedPath = boundedJsonText(path, MAX_FILE_PATH_BYTES);
		const metadata = {
			path: boundedPath.text,
			status: file.status,
			insertions: file.insertions,
			deletions: file.deletions,
			binary: file.binary,
		} satisfies OnePagerFileMetadata;
		const candidate: OnePagerInputCandidate = {
			source: file,
			metadata,
			pathTruncated: boundedPath.truncated,
			skeleton: {
				...metadata,
				hunks: [],
				...(file.hunks.length > 0
					? {
							diffTruncated: true,
							truncationMarker: FILE_DIFF_TRUNCATION_MARKER,
						}
					: {}),
			},
		};
		const omittedIfSelected =
			candidateIndex === candidateCount - 1
				? 0
				: candidateCount - candidateIndex;
		candidateIndex++;
		const metadataTruncated =
			baseMetadataTruncated || selectedPathTruncated || candidate.pathTruncated;
		const envelopeBytes = getEnvelopeBytes(
			omittedIfSelected,
			metadataTruncated,
			mayTruncateDiff,
		);
		const rowBytes = utf8Length(JSON.stringify(candidate.skeleton));
		const separatorBytes = selectedCandidates.length > 0 ? 1 : 0;
		if (
			envelopeBytes + selectedRowsBytes + separatorBytes + rowBytes >
			inputBudget
		) {
			break;
		}
		selectedCandidates.push(candidate);
		selectedRowsBytes += separatorBytes + rowBytes;
		selectedPathTruncated ||= candidate.pathTruncated;
	}

	const omittedFileCount = candidateCount - selectedCandidates.length;
	const reservedMarkers = makeMarkers(
		omittedFileCount,
		baseMetadataTruncated || selectedPathTruncated,
		mayTruncateDiff,
	);
	const selectedSkeletons = selectedCandidates.map(
		(candidate) => candidate.skeleton,
	);
	const skeletonBytes = utf8Length(
		JSON.stringify(onePagerInputObject(mr, selectedSkeletons, reservedMarkers)),
	);
	if (skeletonBytes > inputBudget) {
		throw new OnePagerInputBudgetError(
			`One-pager MR metadata and required truncation markers cannot fit within the ${inputBudget}-byte input limit`,
		);
	}

	const emptyHunksBytes = selectedCandidates.length * 2;
	const diffBudget = Math.min(
		MAX_TOTAL_DIFF_BYTES,
		inputBudget - skeletonBytes + emptyHunksBytes,
	);
	let remainingDiffBytes = diffBudget;
	let inputDiffTruncated = false;
	if (omittedFileCount > 0) {
		let omittedCandidateIndex = 0;
		for (const file of parsedDiff) {
			if (!(file.newPath ?? file.oldPath)) continue;
			if (
				omittedCandidateIndex >= selectedCandidates.length &&
				file.hunks.length > 0
			) {
				inputDiffTruncated = true;
				break;
			}
			omittedCandidateIndex++;
		}
	}
	const files: OnePagerFileInput[] = [];
	for (let index = 0; index < selectedCandidates.length; index++) {
		const candidate = selectedCandidates[index];
		if (!candidate) continue;
		const laterFileBrackets = (selectedCandidates.length - index - 1) * 2;
		const fileDiffBudget = Math.max(2, remainingDiffBytes - laterFileBrackets);
		const bounded = boundedDiff(candidate.source, fileDiffBudget);
		remainingDiffBytes -= bounded.bytes;
		if (bounded.truncated) inputDiffTruncated = true;
		files.push({
			...candidate.metadata,
			hunks: bounded.hunks,
			...(bounded.truncated
				? {
						diffTruncated: true,
						truncationMarker: FILE_DIFF_TRUNCATION_MARKER,
					}
				: {}),
		});
	}
	const markers = makeMarkers(
		omittedFileCount,
		baseMetadataTruncated || selectedPathTruncated,
		inputDiffTruncated,
	);
	const serialized = JSON.stringify(onePagerInputObject(mr, files, markers));
	if (utf8Length(serialized) > inputBudget) {
		throw new Error(
			`One-pager input exceeds the ${inputBudget}-byte limit after metadata and diff bounding`,
		);
	}
	return serialized;
}

export interface OnePagerGenerationOptions {
	agent: ReviewAgent;
	state: ReviewState;
	parsedDiff: readonly ParsedFileDiff[];
	dir: string;
	promptSourceDir?: string;
	promptPreset?: string;
	promptText?: string;
	config?: { review?: { layerTimeoutSeconds?: number } };
	runId?: string;
}

export type OnePagerGenerationResult =
	| { status: "ready"; markdown: string }
	| { status: "failed"; error: string };

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function boundedRetryError(error: string): string {
	const bounded = boundedText(error, MAX_RETRY_ERROR_BYTES);
	if (!bounded.truncated) return error;
	const markerBytes = utf8Length(RETRY_ERROR_TRUNCATION_MARKER);
	return `${boundedText(error, MAX_RETRY_ERROR_BYTES - markerBytes).text}${RETRY_ERROR_TRUNCATION_MARKER}`;
}

export async function generateOnePager(
	options: OnePagerGenerationOptions,
): Promise<OnePagerGenerationResult> {
	const runId = options.runId ?? randomUUID();
	const location = onePagerLocation(options.dir);
	const runDir = join(location.runsDir, runId);
	let temporaryPath: string | null = null;
	try {
		await mkdir(runDir, { recursive: true });
		await options.agent.preflight();

		const basePrompt =
			options.promptText ??
			(await loadPrompt("review-one-pager", {
				preset: options.promptPreset,
				dir: options.promptSourceDir,
			}));
		const systemPromptFile = join(runDir, "system.md");
		const outputPath = join(runDir, ONE_PAGER_FILE_NAME);
		const scopedWrites = options.agent.supportsScopedWrites === true;
		const policy = [
			`The review worktree is read-only and pinned at the absolute path ${options.state.worktreePath}.`,
			"The supplied bounded unified diff is primary evidence of the changes, including before/after line text, hunk headers, and line numbers. Truncation markers mean omitted content was not supplied or inspected; never infer omitted content. Available read-only context tools are optional follow-up and must not replace the supplied diff.",
			"Use the supplied MR metadata and changed-file list as authoritative context. Optional inspection of changed files may add context, but keep the worktree read-only and never modify it.",
			...(scopedWrites
				? [
						`The only file you may create or modify is ${outputPath}.`,
						`Runtime permissions enforce directory-scoped writes only within ${runDir}.`,
					]
				: [
						"This provider is read-only and has no file-write tools. Runtime policy overrides any base-prompt request to write files. Return the complete Markdown in your response; do not create or modify files.",
					]),
		].join(" ");
		const systemPrompt = `${basePrompt.trim()}\n\n${policy}\n`;
		const systemPromptBytes = utf8Length(systemPrompt);
		const messagePrefix = [
			...(scopedWrites
				? [
						`Write the one pager Markdown document to this absolute path: ${outputPath}`,
						"Reply with only that absolute path after writing the file.",
					]
				: [
						"Return only the complete Markdown summary in your response. Do not attempt file writes.",
					]),
		].join("\n\n");
		const messagePrefixBytes = utf8Length(`${messagePrefix}\n\n`);
		const correction = scopedWrites
			? "Write the complete one pager Markdown document to the same path."
			: "Return the complete one pager Markdown as your response. Do not attempt file writes.";
		const retrySuffixPrefix = `\n\nPrevious output validation failed. ${correction}\n`;
		const retryReserveBytes =
			utf8Length(retrySuffixPrefix) + MAX_RETRY_ERROR_BYTES;
		const inputBudget = Math.min(
			MAX_TOTAL_INPUT_BYTES,
			MAX_TOTAL_MESSAGE_BYTES - messagePrefixBytes - retryReserveBytes,
			MAX_TOTAL_PROMPT_BYTES -
				systemPromptBytes -
				messagePrefixBytes -
				retryReserveBytes,
		);
		if (inputBudget < 0) {
			throw new Error(
				"One-pager base prompt and fixed instructions exceed the 96 KiB total prompt or 64 KiB message limit",
			);
		}
		let serializedInput: string;
		try {
			serializedInput = buildOnePagerInput(
				options.state,
				options.parsedDiff,
				inputBudget,
			);
		} catch (error) {
			if (error instanceof OnePagerInputBudgetError) {
				const message = errorMessage(error);
				throw new Error(
					`One-pager prompt leaves insufficient room for required input metadata: ${message}`,
				);
			}
			throw error;
		}
		const firstMessage = `${messagePrefix}\n\n${serializedInput}`;
		const firstMessageBytes = utf8Length(firstMessage);
		if (firstMessageBytes > MAX_TOTAL_MESSAGE_BYTES) {
			throw new Error("One-pager message exceeds the 64 KiB message limit");
		}
		if (systemPromptBytes + firstMessageBytes > MAX_TOTAL_PROMPT_BYTES) {
			throw new Error("One-pager total prompt exceeds the 96 KiB prompt limit");
		}
		await Bun.write(systemPromptFile, systemPrompt);
		const commonAttemptOptions = {
			agent: options.agent,
			cwd: options.state.worktreePath,
			systemPromptFile,
			writeScope: "directory" as const,
			timeoutSeconds: agentAttemptTimeoutSeconds(options.config),
			label: "One pager",
			format: "text" as const,
			schema: z
				.string()
				.refine((value) => value.trim() !== "", "One pager must not be empty"),
		};
		const attemptOptions = scopedWrites
			? { ...commonAttemptOptions, writeDir: runDir, outputPath }
			: commonAttemptOptions;
		let attempt = await runAgentFileAttempt({
			...attemptOptions,
			message: firstMessage,
		});
		if (!attempt.ok && attempt.kind === "output") {
			const originalError = attempt.error;
			const retryError = boundedRetryError(originalError);
			const retryMessageBytes =
				firstMessageBytes +
				utf8Length(retrySuffixPrefix) +
				utf8Length(retryError);
			if (
				retryMessageBytes > MAX_TOTAL_MESSAGE_BYTES ||
				systemPromptBytes + retryMessageBytes > MAX_TOTAL_PROMPT_BYTES
			) {
				return { status: "failed", error: originalError };
			}
			const retryMessage = `${firstMessage}${retrySuffixPrefix}${retryError}`;
			attempt = await runAgentFileAttempt({
				...attemptOptions,
				message: retryMessage,
			});
		}
		if (!attempt.ok) return { status: "failed", error: attempt.error };

		await mkdir(location.documentDir, { recursive: true });
		temporaryPath = `${location.documentPath}.${runId}.tmp`;
		await Bun.write(temporaryPath, attempt.doc);
		await rename(temporaryPath, location.documentPath);
		temporaryPath = null;
		return { status: "ready", markdown: attempt.doc };
	} catch (error) {
		return {
			status: "failed",
			error: errorMessage(error),
		};
	} finally {
		if (temporaryPath) {
			await rm(temporaryPath, { force: true }).catch(() => undefined);
		}
		await rm(runDir, { recursive: true, force: true }).catch(() => undefined);
	}
}

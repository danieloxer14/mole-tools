import { z } from "zod";
import { RalphTaskFileSchema, ChecklistItemSchema, type RalphTaskFile, type ChecklistItem, RalphError } from "./schema";

// ─── Required section headings (spec §3.1) ──────────────────────────────

const REQUIRED_HEADINGS = [
	"## Goal",
	"## Deliverable",
	"## Task checklist",
	"## Stale-prompt guard",
	"## Completion gate",
	"## Iteration protocol",
] as const;

type RequiredHeading = (typeof REQUIRED_HEADINGS)[number];

// ─── Parse error type ──────────────────────────────────────────────────

/**
 * Structured parse failure for Ralph task files.
 * Extends RalphError to carry specific markdown-parsing diagnostics.
 */
export class RalphParseError extends RalphError {
	readonly readonlyIssues: string[];

	constructor(message: string, issues?: string[]) {
		super(message);
		this.name = "RalphParseError";
		this.readonlyIssues = issues ?? [message];
	}
}

// ─── Discriminated return type ─────────────────────────────────────────

export type ParseResult = RalphTaskFile | RalphParseError;

// ─── Checkbox change result ──────────────────────────────────────────────

export interface CheckboxChangeResult {
	success: boolean;
}

// ─── REGEX HELPERS ──────────────────────────────────────────────────────

/** Match a required `## Heading` at start of line */
const HEADING_RE = /^##\s+(.+)$/;		// group 1 = heading text

/** Match a checkbox item: `- [ ] text` or `- [x] text` (case-insensitive x) */
const CHECKBOX_RE = /^\s*-\s*\[([ xX])\]\s*(.+?)(?:\n|$)/;	// group 1 = "" | "x"|"X", group 2 = item text

/** Match any `## Heading` line regardless of content — used to find section boundaries */
const ANY_HEADING_RE = /^##\s+.+$/;

// ─── EXTRACT HELPERS ────────────────────────────────────────────────────

/**
 * Extract the body of a required heading section.
 * Returns text between that heading and the next `##` heading (or end of file).
 */
function extractSection(
	lines: string[],
	headingName: RequiredHeading,
): string {
	const headingIdx = lines.findIndex((l) => l === headingName);
	if (headingIdx === -1) return "";

	// Find the next heading after this one
	let endIdx = lines.length;
	for (let i = headingIdx + 1; i < lines.length; i++) {
		if (ANY_HEADING_RE.test(lines[i])) {
			endIdx = i;
			break;
		}
	}

	return lines.slice(headingIdx + 1, endIdx).join("\n").trim();
}

/**
 * Parse checkbox items from a Task checklist section body.
 * Returns an array of `{ done: boolean, text: string }` items.
 */
function extractChecklistItems(sectionBody: string): ChecklistItem[] {
	const lines = sectionBody.split("\n");
	const items: ChecklistItem[] = [];

	for (const line of lines) {
		const match = line.match(CHECKBOX_RE);
		if (!match) continue;

		const checked = match[1].toLowerCase() === "x";
		const text = match[2].trim();

		if (!text) continue; // skip empty checkbox items

		items.push({ done: checked, text });
	}

	return items;
}

// ─── PUBLIC API ────────────────────────────────────────────────────────

/**
 * Parse a raw Markdown task file into a validated `RalphTaskFile`.
 *
 * Validates that:
 * - All six required headings are present exactly once
 * - Goal and Deliverable sections are non-empty
 * - Task checklist contains at least one unchecked item
 *
 * Returns a `RalfParseError` on any validation failure.
 */
export function parseTaskFile(
	rawMd: string,
	options: { allowCompleted?: boolean } = {},
): ParseResult {
	const lines = rawMd.split("\n");

	// ── Collect found headings (in order of appearance) ────────────────
	const foundHeadings: string[] = [];
	const headingSet = new Set<string>();

	for (const line of lines) {
		const match = line.match(HEADING_RE);
		if (!match) continue;
		const headingText = `## ${match[1]}`.trim();
		foundHeadings.push(headingText);
		if (headingSet.has(headingText)) {
			return new RalphParseError(`duplicate heading: "${headingText}"`);
		}
		headingSet.add(headingText);
	}

	// ── Check all required headings present ────────────────────────────
	const missing = REQUIRED_HEADINGS.filter((h) => !headingSet.has(h));
	if (missing.length > 0) {
		return new RalphParseError(
			`Missing required heading(s): ${missing.map((h) => `"${h}"`).join(", ")}`,
		);
	}

	// ── Extract section content ────────────────────────────────────────
	const goal = extractSection(lines, "## Goal");
	const deliverable = extractSection(lines, "## Deliverable");
	const checklistBody = extractSection(lines, "## Task checklist");

	if (!goal) {
		return new RalphParseError("\"## Goal\" section is empty or missing content");
	}
	if (!deliverable) {
		return new RalphParseError("\"## Deliverable\" section is empty or missing content");
	}

	// ── Parse and validate checklist items ────────────────────────────
	const checklistItems = extractChecklistItems(checklistBody);

	if (checklistItems.length === 0) {
		return new RalphParseError(
			"\"## Task checklist\" must contain at least one checkbox item",
		);
	}

	// Validate each item through zod
	const validatedItems: ChecklistItem[] = [];
	for (const item of checklistItems) {
		try {
			validatedItems.push(ChecklistItemSchema.parse(item));
		} catch (e) {
			if (e instanceof z.ZodError) {
				return new RalphParseError(
					`Invalid checklist item "${item.text ?? "?"}": ${e.issues[0].message}`,
				);
			}
			throw e;
		}
	}

	// ── Reject fully-checked files (spec §4.5) ────────────────────────
	const hasUnchecked = validatedItems.some((item) => !item.done);
	if (!hasUnchecked && !options.allowCompleted) {
		return new RalphParseError(
			"All tasks in \"## Task checklist\" are checked; at least one unchecked task is required on initial creation",
		);
	}

	// ── Build and validate via zod schema ─────────────────────────────
	const collectedHeadings = REQUIRED_HEADINGS.filter((h) => headingSet.has(h));

	try {
		const taskFile: RalphTaskFile = RalphTaskFileSchema.parse({
			goal,
			deliverable,
			checklist: validatedItems,
			headings: collectedHeadings,
		});
		return taskFile;
	} catch (e) {
		if (e instanceof z.ZodError) {
			return new RalphParseError(
				`Schema validation failed: ${e.issues.map((i) => i.message).join("; ")}`,
			);
		}
		throw e;
	}
}

/**
 * Return the first unchecked task from a parsed task file, or null if all are done.
 */
export function nextUncheckedTask(
	parsed: RalphTaskFile,
): { index: number; text: string } | null {
	const idx = parsed.checklist.findIndex((item) => !item.done);
	if (idx === -1) return null;

	return {
		index: idx,
		text: parsed.checklist[idx].text,
	};
}

/**
 * Validate a worker's progress from the selected first unchecked task.
 *
 * A worker may complete one ticket's consecutive tasks in one iteration, so it
 * may check a contiguous run beginning at the selected task. It may not skip a
 * task, rewrite the checklist, or uncheck prior progress.
 */
export function validateCheckboxChange(
	before: string,
	after: string,
	selectedItem: string,
): CheckboxChangeResult {
	const beforeItems = extractChecklistItems(before);
	const afterItems = extractChecklistItems(after);

	// Item count must stay the same (no additions or removals)
	if (beforeItems.length !== afterItems.length) {
		return { success: false };
	}

	const selectedLower = selectedItem.trim().toLowerCase();
	const selectedIndex = beforeItems.findIndex(
		(item) => !item.done && item.text.trim().toLowerCase() === selectedLower,
	);
	if (selectedIndex === -1) return { success: false };

	const changedIndexes: number[] = [];
	for (let i = 0; i < beforeItems.length; i++) {
		const beforeItem = beforeItems[i]!;
		const afterItem = afterItems[i]!;
		if (beforeItem.text.trim().toLowerCase() !== afterItem.text.trim().toLowerCase()) return { success: false };
		if (beforeItem.done === afterItem.done) continue;
		if (!afterItem.done) return { success: false };
		changedIndexes.push(i);
	}

	// Progress must start at the selected task and contain no skipped tasks.
	return {
		success: changedIndexes.length > 0
			&& changedIndexes.every((index, offset) => index === selectedIndex + offset),
	};
}

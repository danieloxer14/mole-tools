import { z } from "zod";
import {
	type ChecklistItem,
	ChecklistItemSchema,
	RalphError,
	type RalphTaskFile,
	RalphTaskFileSchema,
} from "./schema";

// ─── Required section headings (spec §3.1) ──────────────────────────────

const REQUIRED_HEADINGS = [
	"## Goal",
	"## Deliverable",
	"## Task checklist",
	"## Stale-prompt guard",
	"## Completion gate",
	"## Iteration protocol",
] as const;
const REFERENCES_HEADING = "## References";

type RequiredHeading = (typeof REQUIRED_HEADINGS)[number] | typeof REFERENCES_HEADING;

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
	reason?: string;
}

// ─── REGEX HELPERS ──────────────────────────────────────────────────────

/** Match a required `## Heading` at start of line */
const HEADING_RE = /^##\s+(.+)$/; // group 1 = heading text

/** Match a checkbox item: `- [ ] text` or `- [x] text` (case-insensitive x) */
const CHECKBOX_RE = /^\s*-\s*\[([ xX])\]\s*(.+?)(?:\n|$)/; // group 1 = "" | "x"|"X", group 2 = item text

/** Match any `## Heading` line regardless of content — used to find section boundaries */
const ANY_HEADING_RE = /^##\s+.+$/;

// ─── EXTRACT HELPERS ────────────────────────────────────────────────────

/**
 * Extract the body of a required heading section.
 * Returns text between that heading and the next `##` heading (or end of file).
 */
function extractSection(lines: string[], headingName: RequiredHeading): string {
	const headingIdx = lines.indexOf(headingName);
	if (headingIdx === -1) return "";

	// Find the next heading after this one
	let endIdx = lines.length;
	for (let i = headingIdx + 1; i < lines.length; i++) {
		if (ANY_HEADING_RE.test(lines[i] ?? "")) {
			endIdx = i;
			break;
		}
	}

	return lines
		.slice(headingIdx + 1, endIdx)
		.join("\n")
		.trim();
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

		const checked = match[1]!.toLowerCase() === "x";
		const text = match[2]!.trim();

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
 * - All six baseline headings are present exactly once
 * - Generated task files may additionally require a non-empty References section
 *   and groups of no more than five checklist tasks
 * - Goal and Deliverable sections are non-empty
 * - Task checklist contains at least one unchecked item
 *
 * Returns a `RalfParseError` on any validation failure.
 */
export function parseTaskFile(
	rawMd: string,
	options: {
		allowCompleted?: boolean;
		requireReferences?: boolean;
		requireGroupedChecklist?: boolean;
	} = {},
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
	const missing = [
		...REQUIRED_HEADINGS,
		...(options.requireReferences ? [REFERENCES_HEADING] : []),
	].filter((h) => !headingSet.has(h));
	if (missing.length > 0) {
		return new RalphParseError(
			`Missing required heading(s): ${missing.map((h) => `"${h}"`).join(", ")}`,
		);
	}

	// ── Extract section content ────────────────────────────────────────
	const goal = extractSection(lines, "## Goal");
	const deliverable = extractSection(lines, "## Deliverable");
	const references = extractSection(lines, REFERENCES_HEADING);
	const checklistBody = extractSection(lines, "## Task checklist");

	if (!goal) {
		return new RalphParseError('"## Goal" section is empty or missing content');
	}
	if (!deliverable) {
		return new RalphParseError(
			'"## Deliverable" section is empty or missing content',
		);
	}
	if (options.requireReferences && !references) {
		return new RalphParseError('"## References" section is empty or missing content');
	}
	if (options.requireGroupedChecklist) {
		let groupTaskCount: number | null = null;
		for (const line of checklistBody.split("\n")) {
			if (/^###\s+\S/.test(line)) {
				groupTaskCount = 0;
				continue;
			}
			if (!CHECKBOX_RE.test(line)) continue;
			if (groupTaskCount === null)
				return new RalphParseError('Each checklist task must belong to a ### group');
			groupTaskCount++;
			if (groupTaskCount > 5)
				return new RalphParseError('A checklist group may contain at most five tasks');
		}
	}

	// ── Parse and validate checklist items ────────────────────────────
	const checklistItems = extractChecklistItems(checklistBody);

	if (checklistItems.length === 0) {
		return new RalphParseError(
			'"## Task checklist" must contain at least one checkbox item',
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
					`Invalid checklist item "${item.text ?? "?"}": ${e.issues[0]?.message ?? "invalid checklist item"}`,
				);
			}
			throw e;
		}
	}

	// ── Reject fully-checked files (spec §4.5) ────────────────────────
	const hasUnchecked = validatedItems.some((item) => !item.done);
	if (!hasUnchecked && !options.allowCompleted) {
		return new RalphParseError(
			'All tasks in "## Task checklist" are checked; at least one unchecked task is required on initial creation',
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
		text: parsed.checklist[idx]!.text,
	};
}

/**
 * Validate that a worker recorded some forward checklist progress.
 *
 * A worker may check any incomplete tasks. This intentionally does not require
 * contiguous progress from the task selected at iteration start: a review may
 * have reopened earlier work between iterations. It may not rewrite, add/remove,
 * or uncheck checklist tasks.
 */
export function validateCheckboxChange(
	before: string,
	after: string,
): CheckboxChangeResult {
	// Only the Task checklist is worker progress. Other sections may contain
	// verification checkboxes and must not make this comparison fail.
	const beforeItems = extractChecklistItems(
		extractSection(before.split("\n"), "## Task checklist"),
	);
	const afterItems = extractChecklistItems(
		extractSection(after.split("\n"), "## Task checklist"),
	);

	if (beforeItems.length !== afterItems.length)
		return { success: false, reason: "checklist items were added or removed" };

	const changedIndexes: number[] = [];
	for (let i = 0; i < beforeItems.length; i++) {
		const beforeItem = beforeItems[i];
		const afterItem = afterItems[i];
		if (!beforeItem || !afterItem)
			return { success: false, reason: "checklist could not be compared" };
		if (
			beforeItem.text.trim().toLowerCase() !==
			afterItem.text.trim().toLowerCase()
		)
			return { success: false, reason: "checklist task text was changed" };
		if (beforeItem.done === afterItem.done) continue;
		if (!afterItem.done)
			return { success: false, reason: "a completed task was unchecked" };
		changedIndexes.push(i);
	}

	if (changedIndexes.length === 0)
		return { success: false, reason: "no checklist task was checked" };
	return { success: true };
}

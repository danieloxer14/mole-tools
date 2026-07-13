import { z } from "zod";

// ── Loop name validation ───────────────────────────────────────────────

/** Kebab-case loop name: lowercase letters, digits, and single hyphens */
export const LoopNameSchema = z.string().regex(
	/^[a-z0-9]+(?:-[a-z0-9]+)*$/,
	"Loop name must be kebab-case (e.g. refactor-auth)",
);

export type LoopName = z.infer<typeof LoopNameSchema>;

// ── Status & Phase enums ───────────────────────────────────────────────

/** Authoritative loop lifecycle status */
export const StatusEnum = {
	ready: "ready",
	in_progress: "in_progress",
	paused: "paused",
	completed: "completed",
} as const;

export type Status = (typeof StatusEnum)[keyof typeof StatusEnum];

/** Live UI phase detail */
export const PhaseEnum = {
	ready: "ready",
	implementing: "implementing",
	reflecting: "reflecting",
	paused: "paused",
	completed: "completed",
} as const;

export type Phase = (typeof PhaseEnum)[keyof typeof PhaseEnum];

/** Reasons a loop was paused */
export const PauseReasonEnum = {
	max_iterations_reached: "max_iterations_reached",
	reflection_failed: "reflection_failed",
	interrupted: "interrupted",
} as const;

export type PauseReason = (typeof PauseReasonEnum)[keyof typeof PauseReasonEnum];

// ── Checklist item schema ──────────────────────────────────────────────

export const ChecklistItemSchema = z.object({
	text: z.string().min(1, "Checklist item text must not be empty"),
	done: z.boolean(),
});

export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

// ── RalphTaskFile schema (parsed Markdown structure) ───────────────────

/** Parsed structure of a Ralph task Markdown file */
export const RalphTaskFileSchema = z.object({
	goal: z.string().min(1, "Goal must not be empty"),
	deliverable: z.string().min(1, "Deliverable must not be empty"),
	checklist: z
			.array(ChecklistItemSchema)
			.min(1, "Task checklist must contain at least one item"),
	headings: z
			.array(z.string())
			.min(1, "Task file must have at least one required heading"),
});

export type RalphTaskFile = z.infer<typeof RalphTaskFileSchema>;

// ── RalphStateFile schema (matches §5.2 initial + §5.3 runtime) ────────

export const RalphStateFileSchema = z.object({
	name: LoopNameSchema,
	source: z.string().min(1, "Source must not be empty"),
	taskFile: z.string().min(1, "Task file path must not be empty"),
	models: z.object({
		init: z.object({ provider: z.string().min(1), name: z.string().min(1) }),
		implement: z.object({ provider: z.string().min(1), name: z.string().min(1) }),
		reflect: z.object({ provider: z.string().min(1), name: z.string().min(1) }),
	}),
	iteration: z.number().int().nonnegative(),
	maxIterations: z.number().int().positive(),
	reflectEvery: z.number().int().nonnegative(),
	active: z.boolean(),
	status: z.nativeEnum(StatusEnum),
	lastReflectionAt: z.number().int().nonnegative(),
	phase: z.nativeEnum(PhaseEnum),
	awaitingReview: z.boolean(),

	// ── Runtime additions (§5.3) — absent until first run/ completion ──
	startedAt: z.number().optional(),
	completedAt: z.number().optional(),
	workerRunId: z.string().uuid().optional(),
	workerItem: z.string().optional(),
	lastError: z.string().nullish(),
	pauseReason: z
			.nativeEnum(PauseReasonEnum)
			.nullable()
			.optional(),
});

export type RalphStateFile = z.infer<typeof RalphStateFileSchema>;

// ── RalphLockFile schema ──────────────────────────────────────────────

/** PID-based exclusive lock with optional run metadata */
export const RalphLockFileSchema = z.object({
	pid: z.number().int().positive(),
	runId: z.string().uuid().optional(),
	/** ISO timestamp retained for diagnostics and stale-lock reclamation. */
	createdAt: z.string().datetime().optional(),
	/** Epoch timestamp accepted for compatibility with older lock files. */
	lockedAt: z.number().nonnegative().optional(),
});

export type RalphLockFile = z.infer<typeof RalphLockFileSchema>;

// ── Validation error class ────────────────────────────────────────────

/** Structured validation failure for Ralph artifacts */
export class RalphError extends Error {
	readonly errors?: z.ZodIssue[];

	constructor(message: string, errors?: z.ZodIssue[]) {
		super(message);
		this.name = "RalphError";
		this.errors = errors;
	}
}

// ── Parsing helpers ───────────────────────────────────────────────────

/** Parse raw JSON text into a validated RalphStateFile */
export function parseRalphStateFile(text: string): RalphStateFile {
	try {
			const parsed = JSON.parse(text);
			return RalphStateFileSchema.parse(parsed);
	} catch (e) {
			if (e instanceof z.ZodError) {
					throw new RalphError("Invalid state file structure", e.issues);
			}
			throw new RalphError(`Failed to parse state JSON: ${String(e)}`);
	}
}

/** Parse raw JSON text into a validated RalphLockFile */
export function parseRalphLockFile(text: string): RalphLockFile {
	try {
			const parsed = JSON.parse(text);
			return RalphLockFileSchema.parse(parsed);
	} catch (e) {
			if (e instanceof z.ZodError) {
					throw new RalphError("Invalid lock file structure", e.issues);
			}
			throw new RalphError(`Failed to parse lock JSON: ${String(e)}`);
	}
}

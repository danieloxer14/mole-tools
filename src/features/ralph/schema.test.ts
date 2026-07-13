import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
	RalphError,
	LoopNameSchema,
	StatusEnum,
	PhaseEnum,
	PauseReasonEnum,
	ChecklistItemSchema,
	RalphTaskFileSchema,
	RalphStateFileSchema,
	RalphLockFileSchema,
	parseRalphStateFile,
	parseRalphLockFile,
	type LoopName,
	type Status,
	type Phase,
	type PauseReason,
	type ChecklistItem,
	type RalphTaskFile,
	type RalphStateFile,
	type RalphLockFile,
} from "./schema";

describe("LoopNameSchema", () => {
	test("accepts valid kebab-case names", () => {
		expect(LoopNameSchema.parse("refactor-auth")).toBe("refactor-auth");
		expect(LoopNameSchema.parse("auth")).toBe("auth");
		expect(LoopNameSchema.parse("feature-123")).toBe("feature-123");
		expect(LoopNameSchema.parse("a-b-c")).toBe("a-b-c");
	});

	test("rejects names with uppercase letters", () => {
		expect(() => LoopNameSchema.parse("RefactorAuth")).toThrow();
		expect(() => LoopNameSchema.parse("my-feature")).not.toThrow();
	});

	test("rejects names with underscores", () => {
		expect(() => LoopNameSchema.parse("my_feature")).toThrow();
	});

	test("rejects names with spaces", () => {
		expect(() => LoopNameSchema.parse("my feature")).toThrow();
	});

	test("rejects empty string", () => {
		expect(() => LoopNameSchema.parse("")).toThrow();
	});

	test("rejects names starting or ending with hyphen", () => {
		expect(() => LoopNameSchema.parse("-feature")).toThrow();
		expect(() => LoopNameSchema.parse("feature-")).toThrow();
	});
});

describe("StatusEnum", () => {
	test("exports the four valid status values", () => {
		expect(StatusEnum).toEqual({
			ready: "ready",
			in_progress: "in_progress",
			paused: "paused",
			completed: "completed",
		});
	});

	test("type is a union of the four status strings", () => {
		const statuses: Status[] = [
			StatusEnum.ready,
			StatusEnum.in_progress,
			StatusEnum.paused,
			StatusEnum.completed,
		];
		expect(statuses).toHaveLength(4);
	});
});

describe("PhaseEnum", () => {
	test("exports the five valid phase values", () => {
		expect(PhaseEnum).toEqual({
			ready: "ready",
			implementing: "implementing",
			reflecting: "reflecting",
			paused: "paused",
			completed: "completed",
		});
	});

	test("type is a union of the five phase strings", () => {
		const phases: Phase[] = [
			PhaseEnum.ready,
			PhaseEnum.implementing,
			PhaseEnum.reflecting,
			PhaseEnum.paused,
			PhaseEnum.completed,
		];
		expect(phases).toHaveLength(5);
	});
});

describe("PauseReasonEnum", () => {
	test("exports the three pause reason values", () => {
		expect(PauseReasonEnum).toEqual({
			max_iterations_reached: "max_iterations_reached",
			reflection_failed: "reflection_failed",
			interrupted: "interrupted",
		});
	});
});

describe("ChecklistItemSchema", () => {
	test("parses a checked item", () => {
		const item = ChecklistItemSchema.parse({ text: "Write tests", done: true });
		expect(item).toEqual({ text: "Write tests", done: true });
	});

	test("parses an unchecked item", () => {
		const item = ChecklistItemSchema.parse({ text: "Implement feature", done: false });
		expect(item).toEqual({ text: "Implement feature", done: false });
	});

	test("rejects missing required fields", () => {
		expect(() => ChecklistItemSchema.parse({ done: true })).toThrow();
		expect(() => ChecklistItemSchema.parse({ text: "test" })).toThrow();
	});
});

describe("RalphTaskFileSchema", () => {
	const validTask: RalphTaskFile = {
		goal: "Implement authentication module",
		deliverable: "Auth service with JWT support",
		checklist: [
			{ text: "Write tests", done: false },
			{ text: "Implement feature", done: true },
		],
		headings: ["## Goal", "## Deliverable", "## Task checklist"],
	};

	test("accepts conformant task file structure", () => {
		const parsed = RalphTaskFileSchema.parse(validTask);
		expect(parsed.goal).toBe(validTask.goal);
		expect(parsed.deliverable).toBe(validTask.deliverable);
		expect(parsed.checklist).toHaveLength(2);
	});

	test("rejects missing goal", () => {
		expect(() => RalphTaskFileSchema.parse({ ...validTask, goal: undefined })).toThrow();
	});

	test("rejects empty checklist", () => {
		expect(() => RalphTaskFileSchema.parse({ ...validTask, checklist: [] })).toThrow();
	});

	test("rejects non-string goal", () => {
		expect(() =>
			RalphTaskFileSchema.parse({ ...validTask, goal: 123 }),
		).toThrow();
	});

	test("rejects missing required headings", () => {
		expect(() =>
			RalphTaskFileSchema.parse({ ...validTask, headings: [] }),
		).toThrow();
	});
});

describe("RalphStateFileSchema", () => {
	const validInitialState: RalphStateFile = {
		name: "refactor-auth",
		source: "specs/auth.md",
		taskFile: ".ralph/refactor-auth.md",
		provider: "pi",
		model: "llama3.1",
		iteration: 0,
		maxIterations: 20,
		reflectEvery: 5,
		active: false,
		status: StatusEnum.ready,
		lastReflectionAt: 0,
		phase: PhaseEnum.ready,
		awaitingReview: false,
	};

	const validRuntimeState: RalphStateFile = {
		...validInitialState,
		active: true,
		status: StatusEnum.in_progress,
		phase: PhaseEnum.implementing,
		workerRunId: "550e8400-e29b-41d4-a716-446655440000",
		workerItem: "- [ ] Write tests for auth module",
		lastError: undefined,
		startedAt: Date.now(),
	};

	test("accepts valid initial state (per §5.2)", () => {
		const parsed = RalphStateFileSchema.parse(validInitialState);
		expect(parsed.name).toBe("refactor-auth");
		expect(parsed.iteration).toBe(0);
		expect(parsed.active).toBe(false);
		expect(parsed.status).toBe(StatusEnum.ready);
	});

	test("accepts valid runtime state (per §5.3)", () => {
		const parsed = RalphStateFileSchema.parse(validRuntimeState);
		expect(parsed.active).toBe(true);
		expect(parsed.status).toBe(StatusEnum.in_progress);
		expect(parsed.phase).toBe(PhaseEnum.implementing);
		expect(typeof parsed.workerRunId).toBe("string");
		expect(typeof parsed.startedAt).toBe("number");
	});

	test("rejects invalid loop name", () => {
		expect(() =>
			RalphStateFileSchema.parse({ ...validInitialState, name: "Invalid Name" }),
		).toThrow();
	});

	test("rejects invalid status", () => {
		expect(() =>
			RalphStateFileSchema.parse({
				...validInitialState,
				status: "invalid_status" as unknown as Status,
			}),
		).toThrow();
	});

	test("rejects invalid phase", () => {
		expect(() =>
			RalphStateFileSchema.parse({
				...validInitialState,
				phase: "invalid_phase" as unknown as Phase,
			}),
		).toThrow();
	});

	test("rejects negative maxIterations", () => {
		expect(() =>
			RalphStateFileSchema.parse({
				...validInitialState,
				maxIterations: -1,
			}),
		).toThrow();
	});

	test("allows reflectEvery to be zero", () => {
		const state = { ...validInitialState, reflectEvery: 0 };
		const parsed = RalphStateFileSchema.parse(state);
		expect(parsed.reflectEvery).toBe(0);
	});

	test("rejects negative iteration count", () => {
		expect(() =>
			RalphStateFileSchema.parse({
				...validInitialState,
				iteration: -1,
			}),
		).toThrow();
	});
});

describe("RalphLockFileSchema", () => {
	const validLock: RalphLockFile = {
		pid: 12345,
		runId: "550e8400-e29b-41d4-a716-446655440000",
		lockedAt: Date.now(),
	};

	test("accepts valid lock file with required fields", () => {
		const parsed = RalphLockFileSchema.parse(validLock);
		expect(parsed.pid).toBe(12345);
		expect(typeof parsed.runId).toBe("string");
	});

	test("accepts lock file with optional metadata omitted", () => {
		const miniLock = { pid: 12345 };
		const parsed = RalphLockFileSchema.parse(miniLock);
		expect(parsed.pid).toBe(12345);
	});

	test("rejects missing pid", () => {
		expect(() =>
			RalphLockFileSchema.parse({ runId: "some-id" }),
		).toThrow();
	});

	test("rejects non-numeric pid", () => {
		expect(() =>
			RalphLockFileSchema.parse({ pid: "not-a-number" }),
		).toThrow();
	});
});

describe("parseRalphLockFile", () => {
	const validJson = JSON.stringify({
		pid: 12345,
		runId: "550e8400-e29b-41d4-a716-446655440000",
		lockedAt: Date.now(),
	});

	test("parses valid JSON into RalphLockFile", () => {
		const lock = parseRalphLockFile(validJson);
		expect(lock.pid).toBe(12345);
	});

	test("throws RalphError for invalid JSON", () => {
		expect(() => parseRalphLockFile("not json")).toThrow(RalphError);
	});

	test("throws RalphError for structurally invalid data", () => {
		const badJson = JSON.stringify({ pid: "not-a-number" });
		expect(() => parseRalphLockFile(badJson)).toThrow(RalphError);
	});
});

describe("parseRalphStateFile", () => {
	const validJson = JSON.stringify({
		name: "refactor-auth",
		source: "specs/auth.md",
		taskFile: ".ralph/refactor-auth.md",
		provider: "pi",
		model: "llama3.1",
		iteration: 0,
		maxIterations: 20,
		reflectEvery: 5,
		active: false,
		status: StatusEnum.ready,
		lastReflectionAt: 0,
		phase: PhaseEnum.ready,
		awaitingReview: false,
	});

	test("parses valid JSON into RalphStateFile", () => {
		const state = parseRalphStateFile(validJson);
		expect(state.name).toBe("refactor-auth");
		expect(state.iteration).toBe(0);
	});

	test("throws RalphError for invalid JSON", () => {
		expect(() => parseRalphStateFile("{ invalid json }")).toThrow(RalphError);
	});

	test("throws RalphError for structurally invalid data", () => {
		const badJson = JSON.stringify({ name: "Invalid Name" });
		expect(() => parseRalphStateFile(badJson)).toThrow(RalphError);
	});
});

describe("RalphError", () => {
	test("extends Error with descriptive message", () => {
		const err = new RalphError("Validation failed");
		expect(err).toBeInstanceOf(Error);
		expect(err.message).toBe("Validation failed");
	});

	test("includes an errors array from Zod issues", () => {
		try {
			LoopNameSchema.parse("Invalid Name");
		} catch (e) {
			if (e instanceof z.ZodError) {
				const ralphErr = new RalphError("Bad loop name", e.issues);
				expect(Array.isArray(ralphErr.errors)).toBe(true);
				expect(ralphErr.errors).toHaveLength(1);
			}
		}
	});

	test("works without issues array", () => {
		const err = new RalphError("Simple error");
		expect(err.errors).toBeUndefined();
	});
});

// Type-level checks — these compile-time assertions verify the types are shaped correctly
describe("Type exports", () => {
	test("LoopName is a string subtype", () => {
		const name: LoopName = "valid-name";
		expect(typeof name).toBe("string");
	});

	test("ChecklistItem shape is correct at runtime", () => {
		const item: ChecklistItem = { text: "Do work", done: false };
		expect(item.text).toBe("Do work");
		expect(item.done).toBe(false);
	});

	test("RalphTaskFile has all required fields", () => {
		const task: RalphTaskFile = {
			goal: "Test goal",
			deliverable: "Test deliverable",
			checklist: [{ text: "task 1", done: false }],
			headings: ["## Goal"],
		};
		expect(task.goal).toBe("Test goal");
	});

	test("RalphStateFile has all initial state fields", () => {
		const state: RalphStateFile = {
			name: "test-loop",
			source: "source.md",
			taskFile: ".ralph/test-loop.md",
			provider: "pi",
			model: "model-name",
			iteration: 0,
			maxIterations: 10,
			reflectEvery: 3,
			active: false,
			status: StatusEnum.ready,
			lastReflectionAt: 0,
			phase: PhaseEnum.ready,
			awaitingReview: false,
		};
		expect(state.name).toBe("test-loop");
	});

	test("RalphStateFile supports runtime optional fields", () => {
		const state: RalphStateFile = {
			name: "test-loop",
			source: "source.md",
			taskFile: ".ralph/test-loop.md",
			provider: "pi",
			model: "model-name",
			iteration: 5,
			maxIterations: 20,
			reflectEvery: 5,
			active: true,
			status: StatusEnum.in_progress,
			lastReflectionAt: 3,
			phase: PhaseEnum.implementing,
			awaitingReview: false,
			startedAt: Date.now(),
			completedAt: undefined,
			workerRunId: "run-uuid",
			workerItem: "- [ ] task text",
			lastError: "some error",
			pauseReason: null,
		};
		expect(state.workerRunId).toBe("run-uuid");
	});

	test("RalphLockFile shape is correct", () => {
		const lock: RalphLockFile = { pid: 12345 };
		expect(lock.pid).toBe(12345);
	});
});

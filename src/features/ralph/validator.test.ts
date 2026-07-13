import { describe, expect, test } from "bun:test";
import {
	parseTaskFile,
	nextUncheckedTask,
	validateCheckboxChange,
	RalphParseError,
	type ParseResult,
} from "./validator";
import type { RalphTaskFile } from "./schema";

// ─── Test fixtures ────────────────────────────────────────────────────────

const VALID_TASK_FILE = `# Project: refactor-auth

## Goal
Implement authentication module with JWT support.

## Deliverable
Auth service that can issue and verify tokens.

## Task checklist
- [ ] Write tests for JWT encoding
- [ ] Implement JWT encoder
- [ ] Add token verification middleware

## Stale-prompt guard
If you have already implemented any of the unchecked tasks above, re-read this file carefully before proceeding.

## Completion gate
All tasks must be checked and passing their verification steps.

## Iteration protocol
Read this file, pick one unchecked task, implement it with TDD red→green, verify, then check the box.
`;

const VALID_ALL_CHECKED = `# Project: refactor-auth

## Goal
Implement authentication module.

## Deliverable
Auth service.

## Task checklist
- [x] Write tests for JWT encoding
- [x] Implement JWT encoder
- [x] Add token verification middleware

## Stale-prompt guard
If you have already implemented any of the unchecked tasks above, re-read this file carefully before proceeding.

## Completion gate
All tasks must be checked and passing their verification steps.

## Iteration protocol
Read this file, pick one unchecked task, implement it with TDD red→green, verify, then check the box.
`;

const MINIMAL_VALID_TASK_FILE = `## Goal
Do something.

## Deliverable
Something done.

## Task checklist
- [ ] Do the thing

## Stale-prompt guard
Guard text.

## Completion gate
Gate text.

## Iteration protocol
Protocol text.
`;

// ─── parseTaskFile tests ──────────────────────────────────────────────

describe("parseTaskFile", () => {
	test("parses a complete valid task file", () => {
		const result = parseTaskFile(VALID_TASK_FILE);
		expect(result).toBeInstanceOf(Object);
		expect((result as RalphTaskFile).goal).toContain("authentication");
		expect((result as RalphTaskFile).deliverable).toContain("Auth service");
		expect((result as RalphTaskFile).checklist).toHaveLength(3);
		expect((result as RalphTaskFile).checklist[0].done).toBe(false);
		expect((result as RalphTaskFile).checklist[0].text).toBe(
			"Write tests for JWT encoding",
		);
	});

	test("parses minimal valid task file without front-matter", () => {
		const result = parseTaskFile(MINIMAL_VALID_TASK_FILE);
		expect(result).toBeInstanceOf(Object);
		expect((result as RalphTaskFile).goal).toBe("Do something.");
		expect((result as RalphTaskFile).deliverable).toBe("Something done.");
		expect((result as RalphTaskFile).checklist).toHaveLength(1);
		expect((result as RalphTaskFile).headings).toContain("## Goal");
	});

	test("rejects file missing ## Goal heading", () => {
		const withoutGoal = VALID_TASK_FILE.replace(/## Goal\nImplement.+\n/, "");
		const result = parseTaskFile(withoutGoal);
		expect(result).toBeInstanceOf(Error);
		expect((result as Error).message).toContain("## Goal");
	});

	test("rejects file missing ## Deliverable heading", () => {
		const withoutDeliverable = VALID_TASK_FILE.replace(
			/## Deliverable\nAuth.+\n/,
			"",
		);
		const result = parseTaskFile(withoutDeliverable);
		expect(result).toBeInstanceOf(Error);
		expect((result as Error).message).toContain("## Deliverable");
	});

	test("rejects file missing ## Task checklist heading", () => {
		const withoutChecklist = VALID_TASK_FILE.replace(
			/## Task checklist\n[\s\S]+?(?=## Stale-prompt guard)/,
			"",
		);
		const result = parseTaskFile(withoutChecklist);
		expect(result).toBeInstanceOf(Error);
		expect((result as Error).message).toContain("## Task checklist");
	});

	test("rejects file missing ## Stale-prompt guard heading", () => {
		const withoutGuard = VALID_TASK_FILE.replace(
			/## Stale-prompt guard\n[^#]+/,
			"",
		);
		const result = parseTaskFile(withoutGuard);
		expect(result).toBeInstanceOf(Error);
		expect((result as Error).message).toContain("## Stale-prompt guard");
	});

	test("rejects file missing ## Completion gate heading", () => {
		const withoutGate = VALID_TASK_FILE.replace(
			/## Completion gate\n[^#]+/,
			"",
		);
		const result = parseTaskFile(withoutGate);
		expect(result).toBeInstanceOf(Error);
		expect((result as Error).message).toContain("## Completion gate");
	});

	test("rejects file missing ## Iteration protocol heading", () => {
		const withoutProtocol = VALID_TASK_FILE.replace(
			/## Iteration protocol\n[^#]+/,
			"",
		);
		const result = parseTaskFile(withoutProtocol);
		expect(result).toBeInstanceOf(Error);
		expect((result as Error).message).toContain("## Iteration protocol");
	});

	test("rejects file with duplicate headings", () => {
		const duplicated = VALID_TASK_FILE + `\n## Goal\nDuplicate goal section.\n`;
		const result = parseTaskFile(duplicated);
		expect(result).toBeInstanceOf(Error);
		expect((result as Error).message).toContain("duplicate");
	});

	test("rejects file with all tasks checked (no unchecked items on initial creation)", () => {
		const result = parseTaskFile(VALID_ALL_CHECKED);
		expect(result).toBeInstanceOf(Error);
		expect((result as Error).message).toContain("unchecked");
	});

	test("accepts file where only some tasks are checked", () => {
		const partial = VALID_TASK_FILE.replace("- [ ] Implement JWT encoder", "- [x] Implement JWT encoder");
		const result = parseTaskFile(partial);
		expect(result).not.toBeInstanceOf(Error);
		expect((result as RalphTaskFile).checklist[1].done).toBe(true);
	});

	test("rejects empty string", () => {
		const result = parseTaskFile("");
		expect(result).toBeInstanceOf(Error);
	});

	test("extracts content between headings correctly with prose before sections", () => {
		const result = parseTaskFile(VALID_TASK_FILE);
		expect(result).not.toBeInstanceOf(Error);
		const parsed = result as RalphTaskFile;
		expect(parsed.goal).toContain("authentication");
		expect(parsed.deliverable).toContain("tokens");
	});

	test("handles mixed case checkbox markers: [X] should be checked, [ ] unchecked", () => {
		const mixedCase = `## Goal
Test goal.

## Deliverable
Test deliverable.

## Task checklist
- [X] First done task
- [x] Second done task
- [ ] Unchecked task

## Stale-prompt guard
Guard.

## Completion gate
Gate.

## Iteration protocol
Protocol.
`;
		const result = parseTaskFile(mixedCase);
		expect(result).not.toBeInstanceOf(Error);
		const parsed = result as RalphTaskFile;
		expect(parsed.checklist[0].done).toBe(true);
		expect(parsed.checklist[1].done).toBe(true);
		expect(parsed.checklist[2].done).toBe(false);
	});

	test("collects only required headings in the headings array", () => {
		const result = parseTaskFile(VALID_TASK_FILE);
		expect(result).not.toBeInstanceOf(Error);
		const parsed = result as RalphTaskFile;
		expect(parsed.headings).toContain("## Goal");
		expect(parsed.headings).toContain("## Deliverable");
		expect(parsed.headings).toContain("## Task checklist");
	});

	test("rejects empty goal section (heading present but no content)", () => {
		const emptyGoal = `## Goal

## Deliverable
Something.

## Task checklist
- [ ] Do thing

## Stale-prompt guard
Guard.

## Completion gate
Gate.

## Iteration protocol
Protocol.
`;
		const result = parseTaskFile(emptyGoal);
		expect(result).toBeInstanceOf(Error);
	});

	test("rejects empty checklist (heading present but no items)", () => {
		const emptyChecklist = `## Goal
Do something.

## Deliverable
Something done.

## Task checklist

## Stale-prompt guard
Guard.

## Completion gate
Gate.

## Iteration protocol
Protocol.
`;
		const result = parseTaskFile(emptyChecklist);
		expect(result).toBeInstanceOf(Error);
	});
});

// ─── nextUncheckedTask tests ───────────────────────────────────────

describe("nextUncheckedTask", () => {
	function makeParsed(
		items: Array<{ done: boolean; text: string }>,
	): RalphTaskFile {
		return {
			goal: "Test goal",
			deliverable: "Test deliverable",
			checklist: items,
			headings: ["## Goal", "## Deliverable"],
		};
	}

	test("returns first unchecked task", () => {
		const parsed = makeParsed([
			{ done: true, text: "Done task" },
			{ done: false, text: "Pending task" },
			{ done: false, text: "Another pending" },
		]);
		const result = nextUncheckedTask(parsed);
		expect(result).not.toBeNull();
		expect(result!.index).toBe(1);
		expect(result!.text).toBe("Pending task");
	});

	test("returns null when all tasks are checked", () => {
		const parsed = makeParsed([
			{ done: true, text: "Task 1" },
			{ done: true, text: "Task 2" },
		]);
		const result = nextUncheckedTask(parsed);
		expect(result).toBeNull();
	});

	test("returns first item when it's unchecked", () => {
		const parsed = makeParsed([
			{ done: false, text: "First task" },
			{ done: true, text: "Second task" },
		]);
		const result = nextUncheckedTask(parsed);
		expect(result!.index).toBe(0);
		expect(result!.text).toBe("First task");
	});

	test("returns null for empty checklist", () => {
		const parsed = makeParsed([]);
		const result = nextUncheckedTask(parsed);
		expect(result).toBeNull();
	});
});

// ─── validateCheckboxChange tests ──────────────────────────────────

describe("validateCheckboxChange", () => {
	test("accepts when exactly the selected checkbox was checked", () => {
		const before = `## Task checklist
- [ ] Write tests
- [ ] Implement feature
- [ ] Add docs
`;
		const after = `## Task checklist
- [x] Write tests
- [ ] Implement feature
- [ ] Add docs
`;
		const result = validateCheckboxChange(before, after, "Write tests");
		expect(result.success).toBe(true);
	});

	test("rejects when wrong checkbox was checked", () => {
		const before = `## Task checklist
- [ ] Write tests
- [ ] Implement feature
- [ ] Add docs
`;
		const after = `## Task checklist
- [ ] Write tests
- [x] Implement feature
- [ ] Add docs
`;
		const result = validateCheckboxChange(before, after, "Write tests");
		expect(result.success).toBe(false);
	});

	test("rejects when multiple checkboxes changed", () => {
		const before = `## Task checklist
- [ ] Write tests
- [ ] Implement feature
- [ ] Add docs
`;
		const after = `## Task checklist
- [x] Write tests
- [x] Implement feature
- [ ] Add docs
`;
		const result = validateCheckboxChange(before, after, "Write tests");
		expect(result.success).toBe(false);
	});

	test("rejects an unchanged selected item", () => {
		const before = `## Task checklist
- [ ] Write tests
- [ ] Implement feature
`;
		const after = before;
		const result = validateCheckboxChange(before, after, "Write tests");
		expect(result.success).toBe(false);
	});

	test("rejects when a previously checked box was unchecked", () => {
		const before = `## Task checklist
- [x] Write tests
- [ ] Implement feature
`;
		const after = `## Task checklist
- [ ] Write tests
- [ ] Implement feature
`;
		const result = validateCheckboxChange(before, after, "Write tests");
		expect(result.success).toBe(false);
	});

	test("ignores non-checklist content changes", () => {
		const before = `# Project: test

## Task checklist
- [x] Write tests
- [ ] Implement feature
`;
		const after = `# Project: test-changed

## Task checklist
- [x] Write tests
- [ ] Implement feature
`;
		const result = validateCheckboxChange(before, after, "Implement feature");
		expect(result.success).toBe(false);
	});

	test("rejects adding a new checkbox item that wasn't in the original", () => {
		const before = `## Task checklist
- [ ] Write tests
`;
		const after = `## Task checklist
- [x] Write tests
- [ ] Extra task
`;
		const result = validateCheckboxChange(before, after, "Write tests");
		expect(result.success).toBe(false);
	});

	test("rejects removing a checkbox item", () => {
		const before = `## Task checklist
- [ ] Write tests
- [ ] Implement feature
`;
		const after = `## Task checklist
- [x] Write tests
`;
		const result = validateCheckboxChange(before, after, "Write tests");
		expect(result.success).toBe(false);
	});
});

// ─── Type export checks ──────────────────────────────────────────────

describe("Type exports", () => {
	test("ParseResult is discriminated union", () => {
		const parseResult: ParseResult = parseTaskFile(MINIMAL_VALID_TASK_FILE);
		if (!(parseResult instanceof Error)) {
			expect(parseResult.checklist).toBeDefined();
			expect(Array.isArray(parseResult.checklist)).toBe(true);
		}
	});

	test("RalphParseError is a RalphError subclass", () => {
		const err = new RalphParseError("Test error");
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe("RalphParseError");
	});
});

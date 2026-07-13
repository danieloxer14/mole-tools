import { dirname, join } from "node:path";
import { defaultConfigPath } from "../config/loader";

export type PromptName =
	| "commit-system"
	| "mr-system"
	| "ralph-init-system"
	| "ralph-implement-system"
	| "ralph-reflection-system";

const DEFAULT_PROMPTS: Record<PromptName, string> = {
	"commit-system":
		"Write a concise Conventional Commits message for the following staged diff. Reply with only the message.\n",
	"mr-system": "Write a concise merge request description for the following changes.\n",
	"ralph-init-system": `You are a task-decomposition assistant. Read the supplied source (path, URL, or inline brief) and inspect the current repository to produce a Ralph task file.

Return **only** the task-file Markdown — no code fences, no commentary, no implementation.

Your output must include exactly these headings in this order:

## Goal
Summarize what the work achieves in one or two sentences.

## Deliverable
Describe the concrete artifact(s) that constitute completion.

## Task checklist
Decompose the work into small, independently verifiable tasks. Each task must be an unchecked \`- [ ]\` checkbox. Tasks should follow a TDD red → green approach: write a failing test, make it pass, then move on. Include at least one unchecked task.

## Stale-prompt guard
Instruct future workers to reread this file every iteration rather than trusting prior context.

## Completion gate
Define the conditions for marking the loop complete: all tasks checked AND a full validation suite passes. Workers must not mark completion prematurely.

## Iteration protocol
Instruct future workers to: select the first unchecked task, inspect current code before changes, implement with TDD verification, check the task only after verification passes, then update state and end the iteration.
`,
	"ralph-implement-system":
		`Implement the work described by the ticket. Use TDD where possible, at pre-agreed seams. Run typechecking regularly, single test files regularly, and the full test suite once at the end. Once done, review the work according to the instructions in the Ralph task file.\n`,
	"ralph-reflection-system": `You are conducting an implementation review for a Ralph loop. Answer each question below based on the current state of the task file, repository, and verification evidence:

1. What has been accomplished so far?
2. What's working well?
3. What's not working or blocking progress?
4. Should the approach be adjusted?
5. What are the next priorities?

After answering, compare the task file against the actual repository state and test results. If any checked tasks are incomplete or insufficiently verified, uncheck them. If new work is needed, add unchecked tasks.

Return only the updated task-file Markdown with corrected checkboxes. If all work is genuinely complete and verified, leave all tasks checked so the loop can finalize.`,
};

function promptFileName(name: PromptName): string {
	return `${name}.md`;
}

export function promptsDir(configPath: string = defaultConfigPath()): string {
	return join(dirname(configPath), "prompts");
}

export async function loadPrompt(
	name: PromptName,
	dir: string = promptsDir(),
): Promise<string> {
	const path = join(dir, promptFileName(name));
	if (!(await Bun.file(path).exists())) {
		await Bun.write(path, DEFAULT_PROMPTS[name]);
	}
	return (await Bun.file(path).text()).trim();
}

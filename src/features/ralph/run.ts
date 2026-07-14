import type { Context } from "../../core/context";
import { UnsupportedCapabilityError } from "../../ports/llm";
import { loadPrompt } from "../../adapters/prompts/loader";
import { z } from "zod";
import { LoopNameSchema, PhaseEnum, StatusEnum, type RalphStateFile } from "./schema";
import { createLock, discardSnapshot, readState, readTaskFile, restoreSnapshot, snapshotTaskFile, writeState, type LockHandle } from "./persistence";
import { nextUncheckedTask, parseTaskFile, validateCheckboxChange, RalphParseError } from "./validator";

export const ralphRunArgs = z.object({ name: LoopNameSchema, maxIterations: z.coerce.number().int().min(1).optional() });
export type RalphRunArgs = z.infer<typeof ralphRunArgs>;
export interface RalphRunResult { name: string; status: "ready_for_reflection" | "paused" | "completed"; iteration: number }
export class RalphRunError extends Error {
	constructor(message: string, readonly result?: RalphRunResult) { super(message); this.name = "RalphRunError"; }
}
function diagnostic(result: { stderr?: string; output?: string }, fallback: string): string {
	const text = result.stderr?.trim() || result.output?.trim() || fallback;
	return text.length > 2000 ? text.slice(-2000) : text;
}
function taskRequest(taskFile: string, selected: string): string {
	return ["**Select** the first unchecked task (`- [ ]`) in the Task checklist above and implement the tasks until you reach the end of a ticket.", "Resume from already-checked tasks; do not redo them.", "Inspect the workspace and verify your changes with appropriate tests.", "Update the checklist immediately as each task is completed and verified. This records progress for recovery if the process fails or quits; do not defer checklist updates until the ticket ends.", `First unchecked task: ${selected}`, "\nRalph task file:\n", taskFile].join("\n");
}
function reflectionRequest(taskFile: string): string {
	return ["Review the current Ralph loop implementation and task plan.", "Use the repository and verification evidence, then update the task file when necessary.", "You may uncheck inadequate tasks or add new unchecked tasks, but preserve all required headings and checklist meaning.", "\nRalph task file:\n", taskFile].join("\n");
}
function assertTaskPath(name: string, state: RalphStateFile): void {
	if (state.taskFile !== `.ralph/${name}.md`) throw new Error(`State task path mismatch: expected .ralph/${name}.md`);
}

export async function runRalphRun(ctx: Context, input: RalphRunArgs): Promise<RalphRunResult> {
	const args = ralphRunArgs.parse(input);
	let state = await readState(args.name);
	assertTaskPath(args.name, state);
	const raw = await readTaskFile(args.name);
	if (raw === null) throw new Error(`Task file not found for "${args.name}"`);
	const parsed = parseTaskFile(raw, { allowCompleted: true });
	if (parsed instanceof RalphParseError) throw parsed;
	if (args.maxIterations !== undefined) {
		if (args.maxIterations <= state.maxIterations) throw new Error(`--maxIterations must be greater than the persisted cap (${state.maxIterations})`);
		state = { ...state, maxIterations: args.maxIterations };
		await writeState(args.name, state);
	}
	if (state.status === StatusEnum.completed) {
		await ctx.ui.info(`Ralph loop "${args.name}" is already completed.`);
		return { name: args.name, status: "completed", iteration: state.iteration };
	}
	const llm = ctx.getLlmFor("ralph", state.models.implement.provider);
	if (!llm.capabilities().includes("agentic-workspace")) throw new UnsupportedCapabilityError("agentic-workspace", state.models.implement.provider);
	if (!ctx.getLlmFor("ralph", state.models.reflect.provider).capabilities().includes("agentic-workspace")) throw new UnsupportedCapabilityError("agentic-workspace", state.models.reflect.provider);
	const runId = crypto.randomUUID();
	let lock: LockHandle = createLock(args.name, runId);
	let activeAbort: AbortController | null = null;
	let interrupted = false;
	const onInterrupt = () => { interrupted = true; activeAbort?.abort(); };
	process.once("SIGINT", onInterrupt);

	const pause = async (reason: "reflection_failed" | "interrupted" | "max_iterations_reached", error?: string) => {
		state = { ...state, active: false, status: StatusEnum.paused, phase: PhaseEnum.paused, pauseReason: reason, lastError: error ?? state.lastError };
		await writeState(args.name, state);
	};
	const reflect = async (finalReview: boolean): Promise<"reopened" | "complete"> => {
		const before = await readTaskFile(args.name);
		if (before === null) throw new Error(`Task file disappeared for "${args.name}"`);
		snapshotTaskFile(args.name);
		state = { ...state, phase: PhaseEnum.reflecting, awaitingReview: finalReview, ...(finalReview ? { status: StatusEnum.completed } : {}) };
		await writeState(args.name, state);
		const prompt = await loadPrompt("ralph-reflection-system");
		await ctx.ui.info(`Reflecting Ralph loop with ${state.models.reflect.name}…`, { spinner: true });
		activeAbort = new AbortController();
		let result: { ok: boolean; output: string; stderr?: string };
		try {
			result = await ctx.llm.runAgent({ purpose: "ralph", providerKey: state.models.reflect.provider, model: state.models.reflect.name, workspace: process.cwd(), permissionPolicy: "auto-approve", systemPromptMode: "append", prompt: `${prompt}\n\n${reflectionRequest(before)}`, signal: activeAbort.signal, onProgress: (message) => { void ctx.ui.info(message, { spinner: true, terminal: true }); } });
		} catch (error) {
			result = { ok: false, output: "", stderr: error instanceof Error ? error.message : String(error) };
		} finally { activeAbort = null; }
		if (interrupted) {
			await pause("interrupted");
			throw new RalphRunError("Ralph run interrupted", { name: args.name, status: "paused", iteration: state.iteration });
		}
		const after = await readTaskFile(args.name);
		const checked = after === null ? new RalphParseError("Task file disappeared") : parseTaskFile(after, { allowCompleted: true });
		if (!result.ok || after === null || checked instanceof RalphParseError) {
			const error = !result.ok ? diagnostic(result, "Reflection failed") : checked instanceof RalphParseError ? checked.message : "Invalid reflection task file";
			restoreSnapshot(args.name);
			await pause("reflection_failed", error);
			throw new RalphRunError(error, { name: args.name, status: "paused", iteration: state.iteration });
		}
		discardSnapshot(args.name);
		const hasWork = nextUncheckedTask(checked) !== null;
		state = { ...state, lastReflectionAt: state.iteration, awaitingReview: false, lastError: null, ...(hasWork ? { active: true, status: StatusEnum.in_progress, phase: PhaseEnum.implementing, pauseReason: null } : finalReview ? { active: false, status: StatusEnum.completed, phase: PhaseEnum.completed, completedAt: Date.now(), pauseReason: null } : { phase: PhaseEnum.implementing }) };
		await writeState(args.name, state);
		return hasWork ? "reopened" : "complete";
	};

	try {
		state = { ...state, active: true, status: StatusEnum.in_progress, phase: PhaseEnum.implementing, startedAt: state.startedAt ?? Date.now(), workerRunId: runId, lastError: null, pauseReason: null };
		await writeState(args.name, state);
		const systemPrompt = await loadPrompt("ralph-implement-system");
		while (true) {
			if (interrupted) { await pause("interrupted"); throw new RalphRunError("Ralph run interrupted", { name: args.name, status: "paused", iteration: state.iteration }); }
			const before = await readTaskFile(args.name);
			if (before === null) throw new Error(`Task file disappeared for "${args.name}"`);
			const beforeParsed = parseTaskFile(before, { allowCompleted: true });
			if (beforeParsed instanceof RalphParseError) throw beforeParsed;
			const selected = nextUncheckedTask(beforeParsed);
			if (!selected) {
				const outcome = await reflect(true);
				if (outcome === "complete") return { name: args.name, status: "completed", iteration: state.iteration };
				continue;
			}
			if (state.iteration >= state.maxIterations) {
				await pause("max_iterations_reached");
				const message = `Maximum iterations reached. Resume with --maxIterations ${state.maxIterations + 1}`;
				await ctx.ui.warn(message);
				throw new RalphRunError(message, { name: args.name, status: "paused", iteration: state.iteration });
			}
			snapshotTaskFile(args.name);
			state = { ...state, workerItem: `- [ ] ${selected.text}`, phase: PhaseEnum.implementing };
			await writeState(args.name, state);
			await ctx.ui.info(`Iteration ${state.iteration + 1}/${state.maxIterations} — ${selected.text}`, { spinner: true });
			activeAbort = new AbortController();
			let result: { ok: boolean; output: string; stderr?: string };
			try { result = await ctx.llm.runAgent({ purpose: "ralph", providerKey: state.models.implement.provider, model: state.models.implement.name, workspace: process.cwd(), permissionPolicy: "auto-approve", systemPromptMode: "append", prompt: `${systemPrompt}\n\n${taskRequest(before, selected.text)}`, signal: activeAbort.signal, onProgress: (message) => { void ctx.ui.info(message, { spinner: true, terminal: true }); } }); }
			catch (error) { result = { ok: false, output: "", stderr: error instanceof Error ? error.message : String(error) }; }
			activeAbort = null;
			if (interrupted) { await pause("interrupted"); throw new RalphRunError("Ralph run interrupted", { name: args.name, status: "paused", iteration: state.iteration }); }
			const after = await readTaskFile(args.name);
			const afterParsed = after === null ? new RalphParseError("Task file disappeared") : parseTaskFile(after, { allowCompleted: true });
			const changedCorrectly = result.ok && after !== null && !(afterParsed instanceof RalphParseError) && validateCheckboxChange(before, after, selected.text).success && afterParsed.checklist[selected.index]?.done === true;
			state = { ...state, iteration: state.iteration + 1, lastError: changedCorrectly ? null : (!result.ok ? diagnostic(result, "Agent failed") : afterParsed instanceof RalphParseError ? afterParsed.message : "Worker changed the wrong checklist item or made no change") };
			if (!changedCorrectly) { restoreSnapshot(args.name); await writeState(args.name, state); await ctx.ui.warn(`Iteration failed; retrying: ${state.lastError}`); }
			else { discardSnapshot(args.name); await writeState(args.name, state); await ctx.ui.info(`Iteration ${state.iteration} verified.`); }
			if (state.reflectEvery > 0 && state.iteration % state.reflectEvery === 0) await reflect(false);
		}
	} finally { process.removeListener("SIGINT", onInterrupt); lock.release(); }
}
export const runRalph = runRalphRun;

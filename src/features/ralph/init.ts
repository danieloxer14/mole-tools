import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { loadPrompt } from "../../adapters/prompts/loader";
import type { Context } from "../../core/context";
import { UnsupportedCapabilityError } from "../../ports/llm";
import { parseTaskFile, RalphParseError } from "./validator";
import { checkCollision, removeLoopArtifacts, writeState, writeTaskFile } from "./persistence";
import { LoopNameSchema, PhaseEnum, StatusEnum, type RalphStateFile } from "./schema";

export const ralphInitArgs = z.object({
	name: LoopNameSchema,
	source: z.string().trim().min(1, "Source must not be empty"),
	maxIterations: z.coerce.number().int().min(1).default(20),
	reflectEvery: z.coerce.number().int().min(0).default(5),
});
export type RalphInitArgs = z.infer<typeof ralphInitArgs>;
export type SourceKind = "local" | "url" | "inline";
export interface ClassifiedSource { kind: SourceKind; value: string }
export function classifySource(source: string, cwd = process.cwd()): ClassifiedSource {
	if (/^https?:\/\//i.test(source)) return { kind: "url", value: source };
	const resolved = resolve(cwd, source);
	if (existsSync(resolved)) return { kind: "local", value: resolved };
	return { kind: "inline", value: source };
}
export interface RalphInitResult { name: string; taskPath: string; statePath: string; models: RalphStateFile["models"] }
function generationRequest(source: ClassifiedSource): string {
	return ["Generate the Ralph task file for this source.", `Source kind: ${source.kind}`, `Source: ${source.value}`, "Inspect the repository from the workspace as needed."].join("\n");
}

export async function runRalphInit(ctx: Context, input: RalphInitArgs): Promise<RalphInitResult> {
	const args = ralphInitArgs.parse(input);
	checkCollision(args.name);
	const defaults = ctx.config.models.ralph;
	const names = {
		init: await ctx.ui.editText("Task generation model (init)?", defaults.init.name),
		implement: await ctx.ui.editText("Implementation model (implement)?", defaults.implement.name),
		reflect: await ctx.ui.editText("Reflection model (reflect)?", defaults.reflect.name),
	};
	const models = {
		init: { provider: defaults.init.provider, name: z.string().trim().min(1, "Model name is required").parse(names.init) },
		implement: { provider: defaults.implement.provider, name: z.string().trim().min(1, "Model name is required").parse(names.implement) },
		reflect: { provider: defaults.reflect.provider, name: z.string().trim().min(1, "Model name is required").parse(names.reflect) },
	};
	const llm = ctx.getLlmFor("ralph", models.init.provider);
	if (!llm.capabilities().includes("agentic-workspace")) throw new UnsupportedCapabilityError("agentic-workspace", models.init.provider);
	const systemPrompt = await loadPrompt("ralph-init-system");
	const source = classifySource(args.source);
	await ctx.ui.info(`Generating Ralph task file with ${models.init.name}…`, { spinner: true });
	const result = await llm.runAgent({ purpose: "ralph", providerKey: models.init.provider, model: models.init.name, workspace: process.cwd(), permissionPolicy: "auto-approve", systemPromptMode: "replace", prompt: `${systemPrompt}\n\n${generationRequest(source)}`, onProgress: (message) => { void ctx.ui.info(message, { spinner: true }); } });
	if (!result.ok) throw new Error(result.stderr?.trim() || "Ralph task generation failed");
	if (!result.output.trim()) throw new Error("Ralph task generation returned empty output");
	const parsed = parseTaskFile(result.output);
	if (parsed instanceof RalphParseError) throw parsed;
	const state: RalphStateFile = { name: args.name, source: args.source, taskFile: `.ralph/${args.name}.md`, models, iteration: 0, maxIterations: args.maxIterations, reflectEvery: args.reflectEvery, active: false, status: StatusEnum.ready, lastReflectionAt: 0, phase: PhaseEnum.ready, awaitingReview: false };
	try { await writeTaskFile(args.name, result.output); await writeState(args.name, state); }
	catch (error) { await removeLoopArtifacts(args.name); throw error; }
	const taskPath = `.ralph/${args.name}.md`;
	const statePath = `.ralph/${args.name}.state.json`;
	await ctx.ui.info(`Created ${taskPath}`); await ctx.ui.info(`Created ${statePath}`);
	return { name: args.name, taskPath, statePath, models };
}

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { loadPrompt } from "../../adapters/prompts/loader";
import { resolveLlmProvider } from "../../adapters/config/schema";
import type { Context } from "../../core/context";
import { UnsupportedCapabilityError } from "../../ports/llm";
import { parseTaskFile, RalphParseError } from "./validator";
import { checkCollision, removeLoopArtifacts, writeState, writeTaskFile } from "./persistence";
import { LoopNameSchema, PhaseEnum, StatusEnum, type RalphStateFile } from "./schema";

export const ralphInitArgs = z.object({
	name: LoopNameSchema,
	source: z.string().trim().min(1, "Source must not be empty"),
	model: z.string().trim().min(1, "Model is required"),
	maxIterations: z.coerce.number().int().min(1).default(20),
	reflectEvery: z.coerce.number().int().min(0).default(5),
});

export type RalphInitArgs = z.infer<typeof ralphInitArgs>;

export type SourceKind = "local" | "url" | "inline";

export interface ClassifiedSource {
	kind: SourceKind;
	value: string;
}

/** Classify a source without asking the provider to do any work. */
export function classifySource(source: string, cwd = process.cwd()): ClassifiedSource {
	if (/^https?:\/\//i.test(source)) return { kind: "url", value: source };
	const resolved = resolve(cwd, source);
	if (existsSync(resolved)) return { kind: "local", value: resolved };
	return { kind: "inline", value: source };
}

export interface RalphInitResult {
	name: string;
	taskPath: string;
	statePath: string;
	provider: string;
	model: string;
}

function generationRequest(source: ClassifiedSource): string {
	return [
		"Generate the Ralph task file for this source.",
		`Source kind: ${source.kind}`,
		`Source: ${source.value}`,
		"Inspect the repository from the workspace as needed.",
	].join("\n");
}

/** Create a durable Ralph loop from an agent-generated task file. */
export async function runRalphInit(
	ctx: Context,
	input: RalphInitArgs,
): Promise<RalphInitResult> {
	const args = ralphInitArgs.parse(input);

	// Collision checks deliberately happen before prompt loading or provider work.
	checkCollision(args.name);

	const resolved = resolveLlmProvider(ctx.config, "ralph");
	const llm = ctx.getLlmFor("ralph");
	if (!llm.capabilities().includes("agentic-workspace")) {
		throw new UnsupportedCapabilityError(
			"agentic-workspace",
			resolved.providerKey,
		);
	}

	const systemPrompt = await loadPrompt("ralph-init-system");
	const source = classifySource(args.source);
	const result = await llm.runAgent({
		purpose: "ralph",
		model: args.model,
		workspace: process.cwd(),
		permissionPolicy: "auto-approve",
		systemPromptMode: "replace",
		prompt: `${systemPrompt}\n\n${generationRequest(source)}`,
	});

	if (!result.ok) {
		throw new Error(result.stderr?.trim() || "Ralph task generation failed");
	}
	if (!result.output.trim()) throw new Error("Ralph task generation returned empty output");

	const parsed = parseTaskFile(result.output);
	if (parsed instanceof RalphParseError) throw parsed;

	const state: RalphStateFile = {
		name: args.name,
		source: args.source,
		taskFile: `.ralph/${args.name}.md`,
		provider: resolved.providerKey,
		model: args.model,
		iteration: 0,
		maxIterations: args.maxIterations,
		reflectEvery: args.reflectEvery,
		active: false,
		status: StatusEnum.ready,
		lastReflectionAt: 0,
		phase: PhaseEnum.ready,
		awaitingReview: false,
	};

	try {
		await writeTaskFile(args.name, result.output);
		await writeState(args.name, state);
	} catch (error) {
		// The two artifacts form one init transaction. Never leave a partial loop.
		await removeLoopArtifacts(args.name);
		throw error;
	}

	const taskPath = `.ralph/${args.name}.md`;
	const statePath = `.ralph/${args.name}.state.json`;
	await ctx.ui.info(`Created ${taskPath}`);
	await ctx.ui.info(`Created ${statePath}`);
	return { name: args.name, taskPath, statePath, provider: resolved.providerKey, model: args.model };
}

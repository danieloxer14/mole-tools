import {
	CODEX_EFFORTS_BY_MODEL,
	type CodexEffort,
} from "./effort";

export interface CodexModelChoice {
	id: string;
	label: string;
	efforts: CodexEffort[];
}

export interface CodexModelCatalogProcessOptions {
	cwd: string;
	timeoutMs: number;
	maxOutputBytes: number;
	signal: AbortSignal;
}

export interface CodexModelCatalogProcessResult {
	stdout: Uint8Array;
	stderr: Uint8Array;
	exitCode: number;
}

export type CodexModelCatalogProcessRunner = (
	binary: string,
	args: readonly string[],
	options: CodexModelCatalogProcessOptions,
) => Promise<CodexModelCatalogProcessResult>;

export const CODEX_MODEL_DISCOVERY_TIMEOUT_MS = 2_000;
export const CODEX_MODEL_DISCOVERY_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

const CODEX_MODEL_DISCOVERY_ARGS = ["debug", "models"] as const;
const EMPTY_OUTPUT = new Uint8Array(0);

export function parseCodexModelCatalog(output: string): CodexModelChoice[] {
	let catalog: unknown;
	try {
		catalog = JSON.parse(output);
	} catch {
		throw new Error("Codex debug models returned malformed JSON");
	}

	const entries = Array.isArray(catalog)
		? catalog
		: isRecord(catalog) && Array.isArray(catalog.models)
			? catalog.models
			: null;
	if (!entries)
		throw new Error("Codex debug models returned a malformed catalog");

	const seen = new Set<string>();
	const choices: CodexModelChoice[] = [];
	for (const entry of entries) {
		if (
			!isRecord(entry) ||
			typeof entry.slug !== "string" ||
			typeof entry.display_name !== "string" ||
			entry.visibility !== "list"
		)
			continue;

		const id = entry.slug;
		const label = entry.display_name;
		if (!id.trim() || !label.trim() || seen.has(id)) continue;
		seen.add(id);
		choices.push({
			id,
			label,
			efforts: supportedEfforts(id, entry.supported_reasoning_levels),
		});
	}
	return choices;
}

export async function discoverCodexModels(
	binary: string,
	cwd: string,
	runner: CodexModelCatalogProcessRunner = runCodexModelCatalogProcess,
	timeoutMs = CODEX_MODEL_DISCOVERY_TIMEOUT_MS,
): Promise<CodexModelChoice[]> {
	const controller = new AbortController();
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const command = (async () => {
		const result = await runner(binary, CODEX_MODEL_DISCOVERY_ARGS, {
			cwd,
			timeoutMs,
			maxOutputBytes: CODEX_MODEL_DISCOVERY_MAX_OUTPUT_BYTES,
			signal: controller.signal,
		});
		if (
			result.stdout.byteLength + result.stderr.byteLength >
			CODEX_MODEL_DISCOVERY_MAX_OUTPUT_BYTES
		)
			throw new Error("Codex model catalog output exceeded 2 MiB");
		if (result.exitCode !== 0)
			throw new Error(
				`Codex debug models exited with code ${result.exitCode}`,
			);

		let output: string;
		try {
			output = new TextDecoder("utf-8", { fatal: true }).decode(result.stdout);
		} catch {
			throw new Error("Codex debug models output was not valid UTF-8");
		}
		return parseCodexModelCatalog(output);
	})();
	const timeout = new Promise<CodexModelChoice[]>((_, reject) => {
		timeoutId = setTimeout(() => {
			controller.abort();
			reject(
				new Error(`Codex debug models timed out after ${timeoutMs} ms`),
			);
		}, timeoutMs);
	});

	try {
		return await Promise.race([command, timeout]);
	} finally {
		clearTimeout(timeoutId);
	}
}

function supportedEfforts(
	modelId: string,
	metadata: unknown,
): CodexEffort[] {
	if (!Array.isArray(metadata)) return [];
	const reported = new Set<string>();
	for (const level of metadata) {
		if (isRecord(level) && typeof level.effort === "string")
			reported.add(level.effort);
	}

	const safeEfforts =
		CODEX_EFFORTS_BY_MODEL[
			modelId as keyof typeof CODEX_EFFORTS_BY_MODEL
		];
	return safeEfforts?.filter((effort) => reported.has(effort)) ?? [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

async function runCodexModelCatalogProcess(
	binary: string,
	args: readonly string[],
	options: CodexModelCatalogProcessOptions,
): Promise<CodexModelCatalogProcessResult> {
	if (options.signal.aborted)
		throw new Error("Codex model discovery was aborted");

	const child = Bun.spawn([binary, ...args], {
		cwd: options.cwd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	let failure: Error | undefined;
	const { promise: failureSignal, reject: rejectFailure } =
		Promise.withResolvers<never>();
	const terminate = (error: Error) => {
		if (failure) return;
		failure = error;
		try {
			child.kill("SIGKILL");
		} catch {
			// The process may already have exited.
		}
		rejectFailure(error);
	};
	const onAbort = () =>
		terminate(new Error("Codex model discovery was aborted"));
	options.signal.addEventListener("abort", onAbort, { once: true });
	const outputBudget = {
		used: 0,
		max: options.maxOutputBytes,
	};

	try {
		const [stdout, stderr, exitCode] = await Promise.race([
			Promise.all([
				collectBoundedOutput(child.stdout, outputBudget, terminate),
				collectBoundedOutput(child.stderr, outputBudget, terminate),
				child.exited,
			]),
			failureSignal,
		]);
		if (failure) throw failure;
		return { stdout, stderr, exitCode };
	} catch (error) {
		const processError =
			error instanceof Error
				? error
				: new Error("Codex model catalog process failed");
		if (!failure) terminate(processError);
		throw failure ?? processError;
	} finally {
		options.signal.removeEventListener("abort", onAbort);
	}
}

async function collectBoundedOutput(
	stream: ReadableStream<Uint8Array>,
	budget: { used: number; max: number },
	terminate: (error: Error) => void,
): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	let byteLength = 0;

	try {
		for await (const chunk of stream) {
			if (budget.used + chunk.byteLength > budget.max)
				throw new Error("Codex model catalog output exceeded 2 MiB");
			budget.used += chunk.byteLength;
			byteLength += chunk.byteLength;
			chunks.push(chunk);
		}
	} catch (error) {
		const streamError =
			error instanceof Error
				? error
				: new Error("Unable to read Codex model catalog output");
		terminate(streamError);
		throw streamError;
	}

	if (chunks.length === 0) return EMPTY_OUTPUT;
	if (chunks.length === 1) return chunks[0] ?? EMPTY_OUTPUT;
	const output = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

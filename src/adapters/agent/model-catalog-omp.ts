import { z } from "zod";
import { isAgentEffort, OMP_EFFORTS, type OmpEffort } from "./effort";

const OMP_MODEL_CATALOG_SCHEMA = z.object({
	models: z.array(
		z.object({
			selector: z.string().trim().min(1),
			thinking: z.array(z.string()),
		}),
	),
});

export type OmpModelEffort = OmpEffort;

export interface OmpModelCatalogEntry {
	id: string;
	label: string;
	efforts: OmpModelEffort[];
}

export interface OmpModelCatalogConfig {
	review?: {
		agent?: "omp" | "claude";
		binary?: string;
	};
}

export interface OmpModelCatalogProcessOptions {
	cwd: string;
	timeoutMs: number;
	maxOutputBytes: number;
}

export interface OmpModelCatalogProcessResult {
	stdout: Uint8Array;
	stderr: Uint8Array;
	exitCode: number;
}

export type OmpModelCatalogProcessRunner = (
	binary: string,
	args: readonly string[],
	options: OmpModelCatalogProcessOptions,
) => Promise<OmpModelCatalogProcessResult>;

export const OMP_MODEL_CATALOG_TIMEOUT_MS = 5_000;
export const OMP_MODEL_CATALOG_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

const OMP_MODEL_CATALOG_ARGS = ["models", "--json"] as const;
const EMPTY_OUTPUT = new Uint8Array(0);

export function resolveOmpModelCatalogBinary(
	config: OmpModelCatalogConfig,
): string {
	return config.review?.agent === "omp"
		? (config.review.binary ?? "omp")
		: "omp";
}

export async function discoverOmpModels(
	config: OmpModelCatalogConfig,
	runner: OmpModelCatalogProcessRunner = runOmpModelCatalogProcess,
): Promise<OmpModelCatalogEntry[]> {
	const result = await runner(
		resolveOmpModelCatalogBinary(config),
		OMP_MODEL_CATALOG_ARGS,
		{
			cwd: process.cwd(),
			timeoutMs: OMP_MODEL_CATALOG_TIMEOUT_MS,
			maxOutputBytes: OMP_MODEL_CATALOG_MAX_OUTPUT_BYTES,
		},
	);

	if (result.stdout.byteLength > OMP_MODEL_CATALOG_MAX_OUTPUT_BYTES)
		throw new Error("OMP model catalog stdout exceeded 2 MiB");
	if (result.stderr.byteLength > OMP_MODEL_CATALOG_MAX_OUTPUT_BYTES)
		throw new Error("OMP model catalog stderr exceeded 2 MiB");
	if (result.exitCode !== 0)
		throw new Error(`OMP models --json exited with code ${result.exitCode}`);

	let decoded: string;
	try {
		decoded = new TextDecoder("utf-8", { fatal: true }).decode(result.stdout);
	} catch {
		throw new Error("OMP model catalog stdout was not valid UTF-8");
	}

	let response: unknown;
	try {
		response = JSON.parse(decoded) as unknown;
	} catch {
		throw new Error("OMP models --json returned malformed JSON");
	}
	return parseOmpModelCatalog(response);
}

async function runOmpModelCatalogProcess(
	binary: string,
	args: readonly string[],
	options: OmpModelCatalogProcessOptions,
): Promise<OmpModelCatalogProcessResult> {
	const child = Bun.spawn([binary, ...args], {
		cwd: options.cwd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		detached: process.platform !== "win32",
	});
	let failure: Error | undefined;
	const { promise: failureSignal, reject: rejectFailure } =
		Promise.withResolvers<never>();
	const terminate = (error: Error) => {
		if (failure) return;
		failure = error;
		try {
			if (process.platform !== "win32") {
				try {
					process.kill(-child.pid, "SIGKILL");
					rejectFailure(error);
					return;
				} catch {
					// Fall back to killing the direct child if group signaling is unavailable.
				}
			}
			child.kill("SIGKILL");
		} catch {
			// The operation still fails at its deadline if the process already exited.
		}
		rejectFailure(error);
	};
	const timeout = setTimeout(
		() =>
			terminate(
				new Error(`OMP models --json timed out after ${options.timeoutMs} ms`),
			),
		options.timeoutMs,
	);

	try {
		const [stdout, stderr, exitCode] = await Promise.race([
			Promise.all([
				collectBoundedOutput(
					child.stdout,
					"stdout",
					options.maxOutputBytes,
					terminate,
				),
				collectBoundedOutput(
					child.stderr,
					"stderr",
					options.maxOutputBytes,
					terminate,
				),
				child.exited,
			]),
			failureSignal,
		]);

		if (failure) throw failure;
		return { stdout, stderr, exitCode };
	} catch (error) {
		const processError =
			error instanceof Error ? error : new Error("OMP model catalog failed");
		if (!failure) terminate(processError);
		throw failure ?? processError;
	} finally {
		clearTimeout(timeout);
	}
}

async function collectBoundedOutput(
	stream: ReadableStream<Uint8Array>,
	name: "stdout" | "stderr",
	maxBytes: number,
	terminate: (error: Error) => void,
): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	let byteLength = 0;

	try {
		for await (const chunk of stream) {
			if (byteLength + chunk.byteLength > maxBytes)
				throw new Error(`OMP model catalog ${name} exceeded 2 MiB`);
			chunks.push(chunk);
			byteLength += chunk.byteLength;
		}
	} catch (error) {
		const streamError =
			error instanceof Error
				? error
				: new Error(`Unable to read OMP model catalog ${name}`);
		terminate(streamError);
		throw streamError;
	}

	if (chunks.length === 0) return EMPTY_OUTPUT;
	const onlyChunk = chunks[0];
	if (onlyChunk !== undefined) return onlyChunk;

	const output = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

function parseOmpModelCatalog(value: unknown): OmpModelCatalogEntry[] {
	const parsed = OMP_MODEL_CATALOG_SCHEMA.safeParse(value);
	if (!parsed.success)
		throw new Error("OMP model catalog has an invalid shape");

	const byId = new Map<string, Set<OmpModelEffort>>();
	for (const candidate of parsed.data.models) {
		const id = candidate.selector;
		let efforts = byId.get(id);
		if (!efforts) {
			efforts = new Set<OmpModelEffort>();
			byId.set(id, efforts);
		}
		for (const effort of candidate.thinking) {
			if (isAgentEffort("omp", effort)) efforts.add(effort);
		}
	}

	return [...byId].map(([id, efforts]) => ({
		id,
		label: id,
		efforts: OMP_EFFORTS.filter((effort) => efforts.has(effort)),
	}));
}

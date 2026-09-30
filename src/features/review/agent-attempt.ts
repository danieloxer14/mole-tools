import { rm } from "node:fs/promises";
import type { AgentEvent, ReviewAgent } from "../../ports/review-agent";

export interface AgentOutputSchema<T> {
	safeParse(
		value: unknown,
	):
		| { success: true; data: T }
		| { success: false; error: { message: string } };
}

interface AgentEventFailure {
	error: string;
}

interface AgentEventAttempt {
	iterator: AsyncIterator<AgentEvent>;
	result: Promise<AgentEventFailure | null>;
}

function consumeAgentAttempt(
	iterable: AsyncIterable<AgentEvent>,
): AgentEventAttempt {
	const iterator = iterable[Symbol.asyncIterator]();
	const result = (async (): Promise<AgentEventFailure | null> => {
		let agentError: string | null = null;
		try {
			while (true) {
				const next = await iterator.next();
				if (next.done) return agentError ? { error: agentError } : null;
				if (next.value.kind === "error") agentError = next.value.message;
			}
		} catch (error) {
			return {
				error: error instanceof Error ? error.message : String(error),
			};
		}
	})();
	return { iterator, result };
}

export type AgentFileAttempt<T> =
	| { ok: true; doc: T }
	| { ok: false; kind: "agent" | "output"; error: string };

export function agentAttemptTimeoutSeconds(
	config:
		| {
				review?: { layerTimeoutSeconds?: number };
		  }
		| undefined,
): number {
	const configured = config?.review?.layerTimeoutSeconds;
	return typeof configured === "number" &&
		Number.isFinite(configured) &&
		configured > 0
		? configured
		: 600;
}

export async function runAgentFileAttempt<T>(options: {
	agent: ReviewAgent;
	cwd: string;
	systemPromptFile: string;
	message: string;
	writeDir: string;
	outputPath: string;
	timeoutSeconds: number;
	signal?: AbortSignal;
	label: string;
	schema: AgentOutputSchema<T>;
}): Promise<AgentFileAttempt<T>> {
	await rm(options.outputPath, { force: true });
	const controller = new AbortController();
	const { promise: cancelled, resolve: resolveCancelled } =
		Promise.withResolvers<"cancelled">();
	const handleParentAbort = () => {
		controller.abort();
		resolveCancelled("cancelled");
	};
	if (options.signal?.aborted) handleParentAbort();
	else
		options.signal?.addEventListener("abort", handleParentAbort, {
			once: true,
		});

	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	try {
		const { iterator, result } = consumeAgentAttempt(
			options.agent.run({
				cwd: options.cwd,
				systemPromptFile: options.systemPromptFile,
				message: options.message,
				writeDir: options.writeDir,
				signal: controller.signal,
			}),
		);
		const { promise: timedOut, resolve: resolveTimedOut } =
			Promise.withResolvers<"timeout">();
		timeoutId = setTimeout(() => {
			controller.abort();
			resolveTimedOut("timeout");
		}, options.timeoutSeconds * 1000);
		const outcome = await Promise.race([result, timedOut, cancelled]);
		if (outcome === "timeout" || outcome === "cancelled") {
			try {
				void Promise.resolve(iterator.return?.()).catch(() => undefined);
			} catch {
				// Iterator cleanup must not delay a failed generation.
			}
			return {
				ok: false,
				kind: "agent",
				error:
					outcome === "cancelled"
						? `${options.label} run was cancelled`
						: `${options.label} agent timed out after ${options.timeoutSeconds} seconds`,
			};
		}
		if (outcome) return { ok: false, kind: "agent", error: outcome.error };
	} catch (error) {
		return {
			ok: false,
			kind: "agent",
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		clearTimeout(timeoutId);
		options.signal?.removeEventListener("abort", handleParentAbort);
	}

	const file = Bun.file(options.outputPath);
	if (!(await file.exists())) {
		return {
			ok: false,
			kind: "output",
			error: `${options.label} agent did not write output file: ${options.outputPath}`,
		};
	}
	let raw: unknown;
	try {
		raw = JSON.parse(await file.text());
	} catch (error) {
		return {
			ok: false,
			kind: "output",
			error: `${options.label} output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	const parsed = options.schema.safeParse(raw);
	if (!parsed.success) {
		return {
			ok: false,
			kind: "output",
			error: `${options.label} output failed schema validation: ${parsed.error.message}`,
		};
	}
	return { ok: true, doc: parsed.data };
}

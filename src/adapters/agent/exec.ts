import { PortError } from "../../core/errors";

export interface AgentExecOptions {
	cwd: string;
	signal?: AbortSignal;
}

export type AgentExec = (
	binary: string,
	args: string[],
	opts: AgentExecOptions,
) => AsyncIterable<string>;

/**
 * Run an agent CLI and expose stdout as ordered, newline-delimited chunks.
 * The caller owns NDJSON decoding because each provider has a different event
 * envelope. Non-zero exits are surfaced so adapters can turn them into an
 * AgentEvent error; cancellation is deliberately quiet.
 */
export async function* defaultAgentExec(
	binary: string,
	args: string[],
	opts: AgentExecOptions,
): AsyncIterable<string> {
	if (opts.signal?.aborted) return;

	const child = Bun.spawn([binary, ...args], {
		cwd: opts.cwd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	let aborted = false;
	const onAbort = () => {
		aborted = true;
		child.kill();
	};
	const signal = opts.signal;
	if (signal) {
		signal.addEventListener("abort", onAbort, { once: true });
		if (signal.aborted) onAbort();
	}

	const stderrPromise = new Response(child.stderr).text().catch(() => "");
	const decoder = new TextDecoder();
	let pending = "";

	try {
		for await (const chunk of child.stdout) {
			if (aborted) return;
			pending += decoder.decode(chunk, { stream: true });
			let newline = pending.indexOf("\n");
			while (newline >= 0) {
				if (aborted) return;
				const line = pending.slice(0, newline);
				pending = pending.slice(newline + 1);
				yield line.endsWith("\r") ? line.slice(0, -1) : line;
				newline = pending.indexOf("\n");
			}
		}

		if (!aborted) {
			pending += decoder.decode();
			if (pending.length > 0) {
				const line = pending.endsWith("\r") ? pending.slice(0, -1) : pending;
				yield line;
			}
		}
	} catch (error) {
		if (aborted || signal?.aborted) return;
		await stderrPromise;
		throw error;
	} finally {
		signal?.removeEventListener("abort", onAbort);
		if (aborted) child.kill();
	}

	if (aborted || signal?.aborted) return;
	const [exitCode, stderr] = await Promise.all([child.exited, stderrPromise]);
	if (exitCode !== 0) {
		throw new PortError(
			stderr.trim() || `${binary} exited with code ${exitCode}`,
			stderr,
			exitCode,
		);
	}
}

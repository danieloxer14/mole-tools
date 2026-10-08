import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { AgentEvent } from "../../ports/review-agent";
import type { AgentEffort } from "./effort";
import { type AgentExec, defaultAgentExec } from "./exec";

export const SCOPED_WRITE_PATH_ERROR =
	"Directory-scoped writes require an absolute writeDir outside the worktree and not its parent";

/** Directory-scoped write grants must stay outside the worktree; parent grants are rejected too. */
export function resolveScopedWritePaths(
	cwd: string,
	writeDir: string | undefined,
): { cwd: string; writeDir: string } | null {
	if (
		!writeDir ||
		!isAbsolute(cwd) ||
		!isAbsolute(writeDir) ||
		cwd.includes("\0") ||
		writeDir.includes("\0") ||
		cwd.trim() !== cwd ||
		writeDir.trim() !== writeDir
	) {
		return null;
	}

	const resolvedCwd = resolve(cwd);
	const resolvedWriteDir = resolve(writeDir);
	const cwdFromWriteDir = relative(resolvedWriteDir, resolvedCwd);
	const writeDirFromCwd = relative(resolvedCwd, resolvedWriteDir);
	if (
		cwdFromWriteDir === "" ||
		(cwdFromWriteDir !== ".." && !cwdFromWriteDir.startsWith(`..${sep}`)) ||
		writeDirFromCwd === "" ||
		(writeDirFromCwd !== ".." && !writeDirFromCwd.startsWith(`..${sep}`))
	) {
		return null;
	}

	return { cwd: resolvedCwd, writeDir: resolvedWriteDir };
}

export const SCOPED_READ_PATH_ERROR =
	"Read-only directory grants require an absolute readDir outside the worktree and separate from writeDir";

/** A read-only grant must stay outside both worktree and any write directory. */
export function resolveScopedReadDir(
	cwd: string,
	readDir: string | undefined,
	writeDir?: string,
): { cwd: string; readDir: string } | null {
	if (
		!readDir ||
		!isAbsolute(cwd) ||
		!isAbsolute(readDir) ||
		cwd.includes("\0") ||
		readDir.includes("\0") ||
		cwd.trim() !== cwd ||
		readDir.trim() !== readDir ||
		(writeDir !== undefined &&
			(!isAbsolute(writeDir) ||
				writeDir.includes("\0") ||
				writeDir.trim() !== writeDir))
	) {
		return null;
	}

	let resolvedCwd: string;
	let resolvedReadDir: string;
	let resolvedWriteDir: string | undefined;
	try {
		resolvedCwd = realpathSync(cwd);
		resolvedReadDir = realpathSync(readDir);
		resolvedWriteDir =
			writeDir === undefined ? undefined : realpathSync(writeDir);
	} catch {
		return null;
	}
	const isWithin = (parent: string, child: string): boolean => {
		const fromParent = relative(parent, child);
		return (
			!isAbsolute(fromParent) &&
			(fromParent === "" ||
				(fromParent !== ".." && !fromParent.startsWith(`..${sep}`)))
		);
	};
	if (
		isWithin(resolvedCwd, resolvedReadDir) ||
		isWithin(resolvedReadDir, resolvedCwd) ||
		(resolvedWriteDir !== undefined &&
			(isWithin(resolvedWriteDir, resolvedReadDir) ||
				isWithin(resolvedReadDir, resolvedWriteDir)))
	) {
		return null;
	}
	return { cwd: resolvedCwd, readDir: resolvedReadDir };
}

export type JsonRecord = Record<string, unknown>;
export type ParsedLine =
	| { tag: "provider"; value: JsonRecord }
	| { tag: "event"; event: AgentEvent };

type AgentOptions = {
	binary?: string;
	model?: string;
	effort?: AgentEffort;
	exec?: AgentExec;
};

export type AgentConfig = {
	binary: string;
	model?: string;
	effort?: AgentEffort;
	execFn: AgentExec;
};

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function diagnostic(eventType: string | null, raw: unknown): AgentEvent {
	return {
		kind: "diagnostic",
		code: "unknown_event",
		message: eventType
			? `Unknown agent event type: ${eventType}`
			: "Unknown agent event type",
		eventType,
		raw,
	};
}

export function malformed(provider: string, message: string): AgentEvent {
	return {
		kind: "error",
		message: `Malformed ${provider} agent event: ${message}`,
	};
}

export function nestedMessage(
	value: unknown,
	keys: readonly string[],
): string | null {
	if (typeof value === "string" && value.trim()) return value;
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return null;
	const record = value as JsonRecord;
	for (const key of keys) {
		const candidate = record[key];
		if (typeof candidate === "string" && candidate.trim()) return candidate;
		if (
			candidate !== null &&
			typeof candidate === "object" &&
			!Array.isArray(candidate)
		) {
			const nested = nestedMessage(candidate, keys);
			if (nested) return nested;
		}
	}
	return null;
}

export function parseJson(line: string, provider: string): ParsedLine {
	let value: unknown;
	try {
		value = JSON.parse(line) as unknown;
	} catch {
		return {
			tag: "event",
			event: {
				kind: "error",
				message: `Malformed ${provider} agent event: invalid JSON (${line})`,
			},
		};
	}
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return { tag: "event", event: malformed(provider, "expected an object") };
	return { tag: "provider", value: value as JsonRecord };
}

export function resolveAgentConfig<T extends AgentOptions>(
	execOrOptions: AgentExec | T,
	options: T,
	defaultBinary: string,
): AgentConfig {
	if (typeof execOrOptions === "function") {
		return {
			execFn: execOrOptions,
			binary: options.binary ?? defaultBinary,
			model: options.model,
			effort: options.effort,
		};
	}
	return {
		execFn: execOrOptions.exec ?? defaultAgentExec,
		binary: execOrOptions.binary ?? defaultBinary,
		model: execOrOptions.model,
		effort: execOrOptions.effort,
	};
}

export async function preflight(
	exec: AgentExec,
	binary: string,
): Promise<void> {
	for await (const _line of exec(binary, ["--version"], {
		cwd: process.cwd(),
	})) {
		// Consuming stream waits for process and surfaces its exit status.
	}
}

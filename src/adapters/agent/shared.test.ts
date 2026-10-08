import { describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentExec } from "./exec";
import {
	diagnostic,
	errorMessage,
	malformed,
	nestedMessage,
	parseJson,
	preflight,
	resolveAgentConfig,
	resolveScopedReadDir,
	resolveScopedWritePaths,
} from "./shared";

describe("shared agent adapter plumbing", () => {
	test("allows scoped writes only outside the worktree", () => {
		const cwd = process.cwd();
		const sibling = join(cwd, "..", "review-output");
		const external = join(tmpdir(), "review-output");

		expect(resolveScopedWritePaths(cwd, sibling)).toEqual({
			cwd,
			writeDir: sibling,
		});
		expect(resolveScopedWritePaths(cwd, external)).toEqual({
			cwd,
			writeDir: external,
		});
		expect(resolveScopedWritePaths(cwd, join(cwd, "review-output"))).toBeNull();
		expect(resolveScopedWritePaths(cwd, join(cwd, ".git"))).toBeNull();
		expect(resolveScopedWritePaths(cwd, cwd)).toBeNull();
		expect(resolveScopedWritePaths(cwd, join(cwd, ".."))).toBeNull();
	});
	test("keeps scoped read grants outside worktree and write scope", () => {
		const cwd = process.cwd();
		const root = mkdtempSync(join(tmpdir(), "review-scoped-path-"));
		try {
			const readDir = join(root, "evidence");
			const writeDir = join(root, "output");
			const separateReadDir = join(root, "separate-evidence");
			mkdirSync(readDir);
			mkdirSync(writeDir);
			mkdirSync(separateReadDir);

			expect(resolveScopedReadDir(cwd, readDir, writeDir)).toEqual({
				cwd: realpathSync(cwd),
				readDir: realpathSync(readDir),
			});
			expect(
				resolveScopedReadDir(cwd, separateReadDir, writeDir),
			).not.toBeNull();
			for (const invalid of [
				undefined,
				"",
				"relative-evidence",
				cwd,
				join(cwd, "evidence"),
				join(cwd, ".."),
				writeDir,
			]) {
				expect(resolveScopedReadDir(cwd, invalid, writeDir)).toBeNull();
			}
			expect(resolveScopedReadDir(cwd, readDir, "relative-output")).toBeNull();
			expect(resolveScopedReadDir(cwd, `${readDir} `, writeDir)).toBeNull();
			expect(resolveScopedReadDir(cwd, `${readDir}\0`, writeDir)).toBeNull();

			const worktreeLink = join(root, "worktree-link");
			const outputLink = join(root, "output-link");
			symlinkSync(cwd, worktreeLink, "dir");
			symlinkSync(writeDir, outputLink, "dir");
			expect(resolveScopedReadDir(cwd, worktreeLink, writeDir)).toBeNull();
			expect(resolveScopedReadDir(cwd, outputLink, writeDir)).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	test("preserves provider labels and diagnostic/error formatting", () => {
		expect(errorMessage(new Error("failed"))).toBe("failed");
		expect(errorMessage("failed")).toBe("failed");
		expect(diagnostic("future", { type: "future" })).toEqual({
			kind: "diagnostic",
			code: "unknown_event",
			message: "Unknown agent event type: future",
			eventType: "future",
			raw: { type: "future" },
		});
		expect(malformed("OMP", "expected an object")).toEqual({
			kind: "error",
			message: "Malformed OMP agent event: expected an object",
		});
		expect(malformed("Claude", "expected an object")).toEqual({
			kind: "error",
			message: "Malformed Claude agent event: expected an object",
		});
	});

	test("extracts provider-specific nested messages", () => {
		expect(
			nestedMessage({ result: { detail: "Claude failed" } }, [
				"message",
				"error",
				"detail",
				"reason",
				"result",
			]),
		).toBe("Claude failed");
		expect(
			nestedMessage({ result: "Claude failed" }, [
				"message",
				"error",
				"detail",
				"reason",
			]),
		).toBeNull();
		expect(
			nestedMessage({ error: { reason: "OMP failed" } }, [
				"message",
				"error",
				"detail",
				"reason",
			]),
		).toBe("OMP failed");
	});

	test("parses malformed JSON and non-object values with provider labels", () => {
		expect(parseJson("not-json", "OMP")).toEqual({
			tag: "event",
			event: {
				kind: "error",
				message: "Malformed OMP agent event: invalid JSON (not-json)",
			},
		});
		expect(parseJson("[]", "Claude")).toEqual({
			tag: "event",
			event: {
				kind: "error",
				message: "Malformed Claude agent event: expected an object",
			},
		});
		expect(parseJson('{"type":"session"}', "OMP")).toEqual({
			tag: "provider",
			value: { type: "session" },
		});
	});

	test("resolves positional and options constructors with injected executors", () => {
		const positional: AgentExec = async function* () {};
		const optionsExec: AgentExec = async function* () {};

		expect(resolveAgentConfig(positional, {}, "omp")).toEqual({
			execFn: positional,
			binary: "omp",
			model: undefined,
		});
		expect(
			resolveAgentConfig(
				{ exec: optionsExec, binary: "custom", model: "model" },
				{},
				"claude",
			),
		).toEqual({
			execFn: optionsExec,
			binary: "custom",
			model: "model",
		});
	});

	test("preflight consumes injected executor output", async () => {
		const calls: Array<{ binary: string; args: string[]; cwd: string }> = [];
		const exec: AgentExec = async function* (binary, args, options) {
			calls.push({ binary, args, cwd: options.cwd });
			yield "version";
		};

		await preflight(exec, "claude");

		expect(calls).toEqual([
			{ binary: "claude", args: ["--version"], cwd: process.cwd() },
		]);
	});
});

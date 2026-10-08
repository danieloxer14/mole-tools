import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, AgentTurn } from "../../ports/review-agent";
import type { AgentExec } from "./exec";
import { OmpAgentAdapter } from "./omp";

interface Call {
	binary: string;
	args: string[];
	cwd: string;
}

const turn: AgentTurn = {
	cwd: process.cwd(),
	systemPromptFile: `${import.meta.dir}/omp.test.ts`,
	message: "Review this change",
};

async function collect(
	source: AsyncIterable<AgentEvent>,
): Promise<AgentEvent[]> {
	const events: AgentEvent[] = [];
	for await (const event of source) events.push(event);
	return events;
}

async function fixtureLines(name = "omp-turn.ndjson"): Promise<string[]> {
	const text = await Bun.file(
		new URL(`../../../test/fixtures/agent/${name}`, import.meta.url),
	).text();
	return text.split(/\r?\n/).filter((line) => line.length > 0);
}

function replay(lines: string[], calls: Call[]): AgentExec {
	return async function* (binary, args, opts) {
		calls.push({ binary, args, cwd: opts.cwd });
		for (const line of lines) {
			if (opts.signal?.aborted) return;
			yield line;
		}
	};
}
async function withScopedDirectories<T>(
	run: (paths: {
		readDir: string;
		resolvedReadDir: string;
		writeDir: string;
	}) => Promise<T>,
): Promise<T> {
	const root = await mkdtemp(join(tmpdir(), "omp-scoped-paths-"));
	const readDir = join(root, "evidence");
	const writeDir = join(root, "output");
	try {
		await mkdir(readDir);
		await mkdir(writeDir);
		return await run({
			readDir,
			resolvedReadDir: await realpath(readDir),
			writeDir,
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe("OmpAgentAdapter", () => {
	test("maps the committed fixture into shared events", async () => {
		const calls: Call[] = [];
		const adapter = new OmpAgentAdapter(replay(await fixtureLines(), calls));

		expect(await collect(adapter.run(turn))).toEqual([
			{ kind: "session", sessionId: "fixture-omp-session" },
			{ kind: "text", delta: "Hello" },
			{ kind: "tool", name: "read", phase: "start" },
			{ kind: "tool", name: "read", phase: "end" },
			{ kind: "text", delta: " from OMP" },
			{ kind: "turn_end" },
		]);
		expect(calls).toEqual([
			{
				binary: "omp",
				args: [
					"-p",
					"--mode",
					"json",
					"--cwd",
					turn.cwd,
					"--append-system-prompt",
					turn.systemPromptFile,
					"--tools",
					"read,grep,glob,bash",
					"--",
					turn.message,
				],
				cwd: turn.cwd,
			},
		]);
	});

	test("keeps consuming past a per-turn turn_end so the final reply after a tool call survives", async () => {
		const calls: Call[] = [];
		const adapter = new OmpAgentAdapter(
			replay(await fixtureLines("omp-tool-then-turn-end.ndjson"), calls),
		);

		expect(await collect(adapter.run(turn))).toEqual([
			{ kind: "session", sessionId: "fixture-omp-session-2" },
			{ kind: "tool", name: "read", phase: "start" },
			{ kind: "tool", name: "read", phase: "end" },
			{ kind: "text", delta: "The name is mole-tools." },
			{ kind: "turn_end" },
		]);
	});

	test("normalizes provider errors and unknown events without aborting the turn", async () => {
		const calls: Call[] = [];
		const adapter = new OmpAgentAdapter(
			replay(
				[
					'{"type":"session","id":"session-1"}',
					'{"type":"future_event","kind":"new_shape"}',
					'{"type":"future_event","value":true}',
					'{"type":"error","message":"provider failed"}',
					'{"type":"turn_end"}',
				],
				calls,
			),
		);

		expect(await collect(adapter.run(turn))).toEqual([
			{ kind: "session", sessionId: "session-1" },
			{
				kind: "diagnostic",
				code: "unknown_event",
				message: "Unknown agent event type: future_event",
				eventType: "future_event",
				raw: { type: "future_event", kind: "new_shape" },
			},
			{
				kind: "diagnostic",
				code: "unknown_event",
				message: "Unknown agent event type: future_event",
				eventType: "future_event",
				raw: { type: "future_event", value: true },
			},
			{ kind: "error", message: "provider failed" },
			{ kind: "turn_end" },
		]);
	});

	test("ignores message_start/message_end lifecycle events instead of surfacing diagnostics", async () => {
		const calls: Call[] = [];
		const adapter = new OmpAgentAdapter(
			replay(
				[
					'{"type":"session","id":"session-1"}',
					'{"type":"message_start","message":{"role":"assistant","content":[]}}',
					'{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"hi"}}',
					'{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}',
					'{"type":"turn_end"}',
				],
				calls,
			),
		);

		expect(await collect(adapter.run(turn))).toEqual([
			{ kind: "session", sessionId: "session-1" },
			{ kind: "text", delta: "hi" },
			{ kind: "turn_end" },
		]);
	});

	test("ignores tool_execution_update progress events instead of surfacing diagnostics", async () => {
		const calls: Call[] = [];
		const adapter = new OmpAgentAdapter(
			replay(
				[
					'{"type":"session","id":"session-1"}',
					'{"type":"tool_execution_start","toolCallId":"call-1","toolName":"read"}',
					'{"type":"tool_execution_update","toolCallId":"call-1","toolName":"read","progress":"reading"}',
					'{"type":"tool_execution_end","toolCallId":"call-1","toolName":"read"}',
					'{"type":"agent_end","messages":[],"isTerminal":true}',
				],
				calls,
			),
		);

		expect(await collect(adapter.run(turn))).toEqual([
			{ kind: "session", sessionId: "session-1" },
			{ kind: "tool", name: "read", phase: "start" },
			{ kind: "tool", name: "read", phase: "end" },
			{ kind: "turn_end" },
		]);
	});
	test("ignores rate-limit events instead of surfacing diagnostics", async () => {
		const adapter = new OmpAgentAdapter(
			replay(
				[
					'{"type":"session","id":"session-1"}',
					'{"type":"rate_limit_event","status":"allowed","resetsAt":123}',
					'{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"still available"}}',
					'{"type":"agent_end","messages":[],"isTerminal":true}',
				],
				[],
			),
		);

		expect(await collect(adapter.run(turn))).toEqual([
			{ kind: "session", sessionId: "session-1" },
			{ kind: "text", delta: "still available" },
			{ kind: "turn_end" },
		]);
	});

	test("preserves generic output-directory writes", async () => {
		const calls: Call[] = [];
		const adapter = new OmpAgentAdapter(
			replay([`{"type":"session","id":"other"}`], calls),
			{
				model: "review-model",
			},
		);
		const resumedTurn: AgentTurn = {
			...turn,
			sessionId: "resume-session",
			writeDir: "/tmp/review-output",
		};

		expect(await collect(adapter.run(resumedTurn))).toEqual([
			{ kind: "session", sessionId: "resume-session" },
			{ kind: "turn_end" },
		]);
		expect(calls[0]).toEqual({
			binary: "omp",
			args: [
				"-p",
				"--mode",
				"json",
				"--cwd",
				turn.cwd,
				"--append-system-prompt",
				turn.systemPromptFile,
				"--tools",
				"read,grep,glob,bash,write",
				"--model",
				"review-model",
				"-r",
				"resume-session",
				"--add-dir",
				"/tmp/review-output",
				"--",
				turn.message,
			],
			cwd: turn.cwd,
		});
	});
	test("keeps scoped-write requests read-only while exposing evidence separately", async () => {
		await withScopedDirectories(
			async ({ readDir, resolvedReadDir, writeDir }) => {
				const calls: Call[] = [];
				const adapter = new OmpAgentAdapter(
					replay([`{"type":"session","id":"other"}`], calls),
				);
				const scopedTurn: AgentTurn = {
					...turn,
					sessionId: "resume-session",
					readDir,
					writeDir,
					writeScope: "directory",
				};

				expect(await collect(adapter.run(scopedTurn))).toEqual([
					{ kind: "session", sessionId: "resume-session" },
					{ kind: "turn_end" },
				]);
				expect(adapter.supportsScopedWrites).toBe(false);
				expect(calls[0]).toEqual({
					binary: "omp",
					args: [
						"-p",
						"--no-extensions",
						"--mode",
						"json",
						"--cwd",
						turn.cwd,
						"--append-system-prompt",
						turn.systemPromptFile,
						"--tools",
						"read,grep,glob",
						"-r",
						"resume-session",
						"--add-dir",
						resolvedReadDir,
						"--",
						turn.message,
					],
					cwd: turn.cwd,
				});
			},
		);
	});
	test("rejects evidence grants that overlap the worktree or write scope", async () => {
		const calls: Call[] = [];
		const adapter = new OmpAgentAdapter(replay([], calls));
		await withScopedDirectories(async ({ writeDir }) => {
			for (const readDir of [
				"",
				"relative-evidence",
				turn.cwd,
				`${turn.cwd}/evidence`,
				join(writeDir, ".."),
				writeDir,
			]) {
				expect(
					await collect(adapter.run({ ...turn, readDir, writeDir })),
				).toEqual([
					{
						kind: "error",
						message:
							"Read-only directory grants require an absolute readDir outside the worktree and separate from writeDir",
					},
					{ kind: "turn_end" },
				]);
			}
		});
		expect(calls).toEqual([]);
	});

	test("turns executor failures into one error followed by turn_end", async () => {
		const adapter = new OmpAgentAdapter(async function* () {
			yield '{"type":"session","id":"session-1"}';
			throw new Error("omp exited");
		});

		expect(await collect(adapter.run(turn))).toEqual([
			{ kind: "session", sessionId: "session-1" },
			{ kind: "error", message: "omp exited" },
			{ kind: "turn_end" },
		]);
	});

	test("stops iteration when aborted", async () => {
		const controller = new AbortController();
		const adapter = new OmpAgentAdapter(async function* (_binary, _args, opts) {
			yield '{"type":"session","id":"session-1"}';
			if (opts.signal?.aborted) return;
			yield '{"type":"text","delta":"late"}';
		} satisfies AgentExec);
		const iterator = adapter
			.run({ ...turn, signal: controller.signal })
			[Symbol.asyncIterator]();

		expect(await iterator.next()).toEqual({
			done: false,
			value: { kind: "session", sessionId: "session-1" },
		});
		controller.abort();
		expect(await iterator.next()).toEqual({ done: true, value: undefined });
	});
});

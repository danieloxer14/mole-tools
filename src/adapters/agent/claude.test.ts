import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import type { AgentEvent, AgentTurn } from "../../ports/review-agent";
import { ClaudeAgentAdapter } from "./claude";
import type { AgentExec } from "./exec";

interface Call {
	binary: string;
	args: string[];
	cwd: string;
}

const turn: AgentTurn = {
	cwd: process.cwd(),
	systemPromptFile: `${import.meta.dir}/claude.test.ts`,
	message: "Review this change",
};

async function collect(
	source: AsyncIterable<AgentEvent>,
): Promise<AgentEvent[]> {
	const events: AgentEvent[] = [];
	for await (const event of source) events.push(event);
	return events;
}

async function fixtureLines(): Promise<string[]> {
	const text = await Bun.file(
		new URL("../../../test/fixtures/agent/claude-turn.ndjson", import.meta.url),
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

describe("ClaudeAgentAdapter", () => {
	test("maps the committed fixture into shared events", async () => {
		const calls: Call[] = [];
		const adapter = new ClaudeAgentAdapter(replay(await fixtureLines(), calls));
		const events = await collect(adapter.run(turn));
		const session = events.find((event) => event.kind === "session");
		const call = calls[0];

		expect(events).toEqual([
			{ kind: "session", sessionId: expect.any(String) },
			{ kind: "text", delta: "Hello" },
			{ kind: "tool", name: "Read", phase: "start" },
			{ kind: "tool", name: "Read", phase: "end" },
			{ kind: "text", delta: " from Claude" },
			{ kind: "turn_end" },
		]);
		expect(session?.kind === "session" ? session.sessionId : "").toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
		);
		expect(call).toBeDefined();
		expect(call?.binary).toBe("claude");
		expect(call?.cwd).toBe(turn.cwd);
		expect(call?.args).toEqual([
			"-p",
			"--output-format",
			"stream-json",
			"--include-partial-messages",
			"--verbose",
			"--session-id",
			session?.kind === "session" ? session.sessionId : "",
			"--model",
			"opus",
			"--append-system-prompt",
			await Bun.file(turn.systemPromptFile).text(),
			"--allowedTools",
			"Read",
			"Grep",
			"Glob",
			"Bash",
			"--add-dir",
			turn.cwd,
			"--",
			turn.message,
		]);
	});

	test("passes the configured model to Claude", async () => {
		const calls: Call[] = [];
		const adapter = new ClaudeAgentAdapter({
			model: "claude-opus-4-6",
			exec: replay(
				['{"type":"system","subtype":"init","session_id":"session-1"}'],
				calls,
			),
		});

		await collect(adapter.run(turn));

		expect(calls[0]?.args.slice(5, 10)).toEqual([
			"--session-id",
			expect.any(String),
			"--model",
			"claude-opus-4-6",
			"--append-system-prompt",
		]);
		expect(calls[0]?.args.filter((arg) => arg === "--model")).toEqual([
			"--model",
		]);
		expect(calls[0]?.args).not.toContain("opus");
	});

	test("ignores duplicate transcript events and reports unknown provider events", async () => {
		const calls: Call[] = [];
		const adapter = new ClaudeAgentAdapter(
			replay(
				[
					'{"type":"system","subtype":"init","session_id":"session-1"}',
					'{"type":"assistant","message":{"role":"assistant","content":[]}}',
					'{"type":"user","message":{"role":"user","content":[]}}',
					'{"type":"stream_event","event":{"type":"rate_limit_event","status":"allowed"}}',
					'{"type":"rate_limit_event","status":"allowed"}',
					'{"type":"future_event","kind":"new_shape"}',
					'{"type":"future_event","value":true}',
					'{"type":"error","error":{"message":"provider failed"}}',
					'{"type":"result","subtype":"success","is_error":false}',
				],
				calls,
			),
		);

		expect(await collect(adapter.run(turn))).toEqual([
			{ kind: "session", sessionId: expect.any(String) },
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

	test("scopes one-pager writes to the allowed directory and denies other tools", async () => {
		const calls: Call[] = [];
		const adapter = new ClaudeAgentAdapter(
			replay(
				[
					'{"type":"system","subtype":"init","session_id":"other"}',
					'{"type":"result","subtype":"success"}',
				],
				calls,
			),
		);
		const writeDir = resolve(turn.cwd, "..", "review-output");
		const resumedTurn: AgentTurn = {
			...turn,
			sessionId: "resume-session",
			writeDir,
			writeScope: "directory",
		};

		expect(await collect(adapter.run(resumedTurn))).toEqual([
			{ kind: "session", sessionId: "resume-session" },
			{ kind: "turn_end" },
		]);
		expect(adapter.supportsScopedWrites).toBe(true);
		expect(calls[0]?.args).toEqual([
			"-p",
			"--output-format",
			"stream-json",
			"--include-partial-messages",
			"--verbose",
			"--resume",
			"resume-session",
			"--model",
			"opus",
			"--append-system-prompt",
			await Bun.file(turn.systemPromptFile).text(),
			"--safe-mode",
			"--restricted",
			"--tools",
			"Read",
			"Grep",
			"Glob",
			"Write",
			"Edit",
			"--allowedTools",
			"Read",
			"Grep",
			"Glob",
			`Write(${writeDir}/**)`,
			`Edit(${writeDir}/**)`,
			"--permission-mode",
			"default",
			"--permission-prompts",
			"none",
			"--add-dir",
			writeDir,
			"--add-dir",
			turn.cwd,
			"--",
			turn.message,
		]);
		expect(calls[0]?.args).not.toContain("Bash");
		expect(calls[0]?.args).not.toContain("acceptEdits");
		expect(calls[0]?.args).not.toContain("--dangerously-skip-permissions");
	});

	test("fails closed for invalid directory-scoped paths in both dimensions", async () => {
		const calls: Call[] = [];
		const adapter = new ClaudeAgentAdapter(replay([], calls));
		const invalidTurns = [
			{ cwd: turn.cwd, writeDir: undefined },
			{ cwd: turn.cwd, writeDir: "" },
			{ cwd: turn.cwd, writeDir: "relative-output" },
			{ cwd: turn.cwd, writeDir: `${turn.cwd}/review-output ` },
			{ cwd: turn.cwd, writeDir: `${turn.cwd}/review-\0output` },
			{ cwd: turn.cwd, writeDir: turn.cwd },
			{ cwd: turn.cwd, writeDir: `${turn.cwd}/review-output` },
			{ cwd: turn.cwd, writeDir: `${turn.cwd}/.git` },
			{ cwd: turn.cwd, writeDir: `${turn.cwd}/.git/config` },
			{ cwd: turn.cwd, writeDir: `${turn.cwd}/..` },
			{ cwd: "", writeDir: `${turn.cwd}/review-output` },
			{ cwd: "relative-cwd", writeDir: `${turn.cwd}/review-output` },
			{ cwd: `${turn.cwd} `, writeDir: `${turn.cwd}/review-output` },
			{ cwd: `${turn.cwd}\0`, writeDir: `${turn.cwd}/review-output` },
		];

		for (const paths of invalidTurns) {
			expect(
				await collect(
					adapter.run({ ...turn, ...paths, writeScope: "directory" }),
				),
			).toEqual([
				{
					kind: "error",
					message:
						"Directory-scoped writes require an absolute writeDir outside the worktree and not its parent",
				},
				{ kind: "turn_end" },
			]);
		}
		expect(calls).toEqual([]);
	});

	test("turns executor failures into one error followed by turn_end", async () => {
		const adapter = new ClaudeAgentAdapter(async function* () {
			yield '{"type":"system","subtype":"init","session_id":"session-1"}';
			throw new Error("claude exited");
		});

		expect(await collect(adapter.run(turn))).toEqual([
			{ kind: "session", sessionId: expect.any(String) },
			{ kind: "error", message: "claude exited" },
			{ kind: "turn_end" },
		]);
	});

	test("adds recovery instructions to expired OAuth errors", async () => {
		const adapter = new ClaudeAgentAdapter(async function* () {
			yield '{"type":"system","subtype":"init","session_id":"session-1"}';
			throw new Error(
				"Failed to authenticate: OAuth session expired and could not be refreshed",
			);
		});

		expect(await collect(adapter.run(turn))).toEqual([
			{ kind: "session", sessionId: expect.any(String) },
			{
				kind: "error",
				message:
					"Failed to authenticate: OAuth session expired and could not be refreshed\n\nClaude authentication expired. Run `claude auth login`, complete sign-in, then retry the layer guide.",
			},
			{ kind: "turn_end" },
		]);
	});

	test("stops iteration when aborted", async () => {
		const controller = new AbortController();
		const adapter = new ClaudeAgentAdapter(async function* (
			_binary,
			_args,
			opts,
		) {
			yield '{"type":"system","subtype":"init","session_id":"session-1"}';
			if (opts.signal?.aborted) return;
			yield '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"late"}}}';
		} satisfies AgentExec);
		const iterator = adapter
			.run({ ...turn, signal: controller.signal })
			[Symbol.asyncIterator]();

		expect(await iterator.next()).toEqual({
			done: false,
			value: { kind: "session", sessionId: expect.any(String) },
		});
		controller.abort();
		expect(await iterator.next()).toEqual({ done: true, value: undefined });
	});
});

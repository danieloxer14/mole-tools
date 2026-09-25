import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PortError } from "../../core/errors";
import type { AgentEvent, AgentTurn } from "../../ports/review-agent";
import { CodexAgentAdapter } from "./codex";
import type { AgentExec } from "./exec";

interface Call {
	binary: string;
	args: string[];
	cwd: string;
}

const baseTurn = {
	cwd: process.cwd(),
	message: "Review this change",
};

async function withPrompt<T>(
	text: string,
	fn: (systemPromptFile: string) => Promise<T>,
): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), "codex-test-"));
	const systemPromptFile = join(dir, "system-prompt.md");
	try {
		await writeFile(systemPromptFile, text);
		return await fn(systemPromptFile);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function makeTurn(
	systemPromptFile: string,
	overrides: Partial<AgentTurn> = {},
): AgentTurn {
	return { ...baseTurn, systemPromptFile, ...overrides };
}

async function collect(
	source: AsyncIterable<AgentEvent>,
): Promise<AgentEvent[]> {
	const events: AgentEvent[] = [];
	for await (const event of source) events.push(event);
	return events;
}

async function fixtureLines(name = "codex-turn.ndjson"): Promise<string[]> {
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

function jsonLine(value: unknown): string {
	return JSON.stringify(value);
}

describe("CodexAgentAdapter", () => {
	test("maps the committed fixture into ordered shared events", async () => {
		const calls: Call[] = [];
		await withPrompt("System prompt", async (systemPromptFile) => {
			const adapter = new CodexAgentAdapter({
				exec: replay(await fixtureLines(), calls),
			});

			expect(await collect(adapter.run(makeTurn(systemPromptFile)))).toEqual([
				{ kind: "session", sessionId: "fixture-codex-thread" },
				{ kind: "tool", name: "bash", phase: "start" },
				{ kind: "tool", name: "bash", phase: "end" },
				{ kind: "text", delta: "Hello from Codex" },
				{ kind: "turn_end" },
			]);
		});
	});

	test("uses the exact read-only argv for a new session", async () => {
		const calls: Call[] = [];
		await withPrompt("System prompt", async (systemPromptFile) => {
			const adapter = new CodexAgentAdapter(replay([], calls));
			await collect(adapter.run(makeTurn(systemPromptFile)));

			expect(calls).toEqual([
				{
					binary: "codex",
					args: [
						"exec",
						"--json",
						"--skip-git-repo-check",
						"-C",
						baseTurn.cwd,
						"--sandbox",
						"read-only",
						"-c",
						`projects={"${baseTurn.cwd}"={trust_level="untrusted"}}`,
						"-c",
						'developer_instructions="System prompt"',
						"--",
						baseTurn.message,
					],
					cwd: baseTurn.cwd,
				},
			]);
		});
	});

	test("adds model and workspace-write options when configured", async () => {
		const calls: Call[] = [];
		await withPrompt("System prompt", async (systemPromptFile) => {
			const writeDir = join(tmpdir(), "codex-write-dir");
			const adapter = new CodexAgentAdapter({
				exec: replay([], calls),
				model: "gpt-5.2",
			});
			await collect(adapter.run(makeTurn(systemPromptFile, { writeDir })));

			expect(calls[0]?.args).toEqual([
				"exec",
				"--json",
				"--skip-git-repo-check",
				"-C",
				baseTurn.cwd,
				"--sandbox",
				"workspace-write",
				"-c",
				`projects={"${baseTurn.cwd}"={trust_level="untrusted"}}`,
				"-m",
				"gpt-5.2",
				"-c",
				'developer_instructions="System prompt"',
				"--add-dir",
				writeDir,
				"--",
				baseTurn.message,
			]);
		});
	});

	test("TOML-escapes project paths in the untrusted override", async () => {
		const calls: Call[] = [];
		const cwd = '/tmp/review "project"\\folder';
		await withPrompt("System prompt", async (systemPromptFile) => {
			const adapter = new CodexAgentAdapter(replay([], calls));
			await collect(adapter.run(makeTurn(systemPromptFile, { cwd })));

			const configIndex = calls[0]?.args.indexOf("-c") ?? -1;
			expect(calls[0]?.args[configIndex + 1]).toBe(
				'projects={"/tmp/review \\"project\\"\\\\folder"={trust_level="untrusted"}}',
			);
		});
	});

	test("resumes the requested session and emits its id before stream events", async () => {
		const calls: Call[] = [];
		await withPrompt("System prompt", async (systemPromptFile) => {
			const adapter = new CodexAgentAdapter(
				replay(
					[
						jsonLine({ type: "thread.started", thread_id: "s-1" }),
						jsonLine({ type: "turn.completed" }),
					],
					calls,
				),
			);
			const events = await collect(
				adapter.run(makeTurn(systemPromptFile, { sessionId: "s-1" })),
			);

			expect(calls[0]?.args.slice(-4)).toEqual([
				"resume",
				"s-1",
				"--",
				baseTurn.message,
			]);
			expect(events[0]).toEqual({ kind: "session", sessionId: "s-1" });
			expect(events).toEqual([
				{ kind: "session", sessionId: "s-1" },
				{ kind: "turn_end" },
			]);
		});
	});

	test("encodes developer instructions as a well-formed TOML basic string", async () => {
		const calls: Call[] = [];
		const prompt = 'a"b\\c\nd\te\u0001f\u007Fg\uD800h';
		const expected =
			String.raw`developer_instructions="a\"b\\c\nd\te\u0001f\u007Fg` +
			'\uFFFDh"';
		await withPrompt(prompt, async (systemPromptFile) => {
			const adapter = new CodexAgentAdapter(replay([], calls));
			await collect(adapter.run(makeTurn(systemPromptFile)));

			const configIndex = calls[0]?.args.lastIndexOf("-c") ?? -1;
			expect(calls[0]?.args[configIndex + 1]).toBe(expected);
		});
	});

	test("drops a duplicate resumed thread id and preserves turn completion", async () => {
		const calls: Call[] = [];
		await withPrompt("System prompt", async (systemPromptFile) => {
			const adapter = new CodexAgentAdapter(
				replay(
					[
						jsonLine({ type: "thread.started", thread_id: "s-1" }),
						jsonLine({ type: "turn.completed" }),
					],
					calls,
				),
			);

			expect(
				await collect(
					adapter.run(makeTurn(systemPromptFile, { sessionId: "s-1" })),
				),
			).toEqual([{ kind: "session", sessionId: "s-1" }, { kind: "turn_end" }]);
		});
	});

	test("emits a changed thread id after the resumed id", async () => {
		const calls: Call[] = [];
		await withPrompt("System prompt", async (systemPromptFile) => {
			const adapter = new CodexAgentAdapter(
				replay(
					[
						jsonLine({ type: "thread.started", thread_id: "s-2" }),
						jsonLine({ type: "turn.completed" }),
					],
					calls,
				),
			);

			expect(
				await collect(
					adapter.run(makeTurn(systemPromptFile, { sessionId: "s-1" })),
				),
			).toEqual([
				{ kind: "session", sessionId: "s-1" },
				{ kind: "session", sessionId: "s-2" },
				{ kind: "turn_end" },
			]);
		});
	});

	test("separates consecutive assistant messages with a blank line", async () => {
		const calls: Call[] = [];
		await withPrompt("System prompt", async (systemPromptFile) => {
			const adapter = new CodexAgentAdapter(
				replay(
					[
						jsonLine({ type: "thread.started", thread_id: "s-1" }),
						jsonLine({
							type: "item.completed",
							item: { type: "agent_message", text: "A" },
						}),
						jsonLine({
							type: "item.completed",
							item: { type: "agent_message", text: "B" },
						}),
					],
					calls,
				),
			);

			expect(await collect(adapter.run(makeTurn(systemPromptFile)))).toEqual([
				{ kind: "session", sessionId: "s-1" },
				{ kind: "text", delta: "A" },
				{ kind: "text", delta: "\n\nB" },
				{ kind: "turn_end" },
			]);
		});
	});

	test("names MCP tool events from item.tool", async () => {
		const calls: Call[] = [];
		await withPrompt("System prompt", async (systemPromptFile) => {
			const adapter = new CodexAgentAdapter(
				replay(
					[
						jsonLine({ type: "thread.started", thread_id: "s-1" }),
						jsonLine({
							type: "item.started",
							item: { type: "mcp_tool_call", tool: "search" },
						}),
						jsonLine({
							type: "item.completed",
							item: { type: "mcp_tool_call", tool: "search" },
						}),
					],
					calls,
				),
			);

			expect(await collect(adapter.run(makeTurn(systemPromptFile)))).toEqual([
				{ kind: "session", sessionId: "s-1" },
				{ kind: "tool", name: "search", phase: "start" },
				{ kind: "tool", name: "search", phase: "end" },
				{ kind: "turn_end" },
			]);
		});
	});

	test("maps a completed file change to apply_patch end", async () => {
		const calls: Call[] = [];
		await withPrompt("System prompt", async (systemPromptFile) => {
			const adapter = new CodexAgentAdapter(
				replay(
					[
						jsonLine({ type: "thread.started", thread_id: "s-1" }),
						jsonLine({
							type: "item.completed",
							item: { type: "file_change" },
						}),
					],
					calls,
				),
			);

			expect(await collect(adapter.run(makeTurn(systemPromptFile)))).toEqual([
				{ kind: "session", sessionId: "s-1" },
				{ kind: "tool", name: "apply_patch", phase: "end" },
				{ kind: "turn_end" },
			]);
		});
	});

	test("diagnoses an unknown completed item type", async () => {
		const calls: Call[] = [];
		await withPrompt("System prompt", async (systemPromptFile) => {
			const adapter = new CodexAgentAdapter(
				replay(
					[
						jsonLine({ type: "thread.started", thread_id: "s-1" }),
						jsonLine({
							type: "item.completed",
							item: { type: "future_item" },
						}),
					],
					calls,
				),
			);

			expect(await collect(adapter.run(makeTurn(systemPromptFile)))).toEqual([
				{ kind: "session", sessionId: "s-1" },
				{
					kind: "diagnostic",
					code: "unknown_event",
					message: "Unknown agent event type: future_item",
					eventType: "future_item",
					raw: {
						type: "item.completed",
						item: { type: "future_item" },
					},
				},
				{ kind: "turn_end" },
			]);
		});
	});

	test("preflight executes codex --version", async () => {
		const calls: Call[] = [];
		const adapter = new CodexAgentAdapter(replay([], calls));
		await adapter.preflight();

		expect(calls).toEqual([
			{ binary: "codex", args: ["--version"], cwd: process.cwd() },
		]);
	});

	test("maps turn.failed to an error followed by turn_end", async () => {
		const calls: Call[] = [];
		await withPrompt("System prompt", async (systemPromptFile) => {
			const adapter = new CodexAgentAdapter(
				replay(
					[
						jsonLine({
							type: "turn.failed",
							error: { message: "turn failed" },
						}),
					],
					calls,
				),
			);

			expect(await collect(adapter.run(makeTurn(systemPromptFile)))).toEqual([
				{ kind: "error", message: "turn failed" },
				{ kind: "turn_end" },
			]);
		});
	});

	test("suppresses a non-terminal top-level error when the turn completes", async () => {
		const calls: Call[] = [];
		await withPrompt("System prompt", async (systemPromptFile) => {
			const adapter = new CodexAgentAdapter(
				replay(
					[
						jsonLine({ type: "thread.started", thread_id: "s-1" }),
						jsonLine({ type: "error", message: "pending warning" }),
						jsonLine({ type: "turn.completed" }),
					],
					calls,
				),
			);

			expect(await collect(adapter.run(makeTurn(systemPromptFile)))).toEqual([
				{ kind: "session", sessionId: "s-1" },
				{ kind: "turn_end" },
			]);
		});
	});

	test("emits a pending top-level error when the stream ends", async () => {
		const calls: Call[] = [];
		await withPrompt("System prompt", async (systemPromptFile) => {
			const adapter = new CodexAgentAdapter(
				replay(
					[jsonLine({ type: "error", message: "pending failure" })],
					calls,
				),
			);

			expect(await collect(adapter.run(makeTurn(systemPromptFile)))).toEqual([
				{ kind: "error", message: "pending failure" },
				{ kind: "turn_end" },
			]);
		});
	});

	test("uses a pending top-level error when the executor throws", async () => {
		await withPrompt("System prompt", async (systemPromptFile) => {
			const exec: AgentExec = async function* () {
				yield jsonLine({ type: "error", message: "pending failure" });
				throw new Error("executor failed");
			};
			const adapter = new CodexAgentAdapter(exec);

			expect(await collect(adapter.run(makeTurn(systemPromptFile)))).toEqual([
				{ kind: "error", message: "pending failure" },
				{ kind: "turn_end" },
			]);
		});
	});

	test("reports an executor error while resuming an existing thread", async () => {
		await withPrompt("System prompt", async (systemPromptFile) => {
			const exec: AgentExec = () => {
				throw new PortError("thread not found");
			};
			const adapter = new CodexAgentAdapter(exec);

			expect(
				await collect(
					adapter.run(makeTurn(systemPromptFile, { sessionId: "s-1" })),
				),
			).toEqual([
				{ kind: "session", sessionId: "s-1" },
				{ kind: "error", message: "thread not found" },
				{ kind: "turn_end" },
			]);
		});
	});

	test("reports a missing session id when a successful stream omits it", async () => {
		const calls: Call[] = [];
		await withPrompt("System prompt", async (systemPromptFile) => {
			const adapter = new CodexAgentAdapter(replay([], calls));

			expect(await collect(adapter.run(makeTurn(systemPromptFile)))).toEqual([
				{ kind: "error", message: "Codex did not emit a session id" },
				{ kind: "turn_end" },
			]);
		});
	});

	test("stops yielding after aborting mid-stream", async () => {
		await withPrompt("System prompt", async (systemPromptFile) => {
			const exec: AgentExec = async function* () {
				yield jsonLine({ type: "thread.started", thread_id: "s-1" });
				yield jsonLine({
					type: "item.completed",
					item: { type: "agent_message", text: "must not be emitted" },
				});
			};
			const adapter = new CodexAgentAdapter(exec);
			const controller = new AbortController();
			const iterator = adapter
				.run(makeTurn(systemPromptFile, { signal: controller.signal }))
				[Symbol.asyncIterator]();

			expect(await iterator.next()).toEqual({
				done: false,
				value: { kind: "session", sessionId: "s-1" },
			});
			controller.abort();
			expect(await iterator.next()).toEqual({ done: true, value: undefined });
		});
	});

	test("reports an unreadable system prompt without executing Codex", async () => {
		const dir = await mkdtemp(join(tmpdir(), "codex-test-"));
		const calls: Call[] = [];
		try {
			const adapter = new CodexAgentAdapter(replay([], calls));
			const events = await collect(
				adapter.run(makeTurn(join(dir, "missing-system-prompt.md"))),
			);

			expect(events[0]?.kind).toBe("error");
			expect(events.slice(1)).toEqual([{ kind: "turn_end" }]);
			expect(calls).toEqual([]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

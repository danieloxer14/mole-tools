import { describe, expect, test } from "bun:test";
import type { PortError } from "../../core/errors";
import { parseAgentEvent } from "../../ports/review-agent";
import type { AgentExec } from "./exec";
import { defaultAgentExec } from "./exec";

async function collect(source: AsyncIterable<string>): Promise<string[]> {
	const lines: string[] = [];
	for await (const line of source) lines.push(line);
	return lines;
}

function scripted(lines: string[]): AgentExec {
	return async function* (_binary, _args, opts) {
		for (const line of lines) {
			if (opts.signal?.aborted) return;
			yield line;
		}
	};
}
async function readFixture(name: string): Promise<string[]> {
	const text = await Bun.file(
		new URL(`../../../test/fixtures/agent/${name}`, import.meta.url),
	).text();
	return text.split(/\r?\n/).filter((line) => line.length > 0);
}

describe("agent executor", () => {
	test("injected executors preserve NDJSON order and expose malformed/unknown lines", async () => {
		const exec = scripted([
			'{"type":"session","id":"fixture-session"}',
			"not-json",
			'{"type":"future_provider_event","value":true}',
			'{"type":"text","delta":"done"}',
		]);
		const lines = await collect(exec("unused", [], { cwd: process.cwd() }));

		expect(lines).toEqual([
			'{"type":"session","id":"fixture-session"}',
			"not-json",
			'{"type":"future_provider_event","value":true}',
			'{"type":"text","delta":"done"}',
		]);
		expect(lines.map(parseAgentEvent)).toEqual([
			{ kind: "session", sessionId: "fixture-session" },
			{
				kind: "error",
				message: "Malformed agent event: invalid JSON (not-json)",
			},
			{
				kind: "diagnostic",
				code: "unknown_event",
				message: "Unknown agent event type: future_provider_event",
				eventType: "future_provider_event",
				raw: { type: "future_provider_event", value: true },
			},
			{ kind: "text", delta: "done" },
		]);
	});

	test("replays raw provider NDJSON fixtures in order and reports envelopes", async () => {
		const fixtures = [
			{
				name: "omp-turn.ndjson",
				expectedKinds: [
					"session",
					"diagnostic",
					"diagnostic",
					"diagnostic",
					"diagnostic",
					"diagnostic",
					"diagnostic",
					"diagnostic",
					"diagnostic",
					"diagnostic",
					"diagnostic",
					"turn_end",
					"diagnostic",
				],
				expectedDiagnosticTypes: [
					"agent_start",
					"turn_start",
					"message_start",
					"message_update",
					"message_end",
					"tool_execution_start",
					"tool_execution_end",
					"message_start",
					"message_update",
					"message_end",
					"agent_end",
				],
			},
			{
				name: "claude-turn.ndjson",
				expectedKinds: [
					"diagnostic",
					"diagnostic",
					"diagnostic",
					"diagnostic",
					"diagnostic",
					"diagnostic",
					"diagnostic",
					"diagnostic",
					"diagnostic",
					"diagnostic",
					"diagnostic",
					"diagnostic",
				],
				expectedDiagnosticTypes: [
					"system",
					"stream_event",
					"stream_event",
					"stream_event",
					"stream_event",
					"stream_event",
					"stream_event",
					"stream_event",
					"stream_event",
					"stream_event",
					"stream_event",
					"result",
				],
			},
		] as const;

		for (const fixtureCase of fixtures) {
			const fixture = await readFixture(fixtureCase.name);
			const lines = await collect(
				scripted(fixture)("agent", [], { cwd: process.cwd() }),
			);

			expect(lines).toEqual(fixture);
			const events = lines.map(parseAgentEvent);
			expect(events.map((event) => event.kind)).toEqual(
				fixtureCase.expectedKinds,
			);
			expect(
				events.flatMap((event) =>
					event.kind === "diagnostic" ? [event.eventType] : [],
				),
			).toEqual(fixtureCase.expectedDiagnosticTypes);
		}
	});

	test("default executor splits stdout into ordered lines", async () => {
		const script = `process.stdout.write(${JSON.stringify(
			"first\nsecond\r\nlast",
		)})`;
		const lines = await collect(
			defaultAgentExec(process.execPath, ["-e", script], {
				cwd: process.cwd(),
			}),
		);

		expect(lines).toEqual(["first", "second", "last"]);
	});

	test("default executor surfaces non-zero exits for adapters", async () => {
		const script = `process.stderr.write("provider failed"); process.exit(7)`;
		await expect(
			collect(
				defaultAgentExec(process.execPath, ["-e", script], {
					cwd: process.cwd(),
				}),
			),
		).rejects.toMatchObject<Partial<PortError>>({
			message: "provider failed",
			stderr: "provider failed",
			code: 7,
		});
	});

	test("aborting kills the child and ends iteration without an error", async () => {
		const controller = new AbortController();
		const script =
			'process.stdout.write("first\\n"); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)';
		const iterator = defaultAgentExec(process.execPath, ["-e", script], {
			cwd: process.cwd(),
			signal: controller.signal,
		})[Symbol.asyncIterator]();

		expect(await iterator.next()).toEqual({
			done: false,
			value: "first",
		});
		controller.abort();
		await expect(iterator.next()).resolves.toEqual({
			done: true,
			value: undefined,
		});
	});
});

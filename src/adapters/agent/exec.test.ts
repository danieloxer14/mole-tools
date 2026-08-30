import { describe, expect, test } from "bun:test";
import type { PortError } from "../../core/errors";
import { defaultAgentExec } from "./exec";

async function collect(source: AsyncIterable<string>): Promise<string[]> {
	const lines: string[] = [];
	for await (const line of source) lines.push(line);
	return lines;
}

describe("agent executor", () => {
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

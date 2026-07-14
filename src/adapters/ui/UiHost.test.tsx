import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { UiController } from "./controller";
import { UiHost } from "./UiHost";

function terminalStream(): PassThrough & {
	isTTY: boolean;
	setRawMode: () => void;
	ref: () => void;
	unref: () => void;
} {
	const stream = new PassThrough() as PassThrough & {
		isTTY: boolean;
		setRawMode: () => void;
		ref: () => void;
		unref: () => void;
	};
	stream.isTTY = true;
	stream.setRawMode = () => {};
	stream.ref = () => {};
	stream.unref = () => {};
	return stream;
}

async function flushInput(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("UiHost", () => {
	test("clears multiSelect checks when the next request replaces the first", async () => {
		const controller = new UiController();
		const stdin = terminalStream();
		const stdout = terminalStream();
		const chunks: string[] = [];
		stdout.on("data", (chunk) => chunks.push(String(chunk)));
		const app = render(<UiHost controller={controller} />, {
			stdin: stdin as never,
			stdout: stdout as never,
			stderr: terminalStream() as never,
			debug: true,
		});

		const first = controller.request<string[]>((resolve) => ({
			kind: "multiSelect",
			q: "first repo",
			opts: [{ label: "first", value: "first" }],
			resolve,
		}));
		await app.waitUntilRenderFlush();
		await flushInput();
		stdin.write(" ");
		stdin.emit("readable");
		await flushInput();
		stdin.write("\r");
		stdin.emit("readable");
		expect(await first).toEqual(["first"]);

		const second = controller.request<string[]>((resolve) => ({
			kind: "multiSelect",
			q: "second repo",
			opts: [{ label: "second", value: "second" }],
			resolve,
		}));
		await app.waitUntilRenderFlush();
		await flushInput();
		const transcript = chunks.join("");
		expect(transcript).toContain("second repo");
		expect(transcript).toContain("[ ] second");
		expect(transcript).not.toContain("[x] second");
		stdin.write("\r");
		stdin.emit("readable");
		expect(await second).toEqual([]);
		app.unmount();
	});
});

import { expect, test } from "bun:test";
import { sseResponse } from "./sse";

test("reader cancel invokes onCancel", async () => {
	let canceled = false;
	async function* source() {
		yield { event: "text", data: { text: "hello" } };
		await new Promise<void>(() => {});
	}

	const response = sseResponse(source(), 1_000, () => {
		canceled = true;
	});
	const reader = response.body?.getReader();
	expect(reader).toBeDefined();
	await reader?.read();
	await reader?.cancel();
	expect(canceled).toBe(true);
});

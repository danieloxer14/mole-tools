import { expect, test } from "bun:test";
import { createProgressWriteQueue } from "./progress-write-queue";

test("serializes writes in order and continues after a failed write", async () => {
	const queue = createProgressWriteQueue();
	const order: string[] = [];
	const firstGate = Promise.withResolvers<void>();
	const first = queue.enqueue(async () => {
		order.push("first-start");
		await firstGate.promise;
		order.push("first-finish");
	});
	const second = queue.enqueue(async () => {
		order.push("second");
	});

	await Promise.resolve();
	expect(order).toEqual(["first-start"]);
	firstGate.resolve();
	await Promise.all([first, second]);
	expect(order).toEqual(["first-start", "first-finish", "second"]);

	const failure = new Error("progress write failed");
	const failedWrite = queue.enqueue(async () => {
		throw failure;
	});
	let laterWriteRan = false;
	const laterWrite = queue.enqueue(async () => {
		laterWriteRan = true;
	});

	await expect(failedWrite).rejects.toBe(failure);
	await laterWrite;
	expect(laterWriteRan).toBe(true);
});

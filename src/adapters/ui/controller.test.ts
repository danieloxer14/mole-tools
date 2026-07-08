import { describe, expect, test } from "bun:test";
import { UiController } from "./controller";

describe("UiController", () => {
	test("request sets the current slot and notifies listeners", () => {
		const controller = new UiController();
		let notified = false;
		controller.subscribe(() => {
			notified = true;
		});
		const promise = controller.request<boolean>((resolve) => ({
			kind: "confirm",
			q: "ok?",
			resolve,
		}));
		expect(controller.getSnapshot()?.kind).toBe("confirm");
		expect(notified).toBe(true);
		controller.resolveCurrent(true);
		return promise.then((v) => expect(v).toBe(true));
	});

	test("resolveCurrent clears the current slot and resolves the pending promise", async () => {
		const controller = new UiController();
		const promise = controller.request<string>((resolve) => ({
			kind: "editText",
			prompt: "edit",
			initial: "x",
			resolve,
		}));
		controller.resolveCurrent("edited");
		expect(controller.getSnapshot()).toBeNull();
		expect(await promise).toBe("edited");
	});

	test("resolveCurrent is a no-op when there is no pending request", () => {
		const controller = new UiController();
		expect(() => controller.resolveCurrent("x")).not.toThrow();
	});

	test("request exposes a reject callback that rejects the pending promise", async () => {
		const controller = new UiController();
		const promise = controller.request<string>((resolve, reject) => ({
			kind: "stream",
			source: (async function* () {})(),
			resolve,
			reject,
		}));
		const boom = new Error("boom");
		const req = controller.getSnapshot();
		expect(req?.kind).toBe("stream");
		if (req?.kind === "stream") req.reject(boom);
		await expect(promise).rejects.toThrow("boom");
	});

	test("pushLog appends entries and notifies subscribers", () => {
		const controller = new UiController();
		let calls = 0;
		controller.subscribe(() => {
			calls++;
		});
		controller.pushLog("info", "hello");
		expect(controller.getLogSnapshot()).toEqual([
			{ id: 0, level: "info", text: "hello" },
		]);
		expect(calls).toBe(1);
	});

	test("unsubscribe stops further notifications", () => {
		const controller = new UiController();
		let calls = 0;
		const unsubscribe = controller.subscribe(() => {
			calls++;
		});
		unsubscribe();
		controller.pushLog("warn", "hi");
		expect(calls).toBe(0);
	});
});

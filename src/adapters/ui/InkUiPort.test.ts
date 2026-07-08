import { describe, expect, test } from "bun:test";
import { UiController } from "./controller";
import { InkUiPort } from "./InkUiPort";

async function* chunks(parts: string[]) {
	for (const p of parts) yield p;
}

describe("InkUiPort", () => {
	test("info/warn/error push to the controller log and resolve immediately", async () => {
		const controller = new UiController();
		const ui = new InkUiPort(controller);
		await ui.info("hello");
		await ui.warn("careful");
		await ui.error("boom");
		expect(controller.getLogSnapshot()).toEqual([
			{ id: 0, level: "info", text: "hello" },
			{ id: 1, level: "warn", text: "careful" },
			{ id: 2, level: "error", text: "boom" },
		]);
	});

	test("confirm resolves through the controller's current request", async () => {
		const controller = new UiController();
		const ui = new InkUiPort(controller);
		const promise = ui.confirm("proceed?");
		expect(controller.getSnapshot()).toMatchObject({
			kind: "confirm",
			q: "proceed?",
		});
		controller.resolveCurrent(true);
		expect(await promise).toBe(true);
	});

	test("select resolves with the chosen value", async () => {
		const controller = new UiController();
		const ui = new InkUiPort(controller);
		const promise = ui.select("pick", [
			{ label: "A", value: "a" },
			{ label: "B", value: "b" },
		]);
		controller.resolveCurrent("b");
		expect(await promise).toBe("b");
	});

	test("multiSelect resolves with an array of chosen values", async () => {
		const controller = new UiController();
		const ui = new InkUiPort(controller);
		const promise = ui.multiSelect("pick many", [{ label: "A", value: "a" }]);
		controller.resolveCurrent(["a"]);
		expect(await promise).toEqual(["a"]);
	});

	test("editText resolves with the edited string", async () => {
		const controller = new UiController();
		const ui = new InkUiPort(controller);
		const promise = ui.editText("edit", "initial");
		expect(controller.getSnapshot()).toMatchObject({
			kind: "editText",
			initial: "initial",
		});
		controller.resolveCurrent("changed");
		expect(await promise).toBe("changed");
	});

	test("editMultiline resolves with the edited string", async () => {
		const controller = new UiController();
		const ui = new InkUiPort(controller);
		const promise = ui.editMultiline("edit", "initial");
		controller.resolveCurrent("changed\nmore");
		expect(await promise).toBe("changed\nmore");
	});

	test("stream request carries the async source and resolves with accumulated text", async () => {
		const controller = new UiController();
		const ui = new InkUiPort(controller);
		const promise = ui.stream(chunks(["a", "b"]), "generating");
		expect(controller.getSnapshot()).toMatchObject({
			kind: "stream",
			label: "generating",
		});
		controller.resolveCurrent("ab");
		expect(await promise).toBe("ab");
	});

	test("stream request exposes a reject callback so a failed generation propagates", async () => {
		const controller = new UiController();
		const ui = new InkUiPort(controller);
		const promise = ui.stream(chunks(["a"]), "generating");
		const req = controller.getSnapshot();
		if (req?.kind === "stream") req.reject(new Error("daemon unreachable"));
		await expect(promise).rejects.toThrow("daemon unreachable");
	});
});

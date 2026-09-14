import { expect, test } from "bun:test";
import { FakeUiPort } from "../../test/fakes/FakeUiPort";
import {
	AbortError,
	handleError,
	PortError,
	UserRejectedError,
} from "./errors";

test("user rejection exits 1 without reporting", async () => {
	const ui = new FakeUiPort();

	expect(await handleError(new UserRejectedError("nope"), ui)).toBe(1);
	expect(ui.transcript).toEqual([]);
});

test("abort reports its message and exits 1", async () => {
	const ui = new FakeUiPort();

	expect(await handleError(new AbortError("stopped"), ui)).toBe(1);
	expect(ui.transcript).toEqual([{ kind: "error", text: "stopped" }]);
});

test("port error reports its message and propagates its code", async () => {
	const ui = new FakeUiPort();
	const err = new PortError("glab failed", "stderr text", 7);

	expect(err.stderr).toBe("stderr text");
	expect(await handleError(err, ui)).toBe(7);
	expect(ui.transcript).toEqual([{ kind: "error", text: "glab failed" }]);
});

test("port error defaults to code 1", async () => {
	const ui = new FakeUiPort();

	expect(await handleError(new PortError("boom"), ui)).toBe(1);
});

test("unknown throwables are stringified and exit 1", async () => {
	const ui = new FakeUiPort();

	expect(await handleError("raw string", ui)).toBe(1);
	expect(await handleError(new Error("plain"), ui)).toBe(1);
	expect(ui.transcript).toEqual([
		{ kind: "error", text: "raw string" },
		{ kind: "error", text: "Error: plain" },
	]);
});

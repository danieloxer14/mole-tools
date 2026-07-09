import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "../../core/context";
import { UserRejectedError } from "../../core/errors";
import type { Choice, UiPort } from "../../ports/ui";
import { runInit } from "./index";

let dir: string;

function stubUi(confirmResult = true): UiPort {
	const notImplemented = () => {
		throw new Error("not implemented");
	};
	return {
		info: async () => {},
		warn: notImplemented,
		error: notImplemented,
		confirm: async () => confirmResult,
		select: async <T>(_q: string, opts: Choice<T>[]) => opts[0]?.value as T,
		multiSelect: notImplemented,
		editText: notImplemented,
		editMultiline: notImplemented,
		stream: notImplemented,
		pause: notImplemented,
	};
}

function fakeContext(ui: UiPort): Context {
	return { ui } as unknown as Context;
}

afterEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
});

describe("runInit", () => {
	test("writes the template when no config exists", async () => {
		dir = await mkdtemp(join(tmpdir(), "mole-tools-init-"));
		const path = join(dir, "config.json");
		const result = await runInit(fakeContext(stubUi()), path);
		expect(result).toEqual({ wrote: true, path });
		expect(await Bun.file(path).exists()).toBe(true);
	});

	test("overwrites an existing config when the user confirms", async () => {
		dir = await mkdtemp(join(tmpdir(), "mole-tools-init-"));
		const path = join(dir, "config.json");
		await Bun.write(path, "{}");
		const result = await runInit(fakeContext(stubUi(true)), path);
		expect(result.wrote).toBe(true);
		expect(await Bun.file(path).text()).not.toBe("{}");
	});

	test("throws UserRejectedError when user declines overwrite", async () => {
		dir = await mkdtemp(join(tmpdir(), "mole-tools-init-"));
		const path = join(dir, "config.json");
		await Bun.write(path, "{}");
		await expect(runInit(fakeContext(stubUi(false)), path)).rejects.toThrow(
			UserRejectedError,
		);
	});
});

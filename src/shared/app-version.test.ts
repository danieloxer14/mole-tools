import { describe, expect, test } from "bun:test";
import { APP_VERSION, isNewerVersion, parseVersion } from "./app-version";

describe("parseVersion", () => {
	test("parses a version with an optional leading v", () => {
		expect(parseVersion("v0.9.0")).toEqual([0, 9, 0]);
		expect(parseVersion("0.9.0")).toEqual([0, 9, 0]);
	});

	for (const value of ["1.0.0-beta", "1.0", "abc", ""]) {
		test(`returns null for malformed version ${JSON.stringify(value)}`, () => {
			expect(parseVersion(value)).toBeNull();
		});
	}
});

describe("isNewerVersion", () => {
	test("compares version components numerically and strictly", () => {
		expect(isNewerVersion("0.10.0", "0.9.0")).toBe(true);
		expect(isNewerVersion("v1.0.0", "0.9.9")).toBe(true);
		expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
		expect(isNewerVersion("0.9.0", "1.0.0")).toBe(false);
	});

	for (const value of ["1.0.0-beta", "1.0", "abc", ""]) {
		test(`returns false when ${JSON.stringify(value)} is malformed`, () => {
			expect(isNewerVersion(value, "0.9.0")).toBe(false);
			expect(isNewerVersion("1.0.0", value)).toBe(false);
		});
	}
});

test("APP_VERSION matches package.json", async () => {
	const packageJson = await Bun.file(
		new URL("../../package.json", import.meta.url),
	).json();

	expect(APP_VERSION).toBe(packageJson.version);
});

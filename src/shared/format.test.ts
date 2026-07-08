import { describe, expect, test } from "bun:test";
import { checkFormat } from "./format";

describe("checkFormat", () => {
	test("accepts a valid conventional subject with no body", () => {
		expect(checkFormat("feat: add commit tool")).toEqual({ ok: true });
	});

	test("accepts a valid subject with scope and body separated by blank line", () => {
		expect(checkFormat("fix(cli): handle empty diff\n\nExplains why.")).toEqual(
			{ ok: true },
		);
	});

	test("rejects a subject missing the conventional prefix", () => {
		const result = checkFormat("add commit tool");
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.violations.length).toBeGreaterThan(0);
	});

	test("rejects an unknown type", () => {
		const result = checkFormat("feature: add commit tool");
		expect(result.ok).toBe(false);
	});

	test("rejects a subject over 72 characters", () => {
		const long = `feat: ${"x".repeat(70)}`;
		const result = checkFormat(long);
		expect(result.ok).toBe(false);
		expect(
			result.ok === false && result.violations.some((v) => v.includes("72")),
		).toBe(true);
	});

	test("rejects a body with no blank line before it", () => {
		const result = checkFormat("feat: add commit tool\nBody text right away");
		expect(result.ok).toBe(false);
		expect(
			result.ok === false &&
				result.violations.some((v) => v.includes("Blank line")),
		).toBe(true);
	});

	test("accumulates multiple violations", () => {
		const result = checkFormat(`bad subject\nBody without blank line`);
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.violations.length).toBeGreaterThan(1);
	});
});

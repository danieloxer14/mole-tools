import { describe, expect, test } from "bun:test";
import { estimateTokens, truncateWords } from "./text";

describe("truncateWords", () => {
	test("returns text unchanged when under the limit", () => {
		expect(truncateWords("one two three", 5)).toBe("one two three");
	});

	test("returns text unchanged when exactly at the limit", () => {
		expect(truncateWords("one two three", 3)).toBe("one two three");
	});

	test("truncates and appends an ellipsis when over the limit", () => {
		expect(truncateWords("one two three four", 2)).toBe("one two ...");
	});

	test("handles empty text", () => {
		expect(truncateWords("", 5)).toBe("");
	});
});

describe("estimateTokens", () => {
	test("returns 0 for empty text", () => {
		expect(estimateTokens("")).toBe(0);
	});

	test("rounds up to the nearest token", () => {
		expect(estimateTokens("abcde")).toBe(2);
	});

	test("estimates roughly 4 characters per token", () => {
		expect(estimateTokens("a".repeat(100))).toBe(25);
	});
});

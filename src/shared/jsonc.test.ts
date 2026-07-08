import { describe, expect, test } from "bun:test";
import { stripJsonComments } from "./jsonc";

describe("stripJsonComments", () => {
	test("removes a line comment on its own line", () => {
		const input = '{\n  "a": 1,\n  // "b": 2\n  "c": 3\n}';
		expect(JSON.parse(stripJsonComments(input))).toEqual({ a: 1, c: 3 });
	});

	test("removes a block comment", () => {
		const input = '{ "a": 1 /* disabled: "b": 2 */ }';
		expect(JSON.parse(stripJsonComments(input))).toEqual({ a: 1 });
	});

	test("does not strip // or /* inside string values", () => {
		const input =
			'{ "url": "https://example.com", "note": "/* not a comment */" }';
		expect(JSON.parse(stripJsonComments(input))).toEqual({
			url: "https://example.com",
			note: "/* not a comment */",
		});
	});

	test("handles escaped quotes inside strings without ending the string early", () => {
		const input = String.raw`{ "a": "she said \"hi\" // not a comment" }`;
		expect(JSON.parse(stripJsonComments(input))).toEqual({
			a: 'she said "hi" // not a comment',
		});
	});

	test("leaves plain JSON with no comments unchanged in meaning", () => {
		const input = '{ "a": 1, "b": [1, 2, 3] }';
		expect(JSON.parse(stripJsonComments(input))).toEqual({
			a: 1,
			b: [1, 2, 3],
		});
	});
});

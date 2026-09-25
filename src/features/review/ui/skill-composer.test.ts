import { expect, test } from "bun:test";
import {
	activeSlashQuery,
	atomicTokenDelete,
	insertSkillAtCaret,
	replaceWithSkillToken,
} from "./skill-composer";

const skillNames = new Set(["review-it", "summarize"]);

test("active slash query requires a slash at a whitespace boundary", () => {
	expect(activeSlashQuery("a/b", 3, 3)).toBeNull();
	expect(activeSlashQuery("/", 1, 1)).toEqual({
		start: 0,
		end: 1,
		query: "",
	});
});

test("active slash query reads the prefix up to a caret inside a name", () => {
	const text = "please /review-it now";
	const caret = text.indexOf("review") + 2;

	expect(activeSlashQuery(text, caret, caret)).toEqual({
		start: 7,
		end: caret,
		query: "re",
	});
});

test("active slash query rejects a non-collapsed selection", () => {
	expect(activeSlashQuery("/review-it", 4, 5)).toBeNull();
});

test("replaces slash query and preserves existing trailing whitespace", () => {
	expect(
		replaceWithSkillToken("/re and more", { start: 0, end: 3 }, "review-it"),
	).toEqual({
		text: "/review-it and more",
		caret: 11,
	});
	expect(
		replaceWithSkillToken("/re", { start: 0, end: 3 }, "review-it"),
	).toEqual({
		text: "/review-it ",
		caret: 11,
	});
});

test("inserts a token with a leading separator only when needed", () => {
	expect(insertSkillAtCaret("hello", 5, "review-it")).toEqual({
		text: "hello /review-it ",
		caret: 17,
	});
	expect(insertSkillAtCaret("hello ", 6, "review-it")).toEqual({
		text: "hello /review-it ",
		caret: 17,
	});
});

test("insertion reuses existing trailing whitespace", () => {
	expect(insertSkillAtCaret("hello  world", 6, "review-it")).toEqual({
		text: "hello /review-it world",
		caret: 17,
	});
});

test("Backspace deletes a token at its end or from inside it", () => {
	const text = "before /review-it after";

	expect(atomicTokenDelete(text, 17, 17, "Backspace", skillNames)).toEqual({
		text: "before  after",
		caret: 7,
	});
	expect(atomicTokenDelete(text, 12, 12, "Backspace", skillNames)).toEqual({
		text: "before  after",
		caret: 7,
	});
});

test("Delete deletes a token at its start", () => {
	expect(
		atomicTokenDelete("/summarize next", 0, 0, "Delete", skillNames),
	).toEqual({ text: " next", caret: 0 });
});

test("atomic token deletion ignores non-collapsed selections", () => {
	expect(
		atomicTokenDelete("/review-it", 2, 3, "Backspace", skillNames),
	).toBeNull();
});

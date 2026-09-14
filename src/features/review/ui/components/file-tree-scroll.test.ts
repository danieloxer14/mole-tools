/// <reference lib="dom" />
import { expect, test } from "bun:test";
import { scrollSelectedFileRow } from "./file-tree-scroll";

function fakeRow() {
	const calls: ScrollIntoViewOptions[] = [];
	const element = {
		scrollIntoView(options?: ScrollIntoViewOptions) {
			calls.push(options ?? {});
		},
	} as unknown as HTMLElement;
	return { element, calls };
}

test("a null path scrolls nothing", () => {
	const { element, calls } = fakeRow();
	const rows = new Map<string, HTMLElement>([["src/a.ts", element]]);
	scrollSelectedFileRow(rows, null);
	expect(calls).toEqual([]);
});

test("a path with no registered row scrolls nothing", () => {
	const { element, calls } = fakeRow();
	const rows = new Map<string, HTMLElement>([["src/a.ts", element]]);
	scrollSelectedFileRow(rows, "src/other.ts");
	expect(calls).toEqual([]);
});

test("the registered row scrolls into view with nearest", () => {
	const { element, calls } = fakeRow();
	const rows = new Map<string, HTMLElement>([["src/a.ts", element]]);
	scrollSelectedFileRow(rows, "src/a.ts");
	expect(calls).toEqual([{ block: "nearest" }]);
});

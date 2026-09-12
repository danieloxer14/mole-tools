import { expect, test } from "bun:test";
import { type ComposerEnterKey, composerEnterAction } from "./composer-keydown";

function enterKey(overrides: Partial<ComposerEnterKey> = {}): ComposerEnterKey {
	return {
		key: "Enter",
		shift: false,
		meta: false,
		ctrl: false,
		composing: false,
		...overrides,
	};
}

test("plain Enter cancels the default action and sends", () => {
	expect(composerEnterAction(enterKey())).toEqual({
		prevent: true,
		send: true,
	});
});

test("Shift+Enter keeps the native newline and does not send", () => {
	expect(composerEnterAction(enterKey({ shift: true }))).toEqual({
		prevent: false,
		send: false,
	});
});

test("Ctrl+Enter and ⌘+Enter cancel the implicit form submission without sending", () => {
	expect(composerEnterAction(enterKey({ ctrl: true }))).toEqual({
		prevent: true,
		send: false,
	});
	expect(composerEnterAction(enterKey({ meta: true }))).toEqual({
		prevent: true,
		send: false,
	});
});

test("no modifier combination with Enter sends", () => {
	expect(composerEnterAction(enterKey({ shift: true, meta: true }))).toEqual({
		prevent: true,
		send: false,
	});
	expect(composerEnterAction(enterKey({ shift: true, ctrl: true }))).toEqual({
		prevent: true,
		send: false,
	});
	expect(
		composerEnterAction(enterKey({ shift: true, meta: true, ctrl: true })),
	).toEqual({
		prevent: true,
		send: false,
	});
});

test("Enter during an IME composition only confirms the composition", () => {
	expect(composerEnterAction(enterKey({ composing: true }))).toEqual({
		prevent: false,
		send: false,
	});
	expect(
		composerEnterAction(enterKey({ shift: true, composing: true })),
	).toEqual({
		prevent: false,
		send: false,
	});
});

test("keys other than Enter are ignored", () => {
	expect(composerEnterAction(enterKey({ key: "a" }))).toEqual({
		prevent: false,
		send: false,
	});
	expect(composerEnterAction(enterKey({ key: "Escape" }))).toEqual({
		prevent: false,
		send: false,
	});
});

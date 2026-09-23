import { expect, test } from "bun:test";
import { fromChatAvailability } from "./from-chat";

const assistantReply = [{ role: "assistant", text: "A reply" }] as const;

function input(
	overrides: Partial<Parameters<typeof fromChatAvailability>[0]> = {},
): Parameters<typeof fromChatAvailability>[0] {
	return {
		chat: { title: "Review chat" },
		chatIndex: 0,
		busy: false,
		loaded: true,
		entries: assistantReply,
		...overrides,
	};
}

test("disables when no chat is selected", () => {
	expect(fromChatAvailability(input({ chat: null }))).toEqual({
		kind: "disabled",
		reason: "Selected chat has no replies yet",
	});
});

test("busy takes precedence over transcript readiness", () => {
	expect(fromChatAvailability(input({ busy: true, loaded: false }))).toEqual({
		kind: "disabled",
		reason: "Wait for the chat reply to finish",
	});
});

test("reports loading before checking replies", () => {
	expect(fromChatAvailability(input({ loaded: false, entries: [] }))).toEqual({
		kind: "disabled",
		reason: "Loading chat…",
	});
});

test("disables when assistant entries have no non-blank text", () => {
	expect(
		fromChatAvailability(
			input({
				entries: [
					{ role: "user", text: "Question" },
					{ role: "assistant", text: " \n\t" },
				],
			}),
		),
	).toEqual({
		kind: "disabled",
		reason: "Selected chat has no replies yet",
	});
});

test("returns the titled chat label when ready", () => {
	expect(fromChatAvailability(input())).toEqual({
		kind: "ready",
		chatLabel: "Review chat",
	});
});

test("labels an untitled chat using its one-based index", () => {
	expect(
		fromChatAvailability(input({ chat: { title: "" }, chatIndex: 1 })),
	).toEqual({ kind: "ready", chatLabel: "New chat 2" });
});

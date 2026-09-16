import { expect, test } from "bun:test";
import { createRequestSequence } from "./chat-request-sequence";

test("only newest request for a chat remains current", () => {
	const requests = createRequestSequence();
	const first = requests.next("chat-a");
	const second = requests.next("chat-a");

	expect(requests.isCurrent("chat-a", first)).toBe(false);
	expect(requests.isCurrent("chat-a", second)).toBe(true);
});

test("invalidating a chat makes an in-flight history response stale", () => {
	const requests = createRequestSequence();
	const historyRequest = requests.next("chat-b");
	requests.next("chat-b");

	expect(requests.isCurrent("chat-b", historyRequest)).toBe(false);
});

test("request freshness is independent for concurrent chats", () => {
	const requests = createRequestSequence();
	const chatA = requests.next("chat-a");
	const chatB = requests.next("chat-b");

	expect(requests.isCurrent("chat-a", chatA)).toBe(true);
	expect(requests.isCurrent("chat-b", chatB)).toBe(true);
});

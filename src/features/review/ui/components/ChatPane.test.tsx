import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatPane } from "./ChatPane";

test("renders general discussions collapsed by default", () => {
	const markup = renderToStaticMarkup(
		<ChatPane
			transcript={[]}
			tags={[]}
			chats={[
				{
					id: "chat-1",
					title: "First chat",
					createdAt: "2026-08-24T00:00:00Z",
					busy: false,
				},
			]}
			activeChatId="chat-1"
			onSelectChat={() => {}}
			onNewChat={() => {}}
			draft=""
			onDraftChange={() => {}}
			discussions={[
				{
					id: "discussion-1",
					resolved: false,
					position: null,
					notes: [
						{
							id: "note-1",
							author: "reviewer",
							body: "Please rename this.",
							createdAt: "2026-08-24T00:00:00Z",
							system: false,
						},
					],
				},
			]}
			streamingText=""
			tools={[]}
			error={null}
			sending={false}
			stopping={false}
			onSend={() => {}}
			onStop={() => {}}
			onRemoveTag={() => {}}
		/>,
	);

	expect(markup).toContain(
		'<details class="discussion-list" aria-label="General discussions">',
	);
	expect(markup).toContain("<summary>General discussions</summary>");
	expect(markup).not.toMatch(/<details[^>]*\sopen(?:=|[\s>])/);
	expect(markup).toContain("Please rename this.");
});

test("renders one switcher item per chat with active and busy state", () => {
	const markup = renderToStaticMarkup(
		<ChatPane
			transcript={[]}
			tags={[]}
			chats={[
				{
					id: "chat-1",
					title: "",
					createdAt: "2026-08-24T00:00:00Z",
					busy: false,
				},
				{
					id: "chat-2",
					title: "Investigate API",
					createdAt: "2026-08-24T01:00:00Z",
					busy: true,
				},
			]}
			activeChatId="chat-2"
			onSelectChat={() => {}}
			onNewChat={() => {}}
			draft=""
			onDraftChange={() => {}}
			streamingText=""
			tools={[]}
			error={null}
			sending={false}
			stopping={false}
			onSend={() => {}}
			onStop={() => {}}
			onRemoveTag={() => {}}
		/>,
	);

	expect(markup.match(/class="chat-switcher-item"/g)).toHaveLength(2);
	expect(markup).toContain("New chat 1");
	expect(markup).toContain('aria-current="true"');
	expect(markup.match(/aria-label="Turn running"/g)).toHaveLength(1);
	expect(markup).toContain("New chat");
	expect(markup).not.toContain("Clear chat");
});

test("renders parent-owned composer draft", () => {
	const markup = renderToStaticMarkup(
		<ChatPane
			transcript={[]}
			tags={[]}
			chats={[
				{
					id: "chat-1",
					title: "First chat",
					createdAt: "2026-08-24T00:00:00Z",
					busy: false,
				},
			]}
			activeChatId="chat-1"
			onSelectChat={() => {}}
			onNewChat={() => {}}
			draft="unsent question"
			onDraftChange={() => {}}
			streamingText=""
			tools={[]}
			error={null}
			sending={false}
			stopping={false}
			onSend={() => {}}
			onStop={() => {}}
			onRemoveTag={() => {}}
		/>,
	);

	expect(markup).toContain(">unsent question</textarea>");
});

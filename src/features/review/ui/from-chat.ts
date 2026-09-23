import { type ChatSummary, chatLabel } from "./components/ChatPane";

export type FromChatAvailability =
	| { kind: "ready"; chatLabel: string }
	| { kind: "disabled"; reason: string };

export type DraftGeneration =
	| { status: "running" }
	| { status: "failed"; error: string };

export interface FromChatContext {
	availability: FromChatAvailability;
	generations: Readonly<Record<string, DraftGeneration>>;
	onGenerate: (draftId: string) => void;
	onStop: (draftId: string) => void;
}

const NO_REPLIES = "Selected chat has no replies yet";

export function fromChatAvailability(input: {
	chat: { title: string } | null;
	chatIndex: number;
	busy: boolean;
	loaded: boolean;
	entries: readonly { role: string; text: string }[];
}): FromChatAvailability {
	if (input.chat === null) return { kind: "disabled", reason: NO_REPLIES };
	if (input.busy) {
		return { kind: "disabled", reason: "Wait for the chat reply to finish" };
	}
	if (!input.loaded) return { kind: "disabled", reason: "Loading chat…" };
	if (
		!input.entries.some(
			(entry) => entry.role === "assistant" && entry.text.trim().length > 0,
		)
	) {
		return { kind: "disabled", reason: NO_REPLIES };
	}

	const summary: ChatSummary = {
		id: "",
		title: input.chat.title,
		createdAt: "",
		busy: input.busy,
		agent: null,
		model: null,
	};
	return {
		kind: "ready",
		chatLabel: chatLabel(summary, input.chatIndex),
	};
}

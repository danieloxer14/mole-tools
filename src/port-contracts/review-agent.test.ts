import { describe, expect, test } from "bun:test";
import { FakeReviewAgent } from "../../test/fakes/FakeReviewAgent";
import type { AgentEvent, ReviewAgent } from "../ports/review-agent";

async function collect(
	source: AsyncIterable<AgentEvent>,
): Promise<AgentEvent[]> {
	const events: AgentEvent[] = [];
	for await (const event of source) events.push(event);
	return events;
}

describe("ReviewAgent port contract", () => {
	test("emits one session before text and ends successful turns", async () => {
		const agent: ReviewAgent = new FakeReviewAgent({
			events: [
				{ kind: "session", sessionId: "session-1" },
				{ kind: "text", delta: "first" },
				{ kind: "tool", name: "read", phase: "start" },
				{ kind: "tool", name: "read", phase: "end" },
				{ kind: "text", delta: "second" },
				{
					kind: "diagnostic",
					code: "unknown_event",
					message: "provider event ignored",
					eventType: "future",
					raw: { type: "future" },
				},
				{ kind: "turn_end" },
			],
		});

		const events = await collect(
			agent.run({
				sessionId: "session-1",
				cwd: "/repo",
				systemPromptFile: "/prompts/review.md",
				message: "Review this change",
			}),
		);
		const sessionIndexes = events.flatMap((event, index) =>
			event.kind === "session" ? [index] : [],
		);
		const textIndexes = events.flatMap((event, index) =>
			event.kind === "text" ? [index] : [],
		);

		expect(sessionIndexes).toEqual([0]);
		expect(textIndexes[0]).toBeGreaterThan(sessionIndexes[0] ?? -1);
		expect(events[0]).toEqual({ kind: "session", sessionId: "session-1" });
		expect(events.at(-1)).toEqual({ kind: "turn_end" });
	});

	test("uses supplied session ID for a new default conversation", async () => {
		const agent = new FakeReviewAgent();
		const events = await collect(
			agent.run({
				sessionId: "resume-session",
				cwd: "/repo",
				systemPromptFile: "/prompts/review.md",
				message: "Continue review",
			}),
		);

		expect(events[0]).toEqual({
			kind: "session",
			sessionId: "resume-session",
		});
	});

	test("reports one typed error before turn_end", async () => {
		const agent: ReviewAgent = new FakeReviewAgent({
			events: [
				{ kind: "session", sessionId: "failed-session" },
				{ kind: "error", message: "provider exited" },
				{ kind: "turn_end" },
			],
		});

		const events = await collect(
			agent.run({
				cwd: "/repo",
				systemPromptFile: "/prompts/review.md",
				message: "Review this change",
			}),
		);

		expect(events.filter((event) => event.kind === "error")).toEqual([
			{ kind: "error", message: "provider exited" },
		]);
		expect(events.at(-1)).toEqual({ kind: "turn_end" });
	});

	test("aborting a run stops iteration without throwing", async () => {
		const controller = new AbortController();
		const agent = new FakeReviewAgent();
		const iterator = agent
			.run({
				cwd: "/repo",
				systemPromptFile: "/prompts/review.md",
				message: "Review this change",
				signal: controller.signal,
			})
			[Symbol.asyncIterator]();

		expect(await iterator.next()).toEqual({
			done: false,
			value: { kind: "session", sessionId: "fake-session-1" },
		});
		controller.abort();
		await expect(iterator.next()).resolves.toEqual({
			done: true,
			value: undefined,
		});
	});
});

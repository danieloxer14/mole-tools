import { describe, expect, test } from "bun:test";
import type { AgentEvent, ReviewAgent } from "../../ports/review-agent";
import { runAgentFileAttempt } from "./agent-attempt";

const stringSchema = {
	safeParse(
		value: unknown,
	):
		| { success: true; data: string }
		| { success: false; error: { message: string } } {
		return typeof value === "string"
			? { success: true, data: value }
			: { success: false, error: { message: "expected string" } };
	},
};

describe("review agent attempt", () => {
	test("text capture keeps only assistant text after the last tool boundary", async () => {
		const events: AgentEvent[] = [
			{ kind: "text", delta: "Preamble before tools.\n" },
			{ kind: "tool", name: "search", phase: "start" },
			{ kind: "text", delta: "Narration among tools.\n" },
			{ kind: "tool", name: "search", phase: "end" },
			{ kind: "tool", name: "read", phase: "start" },
			{ kind: "tool", name: "read", phase: "end" },
			{ kind: "text", delta: "# Final one-pager\n" },
			{ kind: "text", delta: "Only this Markdown remains.\n" },
			{ kind: "turn_end" },
		];
		const agent: ReviewAgent = {
			async preflight() {},
			async *run() {
				yield* events;
			},
		};

		const result = await runAgentFileAttempt({
			agent,
			cwd: "/tmp",
			systemPromptFile: "/tmp/system-prompt",
			message: "Generate one-pager",
			timeoutSeconds: 1,
			label: "one-pager",
			format: "text",
			schema: stringSchema,
		});

		expect(result).toEqual({
			ok: true,
			doc: "# Final one-pager\nOnly this Markdown remains.\n",
		});
	});
});

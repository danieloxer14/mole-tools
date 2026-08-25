import type {
	AgentEvent,
	AgentTurn,
	ReviewAgent,
} from "../../src/ports/review-agent";

export interface FakeReviewAgentOptions {
	events?: AgentEvent[];
	runs?: AgentEvent[][];
	preflightError?: Error;
	runError?: Error;
}

export class FakeReviewAgent implements ReviewAgent {
	readonly turns: AgentTurn[] = [];
	preflightCalls = 0;
	private runIndex = 0;

	constructor(private readonly opts: FakeReviewAgentOptions = {}) {}

	async preflight(): Promise<void> {
		this.preflightCalls++;
		if (this.opts.preflightError) throw this.opts.preflightError;
	}

	async *run(turn: AgentTurn): AsyncIterable<AgentEvent> {
		this.turns.push(turn);
		if (turn.signal?.aborted) return;
		if (this.opts.runError) throw this.opts.runError;
		const index = this.runIndex++;
		const configured =
			this.opts.runs?.[Math.min(index, this.opts.runs.length - 1)] ??
			this.opts.events;
		const events =
			configured ??
			([
				{
					kind: "session",
					sessionId: turn.sessionId ?? `fake-session-${index + 1}`,
				},
				{ kind: "text", delta: "fake response" },
				{ kind: "turn_end" },
			] satisfies AgentEvent[]);

		for (const event of events) {
			if (turn.signal?.aborted) return;
			yield event;
		}
	}
}

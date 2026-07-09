import { z } from "zod";
import { listCostSessions } from "../../adapters/cost-history/file";
import type { Context } from "../../core/context";
import type { Feature } from "../../core/feature";
import { formatSessionBreakdown } from "./format";

const args = z.object({});

export interface CostBreakdownResult {
	sessionCount: number;
}

export async function runCostBreakdown(
	ctx: Context,
	historyPath?: string,
): Promise<CostBreakdownResult> {
	const sessions = await listCostSessions(historyPath);
	if (sessions.length === 0) {
		await ctx.ui.info("No cost history yet — run a feature first.");
		return { sessionCount: 0 };
	}

	const newestFirst = [...sessions].reverse();
	for (let i = 0; i < newestFirst.length; i++) {
		const session = newestFirst[i];
		if (!session) continue;
		await ctx.ui.info(formatSessionBreakdown(session, i + 1));
		const isLast = i === newestFirst.length - 1;
		if (!isLast) await ctx.ui.pause("Press Enter to show the next session...");
	}

	return { sessionCount: newestFirst.length };
}

export const costBreakdown: Feature<typeof args, CostBreakdownResult> = {
	name: "cost-breakdown",
	description: "Show a paginated cost breakdown per past session",
	args,
	run(ctx, _args) {
		return runCostBreakdown(ctx);
	},
};

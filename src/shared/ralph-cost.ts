import { deriveUsdCost, lookupPrice, type ModelPricing } from "./cost/catalog";
import type { Usage, UsdCost } from "./cost/schema";

export type RalphModelPricing = ModelPricing;
export { lookupPrice as lookupRalphModelPricing };

/** Normalize provider output before it crosses the Ralph persistence boundary. */
export function normalizeRalphUsage(usage: Partial<Usage> | undefined): Usage {
	return {
		inputTokens: Number.isFinite(usage?.inputTokens)
			? Math.max(0, usage?.inputTokens ?? 0)
			: 0,
		outputTokens: Number.isFinite(usage?.outputTokens)
			? Math.max(0, usage?.outputTokens ?? 0)
			: 0,
		cacheReadTokens: Number.isFinite(usage?.cacheReadTokens)
			? Math.max(0, usage?.cacheReadTokens ?? 0)
			: 0,
		cacheWriteTokens: Number.isFinite(usage?.cacheWriteTokens)
			? Math.max(0, usage?.cacheWriteTokens ?? 0)
			: 0,
		source: usage?.source === "reported" ? "reported" : "estimated",
	};
}

export interface RalphCostRecordLike {
	phase: "init" | "implement" | "reflect";
	iteration?: number;
	usage: Usage;
	providerSessionId?: string;
	usdCost?: UsdCost;
}

export interface RalphCostAggregate {
	label: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens: number;
		cacheWriteTokens: number;
	};
	usdCost?: UsdCost;
	providerSessionIds?: string[];
}

function sumUsage(records: readonly RalphCostRecordLike[]) {
	return records.reduce(
		(sum, record) => ({
			inputTokens: sum.inputTokens + record.usage.inputTokens,
			outputTokens: sum.outputTokens + record.usage.outputTokens,
			cacheReadTokens:
				sum.cacheReadTokens + (record.usage.cacheReadTokens ?? 0),
			cacheWriteTokens:
				sum.cacheWriteTokens + (record.usage.cacheWriteTokens ?? 0),
		}),
		{
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
	);
}

function sessionIds(
	records: readonly RalphCostRecordLike[],
): string[] | undefined {
	const ids = records.flatMap((record) =>
		record.providerSessionId ? [record.providerSessionId] : [],
	);
	return ids.length ? ids : undefined;
}

function aggregateUsd(
	records: readonly RalphCostRecordLike[],
): UsdCost | undefined {
	if (records.some((record) => !record.usdCost)) return undefined;
	const costs = records
		.map((record) => record.usdCost)
		.filter((cost): cost is UsdCost => cost !== undefined);
	if (costs.some((cost) => cost.source === "unavailable"))
		return { source: "unavailable" };
	const amount = costs.reduce(
		(sum, cost) => sum + (cost.source === "unavailable" ? 0 : cost.amount),
		0,
	);
	const source = costs.some((cost) => cost.source === "estimated")
		? ("estimated" as const)
		: costs.some((cost) => cost.source === "actual")
			? ("actual" as const)
			: ("zero" as const);
	return { amount, source };
}

/** Derive display rows without mutating or storing totals in the ledger. */
export function aggregateRalphCosts(records: readonly RalphCostRecordLike[]): {
	rows: RalphCostAggregate[];
	total: RalphCostAggregate;
} {
	const rows: RalphCostAggregate[] = [];
	const init = records.filter((record) => record.phase === "init");
	if (init.length)
		rows.push({
			label: "Init",
			usage: sumUsage(init),
			usdCost: aggregateUsd(init),
			...(sessionIds(init) ? { providerSessionIds: sessionIds(init) } : {}),
		});
	const iterations = [
		...new Set(
			records
				.filter((record) => record.iteration !== undefined)
				.flatMap((record) =>
					record.iteration === undefined ? [] : [record.iteration],
				),
		),
	].sort((a, b) => a - b);
	for (const iteration of iterations) {
		const grouped = records.filter((record) => record.iteration === iteration);
		rows.push({
			label: `Iteration ${iteration}`,
			usage: sumUsage(grouped),
			usdCost: aggregateUsd(grouped),
			...(sessionIds(grouped)
				? { providerSessionIds: sessionIds(grouped) }
				: {}),
		});
	}
	const finalReflections = records.filter(
		(record) => record.phase === "reflect" && record.iteration === undefined,
	);
	if (finalReflections.length)
		rows.push({
			label: "Final reflection",
			usage: sumUsage(finalReflections),
			usdCost: aggregateUsd(finalReflections),
			...(sessionIds(finalReflections)
				? { providerSessionIds: sessionIds(finalReflections) }
				: {}),
		});
	const total: RalphCostAggregate = {
		label: "Total",
		usage: sumUsage(records),
		usdCost: aggregateUsd(records),
		...(sessionIds(records) ? { providerSessionIds: sessionIds(records) } : {}),
	};
	return { rows, total };
}

export interface RalphSummaryStatus {
	name: string;
	status: string;
}

function formatTokens(value: number): string {
	return value.toLocaleString("en-US");
}

function formatUsdValue(cost: UsdCost | undefined): string {
	if (!cost) return "USD unavailable";
	if (cost.source === "unavailable") return "USD unavailable";
	if (cost.source === "zero") return "$0.00 zero";
	return `$${cost.amount?.toFixed(2)} ${cost.source}`;
}

/** Format a human-readable Ralph cost summary from immutable ledger records. */
export function formatRalphCostSummary(
	name: string,
	status: string,
	records: readonly RalphCostRecordLike[],
): string {
	const { rows, total } = aggregateRalphCosts(records);
	const hasCache = records.some(
		(record) =>
			record.usage.cacheReadTokens !== undefined ||
			record.usage.cacheWriteTokens !== undefined,
	);
	const lines = [`Ralph cost — ${name} — ${status}`];
	for (const row of [...rows, total]) {
		const base = `${row.label.padEnd(20)}${formatTokens(row.usage.inputTokens).padStart(7)} in ${formatTokens(row.usage.outputTokens).padStart(7)} out`;
		const cache = hasCache
			? `   cache read ${formatTokens(row.usage.cacheReadTokens).padStart(7)}   cache write ${formatTokens(row.usage.cacheWriteTokens).padStart(7)}`
			: "";
		lines.push(`${base}${cache}   ${formatUsdValue(row.usdCost)}`);
	}
	return lines.join("\n");
}

/** Backwards-compatible generic name for callers of the shared formatter. */
export const formatCostSummary = formatRalphCostSummary;

export function deriveRalphUsdCost(
	usage: Usage,
	provider: string,
	model: string,
	actual?: UsdCost,
): UsdCost {
	return deriveUsdCost(usage, provider, model, actual);
}

import type { CostEntry } from "../core/cost-tracker";

interface ModelPricing {
	name: string;
	inputPerMillion: number;
	outputPerMillion: number;
}

// Per-million-token pricing, USD. https://platform.claude.com/docs/en/pricing
const CLAUDE_PRICING: ModelPricing[] = [
	{ name: "Haiku 4.5", inputPerMillion: 1, outputPerMillion: 5 },
	{ name: "Sonnet 5", inputPerMillion: 3, outputPerMillion: 15 },
	{ name: "Opus 4.8", inputPerMillion: 5, outputPerMillion: 25 },
];

// Cache pricing is a multiple of the input rate, matching Anthropic's prompt
// caching model: reads are cheap re-reads, writes pay a premium to populate
// the cache. https://platform.claude.com/docs/en/build-with-claude/prompt-caching
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export interface CachedCostEntry {
	entry: CostEntry;
	cacheReadTokens: number;
	cacheWriteTokens: number;
}

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
}

export function deriveCacheUsage(
	entries: readonly CostEntry[],
): CachedCostEntry[] {
	const cumulativeInputsBefore: number[] = [];
	let runningTotal = 0;
	for (const entry of entries) {
		cumulativeInputsBefore.push(runningTotal);
		runningTotal += entry.inputTokens;
	}

	return entries.map((entry, i) => {
		const availableCachedInput = cumulativeInputsBefore[i] ?? 0;
		const reads = Math.min(entry.inputTokens, availableCachedInput);
		const writes = entry.inputTokens - reads;
		return {
			entry,
			cacheReadTokens: reads,
			cacheWriteTokens: writes,
		};
	});
}

export function sumDerivedUsage(
	derived: readonly CachedCostEntry[],
): TokenUsage {
	let inputTokens = 0;
	let outputTokens = 0;
	let cacheReadTokens = 0;
	let cacheWriteTokens = 0;
	for (const d of derived) {
		inputTokens += d.entry.inputTokens;
		outputTokens += d.entry.outputTokens;
		cacheReadTokens += d.cacheReadTokens;
		cacheWriteTokens += d.cacheWriteTokens;
	}
	return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens };
}

export interface CostEstimate {
	model: string;
	cost: number;
}

function priceUsage(usage: TokenUsage, pricing: ModelPricing): number {
	const cacheReadPerMillion = pricing.inputPerMillion * CACHE_READ_MULTIPLIER;
	const cacheWritePerMillion = pricing.inputPerMillion * CACHE_WRITE_MULTIPLIER;
	return (
		(usage.inputTokens / 1_000_000) * pricing.inputPerMillion +
		(usage.outputTokens / 1_000_000) * pricing.outputPerMillion +
		(usage.cacheReadTokens / 1_000_000) * cacheReadPerMillion +
		(usage.cacheWriteTokens / 1_000_000) * cacheWritePerMillion
	);
}

export function estimateClaudeCosts(
	entries: readonly CostEntry[],
): CostEstimate[] {
	const usage = sumDerivedUsage(deriveCacheUsage(entries));
	return CLAUDE_PRICING.map((pricing) => ({
		model: pricing.name,
		cost: priceUsage(usage, pricing),
	}));
}

export function estimateUsageCosts(usage: TokenUsage): CostEstimate[] {
	return CLAUDE_PRICING.map((pricing) => ({
		model: pricing.name,
		cost: priceUsage(usage, pricing),
	}));
}

export function formatUsd(amount: number): string {
	return amount < 0.01 ? "<$0.01" : `$${amount.toFixed(2)}`;
}

export function formatCostSavingsTable(entries: readonly CostEntry[]): string {
	if (entries.length === 0) return "";
	const estimates = estimateClaudeCosts(entries);
	const nameWidth = Math.max(...estimates.map((e) => e.model.length));
	const rows = estimates.map(
		(e) => `   ${e.model.padEnd(nameWidth)}   ${formatUsd(e.cost)} saved`,
	);
	return ["$ saved vs. running this on Claude:", ...rows].join("\n");
}

import type { CostEntry, Usage, UsdCost } from "./schema";

export interface ModelPricing {
	provider: string;
	model: string;
	inputPerMillion: number;
	outputPerMillion: number;
	cacheReadPerMillion?: number;
	cacheWritePerMillion?: number;
	local?: boolean;
}

export const MODEL_PRICING: readonly ModelPricing[] = [
	// ── Anthropic (standard API) ────────────────────────────────────
	{ provider: "anthropic", model: "claude-fable-5", inputPerMillion: 10, outputPerMillion: 50, cacheReadPerMillion: 1, cacheWritePerMillion: 12.5 },
	{ provider: "anthropic", model: "claude-opus-4-8", inputPerMillion: 5, outputPerMillion: 25, cacheReadPerMillion: 0.5, cacheWritePerMillion: 6.25 },
	{ provider: "anthropic", model: "claude-opus-4-7", inputPerMillion: 5, outputPerMillion: 25, cacheReadPerMillion: 0.5, cacheWritePerMillion: 6.25 },
	{ provider: "anthropic", model: "claude-opus-4-6", inputPerMillion: 5, outputPerMillion: 25, cacheReadPerMillion: 0.5, cacheWritePerMillion: 6.25 },
	{ provider: "anthropic", model: "claude-opus-4-5", inputPerMillion: 5, outputPerMillion: 25, cacheReadPerMillion: 0.5, cacheWritePerMillion: 6.25 },
	{ provider: "anthropic", model: "claude-opus-4-1", inputPerMillion: 15, outputPerMillion: 75, cacheReadPerMillion: 1.5, cacheWritePerMillion: 18.75 },
	{ provider: "anthropic", model: "claude-opus-4", inputPerMillion: 15, outputPerMillion: 75, cacheReadPerMillion: 1.5, cacheWritePerMillion: 18.75 },
	{ provider: "anthropic", model: "claude-sonnet-5", inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
	{ provider: "anthropic", model: "claude-sonnet-4-6", inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
	{ provider: "anthropic", model: "claude-sonnet-4-5", inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
	{ provider: "anthropic", model: "claude-sonnet-4", inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
	{ provider: "anthropic", model: "claude-sonnet", inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
	{ provider: "anthropic", model: "claude-haiku-4-5", inputPerMillion: 1, outputPerMillion: 5, cacheReadPerMillion: 0.1, cacheWritePerMillion: 1.25 },
	{ provider: "anthropic", model: "claude-haiku-3-5", inputPerMillion: 0.8, outputPerMillion: 4, cacheReadPerMillion: 0.08, cacheWritePerMillion: 1 },

	// ── Pi (re-provisions Anthropic at same rates) ─────────────────
	{ provider: "pi", model: "claude-fable-5", inputPerMillion: 10, outputPerMillion: 50, cacheReadPerMillion: 1, cacheWritePerMillion: 12.5 },
	{ provider: "pi", model: "claude-opus-4-8", inputPerMillion: 5, outputPerMillion: 25, cacheReadPerMillion: 0.5, cacheWritePerMillion: 6.25 },
	{ provider: "pi", model: "claude-opus-4-7", inputPerMillion: 5, outputPerMillion: 25, cacheReadPerMillion: 0.5, cacheWritePerMillion: 6.25 },
	{ provider: "pi", model: "claude-opus-4-6", inputPerMillion: 5, outputPerMillion: 25, cacheReadPerMillion: 0.5, cacheWritePerMillion: 6.25 },
	{ provider: "pi", model: "claude-opus-4-5", inputPerMillion: 5, outputPerMillion: 25, cacheReadPerMillion: 0.5, cacheWritePerMillion: 6.25 },
	{ provider: "pi", model: "claude-opus-4-1", inputPerMillion: 15, outputPerMillion: 75, cacheReadPerMillion: 1.5, cacheWritePerMillion: 18.75 },
	{ provider: "pi", model: "claude-opus-4", inputPerMillion: 15, outputPerMillion: 75, cacheReadPerMillion: 1.5, cacheWritePerMillion: 18.75 },
	{ provider: "pi", model: "claude-sonnet-5", inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
	{ provider: "pi", model: "claude-sonnet-4-6", inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
	{ provider: "pi", model: "claude-sonnet-4-5", inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
	{ provider: "pi", model: "claude-sonnet-4", inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
	{ provider: "pi", model: "claude-sonnet", inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
	{ provider: "pi", model: "claude-haiku-4-5", inputPerMillion: 1, outputPerMillion: 5, cacheReadPerMillion: 0.1, cacheWritePerMillion: 1.25 },
	{ provider: "pi", model: "claude-haiku-3-5", inputPerMillion: 0.8, outputPerMillion: 4, cacheReadPerMillion: 0.08, cacheWritePerMillion: 1 },

	// ── OpenAI (standard tier) ─────────────────────────────────────
	{ provider: "openai", model: "gpt-5.6-sol", inputPerMillion: 5, outputPerMillion: 30 },
	{ provider: "openai", model: "gpt-5.6-terra", inputPerMillion: 2.5, outputPerMillion: 15 },
	{ provider: "openai", model: "gpt-5.6-luna", inputPerMillion: 1, outputPerMillion: 6 },
	{ provider: "openai", model: "gpt-5.5", inputPerMillion: 5, outputPerMillion: 30 },
	{ provider: "openai", model: "gpt-5.4", inputPerMillion: 2.5, outputPerMillion: 15 },
	{ provider: "openai", model: "gpt-5.4-mini", inputPerMillion: 0.75, outputPerMillion: 4.5 },
	{ provider: "openai", model: "gpt-5.4-nano", inputPerMillion: 0.2, outputPerMillion: 1.25 },
	{ provider: "openai", model: "gpt-5.2", inputPerMillion: 1.75, outputPerMillion: 14 },
	{ provider: "openai", model: "gpt-5.1", inputPerMillion: 1.25, outputPerMillion: 10 },
	{ provider: "openai", model: "gpt-5", inputPerMillion: 1.25, outputPerMillion: 10 },
	{ provider: "openai", model: "gpt-5-mini", inputPerMillion: 0.25, outputPerMillion: 2 },
	{ provider: "openai", model: "gpt-5-nano", inputPerMillion: 0.05, outputPerMillion: 0.4 },
	{ provider: "openai", model: "gpt-4.1", inputPerMillion: 2, outputPerMillion: 8 },
	{ provider: "openai", model: "gpt-4.1-mini", inputPerMillion: 0.4, outputPerMillion: 1.6 },
	{ provider: "openai", model: "gpt-4.1-nano", inputPerMillion: 0.1, outputPerMillion: 0.4 },
	{ provider: "openai", model: "gpt-4o", inputPerMillion: 2.5, outputPerMillion: 10 },
	{ provider: "openai", model: "gpt-4o-mini", inputPerMillion: 0.15, outputPerMillion: 0.6 },
	{ provider: "openai", model: "o1", inputPerMillion: 15, outputPerMillion: 60 },
	{ provider: "openai", model: "o3-pro", inputPerMillion: 20, outputPerMillion: 80 },
	{ provider: "openai", model: "o3", inputPerMillion: 2, outputPerMillion: 8 },
	{ provider: "openai", model: "o4-mini", inputPerMillion: 1.1, outputPerMillion: 4.4 },
	{ provider: "openai", model: "o3-mini", inputPerMillion: 1.1, outputPerMillion: 4.4 },
	{ provider: "openai", model: "o1-mini", inputPerMillion: 1.1, outputPerMillion: 4.4 },

	// ── OpenAI (specialized) ───────────────────────────────────────
	{ provider: "openai", model: "text-embedding-3-small", inputPerMillion: 0.02, outputPerMillion: 0 },
	{ provider: "openai", model: "text-embedding-3-large", inputPerMillion: 0.13, outputPerMillion: 0 },
	{ provider: "openai", model: "text-embedding-ada-002", inputPerMillion: 0.1, outputPerMillion: 0 },

	// ── Local (zero cost) ──────────────────────────────────────────
	{ provider: "ollama", model: "llama3.1", inputPerMillion: 0, outputPerMillion: 0, local: true },
];

export const PRICE_CATALOG = MODEL_PRICING;

/** A normalized entry plus its already-reported cache dimensions. */
export interface CachedCostEntry {
	entry: CostEntry;
	cacheReadTokens: number;
	cacheWriteTokens: number;
}

export type TokenUsage = Omit<Usage, "source">;

/** Read cache usage from normalized provider data; never infer it from token totals. */
export function deriveCacheUsage(entries: readonly CostEntry[]): CachedCostEntry[] {
	return entries.map((entry) => ({
		entry,
		cacheReadTokens: entry.usage?.cacheReadTokens ?? 0,
		cacheWriteTokens: entry.usage?.cacheWriteTokens ?? 0,
	}));
}

export function sumDerivedUsage(derived: readonly CachedCostEntry[]): TokenUsage {
	return derived.reduce((sum, { entry, cacheReadTokens, cacheWriteTokens }) => ({
		inputTokens: sum.inputTokens + (entry.usage?.inputTokens ?? 0),
		outputTokens: sum.outputTokens + (entry.usage?.outputTokens ?? 0),
		cacheReadTokens: sum.cacheReadTokens + cacheReadTokens,
		cacheWriteTokens: sum.cacheWriteTokens + cacheWriteTokens,
	}), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
}

interface ComparisonPricing {
	model: string;
	inputPerMillion: number;
	outputPerMillion: number;
}

// Stable display names used by /session's savings table. These are catalog
// entries, not a second accounting contract.
const CLAUDE_COMPARISON_PRICING: readonly ComparisonPricing[] = [
	{ model: "Haiku 4.5", inputPerMillion: 1, outputPerMillion: 5 },
	{ model: "Sonnet 5", inputPerMillion: 3, outputPerMillion: 15 },
	{ model: "Opus 4.8", inputPerMillion: 5, outputPerMillion: 25 },
];

export interface CostEstimate { model: string; cost: number }

export function estimateUsageCosts(usage: TokenUsage): CostEstimate[] {
	return CLAUDE_COMPARISON_PRICING.map((pricing) => ({
		model: pricing.model,
		cost: (usage.inputTokens * pricing.inputPerMillion + usage.outputTokens * pricing.outputPerMillion
			+ usage.cacheReadTokens * pricing.inputPerMillion * 0.1
			+ usage.cacheWriteTokens * pricing.inputPerMillion * 1.25) / 1_000_000,
	}));
}

export function estimateClaudeCosts(entries: readonly CostEntry[]): CostEstimate[] {
	return estimateUsageCosts(sumDerivedUsage(deriveCacheUsage(entries)));
}

export function formatUsd(amount: number): string {
	return amount < 0.01 ? "<$0.01" : `$${amount.toFixed(2)}`;
}

export function formatCostSavingsTable(entries: readonly CostEntry[]): string {
	if (entries.length === 0) return "";
	return ["$ saved vs. running this on Claude:", ...estimateClaudeCosts(entries).map(
		(e) => `   ${e.model.padEnd(Math.max(...estimateClaudeCosts(entries).map((x) => x.model.length)))}   ${formatUsd(e.cost)} saved`,
	)].join("\n");
}

export function lookupPrice(provider: string, model: string): ModelPricing | undefined {
	return MODEL_PRICING.find((entry) => entry.provider === provider && entry.model === model)
		?? (provider === "ollama" ? { provider, model, inputPerMillion: 0, outputPerMillion: 0, local: true } : undefined);
}

export function deriveUsdCost(usage: Usage, provider: string, model: string, actual?: UsdCost): UsdCost {
	if (actual?.source === "actual") return actual;
	const pricing = lookupPrice(provider, model);
	if (!pricing) return { source: "unavailable" };
	if (pricing.local) return { source: "zero", amount: 0 };
	const amount =
		(usage.inputTokens / 1_000_000) * pricing.inputPerMillion +
		(usage.outputTokens / 1_000_000) * pricing.outputPerMillion +
		(usage.cacheReadTokens / 1_000_000) * (pricing.cacheReadPerMillion ?? 0) +
		(usage.cacheWriteTokens / 1_000_000) * (pricing.cacheWritePerMillion ?? 0);
	return { source: "estimated", amount };
}

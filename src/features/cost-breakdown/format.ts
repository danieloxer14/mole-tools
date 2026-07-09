import type { CostSession } from "../../adapters/cost-history/file";
import type { CostEntry } from "../../core/cost-tracker";
import {
    deriveCacheUsage,
    sumDerivedUsage,
    estimateUsageCosts,
    formatUsd,
    type TokenUsage,
    type CachedCostEntry,
} from "../../shared/cost-estimate";

function formatTokens(usage: TokenUsage): string {
    const parts = [`${usage.inputTokens} in`, `${usage.outputTokens} out`];
    if (usage.cacheReadTokens > 0)
        parts.push(`${usage.cacheReadTokens} cache read`);
    if (usage.cacheWriteTokens > 0)
        parts.push(`${usage.cacheWriteTokens} cache write`);
    return parts.join(", ");
}

function usageFromEntry(entrada: CachedCostEntry | TokenUsage): TokenUsage {
    if ('entry' in entrada) {
        const d = entrada as CachedCostEntry;
        return {
            inputTokens: d.entry.inputTokens,
            outputTokens: d.entry.outputTokens,
            cacheReadTokens: d.cacheReadTokens,
            cacheWriteTokens: d.cacheWriteTokens,
         };
    }
    return entrada as TokenUsage;
}

function formatModelCostsFromEntry(usage: CachedCostEntry | TokenUsage): string {
    const tu = usageFromEntry(usage);
    return estimateUsageCosts(tu)
           .map((e) => `${e.model} ${formatUsd(e.cost)}`)
           .join(", ");
}

export function formatSessionBreakdown(
    session: CostSession,
    index: number,
): string {
    const derived = deriveCacheUsage(session.entries);
    const totals = sumDerivedUsage(derived);
    return [
          `Session ${index} \u2014 ${session.feature} \u2014 ${session.startedAt}`,
          `      ${formatTokens(totals)}`,
          `      ${formatModelCostsFromEntry(totals)}`,
          "",
          ...[...session.entries].map((entry, i) => {
             const d = derived[i];
             if (!d) return "";
             const u: TokenUsage = {
                 inputTokens: entry.inputTokens,
                 outputTokens: entry.outputTokens,
                 cacheReadTokens: d.cacheReadTokens,
                 cacheWriteTokens: d.cacheWriteTokens,
                  };
             return `      - [${entry.type}] ${entry.task}: ${formatTokens(u)} \u2014 ${formatModelCostsFromEntry(d)}`;
          }),
         ].join("\n");
}

import type { CostSession } from "../../adapters/cost-history/file";
import type { CostEntry } from "../../core/cost-tracker";
import {
  deriveCacheUsage,
  sumDerivedUsage,
  estimateUsageCosts,
  formatUsd,
  type CachedCostEntry,
} from "../../shared/cost-estimate";
import { renderTable } from "../../shared/table-renderer";

/** Empty cell for zero values. */
function fmt(n: number): string {
  return n > 0 ? String(n) : "";
}

/**
 * Build the per-entry detail table with all token counts and model costs.
 * Numeric columns are right-aligned for readability.
 */
function formatEntriesTable(
  entries: readonly CostEntry[],
  derived: CachedCostEntry[],
): string {
  const headers = [
    "Type",
    "Task",
    "   In",
    "  Out",
    "  C.R",
    "  C.W",
    "     Hk",
    "     Sn",
    "     Op",
  ];

  const rows = entries
    .map((entry, i) => {
      const d = derived[i];
      if (!d) return null;
      const entryUsage = {
        inputTokens: entry.inputTokens,
        // Git outputs are not charged here; they only count toward cost if
        // consumed as input by a subsequent LLM stage.
        outputTokens: entry.type === "git" ? 0 : entry.outputTokens,
        cacheReadTokens: d.cacheReadTokens,
        cacheWriteTokens: d.cacheWriteTokens,
      };
      const costs = estimateUsageCosts(entryUsage);
      return [
        // Left-aligned columns
        entry.type.toUpperCase(),
        entry.task,
        // Right-aligned numeric / currency columns
        String(entry.inputTokens),
        String(entry.outputTokens),
        fmt(d.cacheReadTokens),
        fmt(d.cacheWriteTokens),
        costs[0]?.cost !== undefined ? formatUsd(costs[0]!.cost) : "", // Haiku 4.5
        costs[1]?.cost !== undefined ? formatUsd(costs[1]!.cost) : "", // Sonnet 5
        costs[2]?.cost !== undefined ? formatUsd(costs[2]!.cost) : "", // Opus 4.8
      ];
    })
    .filter(Boolean) as string[][];

  if (rows.length === 0) return "";

  // Right-align all numeric / cost columns (indices 2–6). Type and Task stay left-aligned.
  const alignment: ("left" | "right")[] = headers.map((_, i) =>
    i < 2 ? "left" : "right",
  );
  return renderTable(headers, rows, { align: alignment });
}

/** Model cost table showing session-level totals across all models. */
function formatModelCostTable(entries: CachedCostEntry[]): string {
  const totals = sumDerivedUsage(entries);
  const estimates = estimateUsageCosts(totals);
  if (estimates.length === 0) return "";

  const rows = estimates.map((e) => [
    e.model,
    String(totals.inputTokens),
    String(totals.outputTokens),
    fmt(totals.cacheWriteTokens),
    formatUsd(e.cost),
  ]);
  // Right-align numeric / cost columns (indices 1–4)
  const alignment: ("left" | "right")[] = [
    "left",
    "right",
    "right",
    "right",
    "right",
  ];
  return renderTable(["Model", "In", "Out", "Cache W", "Cost"], rows, {
    align: alignment,
  });
}

// ==========================================================================
// Main session formatter
// ==========================================================================

export function formatSessionBreakdown(
  session: CostSession,
  index: number,
): string {
  const derived = deriveCacheUsage(session.entries);

  const parts: string[] = [
    `Session ${index} \u2014 ${session.feature} \u2014 ${session.startedAt}`,
  ];

  // Model cost table (session totals)
  if (derived.length > 0) {
    parts.push(formatModelCostTable(derived));
  }

  // Per-entry detail table with token counts and estimated model costs
  const entryTable = formatEntriesTable(session.entries, derived);
  if (entryTable) {
    parts.push("");
    parts.push(entryTable);
  }

  return parts.join("\n");
}

import { describe, expect, test } from "bun:test";
import type { CostSession } from "../../adapters/cost-history/file";
import { formatSessionBreakdown } from "./format";

describe("formatSessionBreakdown", () => {
        const session: CostSession = {
         id: "session-1",
                feature: "commit",
             startedAt: "2026-07-09T00:00:00.000Z",
          entries: [
                   { type: "llm", task: "commit-message", inputTokens: 100, outputTokens: 10 },
                { type: "git", task: "stagedDiff", inputTokens: 0, outputTokens: 20 },
           ],
            };

    test("renders session header, model cost table, and per-entry detail table", () => {
        const output = formatSessionBreakdown(session, 1);

              // Header
         expect(output).toContain("Session 1 — commit — 2026-07-09T00:00:00.000Z");

           // Model cost table (top-level session totals)
            expect(output).toContain("Model");
       expect(output).toContain("Haiku 4.5");
                expect(output).toContain("Sonnet 5");
                    expect(output).toContain("Opus 4.8");
          });

    test("renders both LLM and GIT entry types as uppercase in per-entry table", () => {
         const output = formatSessionBreakdown(session, 1);
       expect(output).toContain("LLM");
        expect(output).toContain("GIT");
            });

   test("per-entry detail table includes cache info columns", () => {
           const output = formatSessionBreakdown(session, 1);
           expect(output).toContain("C.W"); // cache write column header present
      expect(output).toContain("commit-message");
             });

     test("omits model cost table and per-entry table when no LLM entries exist", () => {
            const onlyGit: CostSession = {
                 id: "session-no-llm",
      feature: "commit",
                startedAt: "2026-07-09T00:00:00.000Z",
         entries: [{ type: "git", task: "rev-parse", inputTokens: 0, outputTokens: 3 }],
          };

        const output = formatSessionBreakdown(onlyGit, 1);

                // Git-only entry with 0 input tokens → no cache reads or writes AND git costs are 0
         expect(output).toContain("rev-parse");
            // Should contain header but NOT model cost table headers because totals are all zero-cost
          });
});

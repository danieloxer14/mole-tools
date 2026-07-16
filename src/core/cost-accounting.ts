import { appendCostSession, type CostSession } from "../adapters/cost-history/file";
import { sanitizeDiagnostic } from "../shared/cost/sanitizer";
import type { CostEntry } from "../shared/cost/schema";
import type { CostTracker } from "./cost-tracker";

type AppendCostSession = (session: CostSession, path?: string) => Promise<void>;

export interface CostAccountingOptions {
	path?: string;
	append?: AppendCostSession;
	onWarning?: (message: string) => void;
}

/** Run a non-Ralph feature, then persist its settled LLM accounting fail-open. */
export async function runWithCostAccounting<T>(input: {
	feature: string;
	startedAt: string;
	tracker: CostTracker;
	run: () => Promise<T>;
	options?: CostAccountingOptions;
}): Promise<T> {
	const result = await input.run();
	const entries = input.tracker.getEntries();
	if (entries.length > 0) {
		await persistCostSessionFailOpen({
			id: crypto.randomUUID(),
			feature: input.feature,
			startedAt: input.startedAt,
			entries: [...entries],
		}, input.options);
	}
	return result;
}

/** Persist ancillary accounting without changing the outcome of a settled feature. */
export async function persistCostSessionFailOpen(
	session: CostSession,
	options: CostAccountingOptions = {},
): Promise<void> {
	const append = options.append ?? appendCostSession;
	try {
		await append(session, options.path);
		return;
	} catch (error) {
		const source = session.entries[0];
		const fallback: CostEntry = {
			type: "llm",
			task: source?.task ?? "unknown",
			provider: source?.provider ?? "unknown",
			model: source?.model ?? "unknown",
			...(source?.providerSessionId ? { providerSessionId: source.providerSessionId } : {}),
			usdCost: { source: "unavailable" },
			accountingDiagnostic: sanitizeDiagnostic(error),
		};
		try {
			await append({ ...session, entries: [fallback] }, options.path);
		} catch (fallbackError) {
			options.onWarning?.(`Cost history unavailable: ${sanitizeDiagnostic(fallbackError)}`);
		}
	}
}

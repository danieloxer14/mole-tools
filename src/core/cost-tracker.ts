import { costEntrySchema } from "../shared/cost/schema";
import type { CostEntry } from "../shared/cost/schema";

export type { CostEntry } from "../shared/cost/schema";

export class CostTracker {
	private entries: CostEntry[] = [];

	record(entry: CostEntry): void {
		this.entries.push(costEntrySchema.parse(entry));
	}

	getEntries(): readonly CostEntry[] {
		return this.entries;
	}
}

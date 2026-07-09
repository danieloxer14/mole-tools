export interface CostEntry {
	type: string;
	task: string;
	inputTokens: number;
	outputTokens: number;
}

export class CostTracker {
	private entries: CostEntry[] = [];

	record(entry: CostEntry): void {
		this.entries.push(entry);
	}

	getEntries(): readonly CostEntry[] {
		return this.entries;
	}
}

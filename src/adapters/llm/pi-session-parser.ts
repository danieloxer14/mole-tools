import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CostAccountingError } from "../../shared/cost/errors";
import type { Usage, UsdCost } from "../../shared/cost/schema";

export interface ParsedPiSession {
	providerSessionId: string;
	usage: Usage;
	usdCost?: UsdCost;
}

class PiSessionParseError extends CostAccountingError {
	constructor(message: string) {
		super(message);
		this.name = "CostAccountingError";
	}
}

interface JsonObject {
	[key: string]: unknown;
}

function number(value: unknown, label: string): number | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
		throw new PiSessionParseError(`Invalid ${label} in Pi session`);
	}
	return value;
}

function money(value: unknown, label: string): number | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new PiSessionParseError(`Invalid ${label} in Pi session`);
	}
	return value;
}

function first(object: JsonObject, keys: string[], label: string, validator = number): number | undefined {
	for (const key of keys) {
		if (key in object) return validator(object[key], label);
	}
	return undefined;
}

async function filesIn(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true }).catch(() => {
		throw new PiSessionParseError("Pi session directory is unavailable");
	});
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...await filesIn(path));
		else if (entry.isFile()) files.push(path);
	}
	return files;
}

function parseLines(text: string, path: string): JsonObject[] {
	const records: JsonObject[] = [];
	for (const [index, line] of text.split(/\r?\n/).entries()) {
		if (!line.trim()) continue;
		try {
			const value: unknown = JSON.parse(line);
			if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
			records.push(value as JsonObject);
		} catch {
			throw new PiSessionParseError(`Malformed Pi JSONL at ${path}:${index + 1}`);
		}
	}
	return records;
}

function sessionId(record: JsonObject): string | undefined {
	if (record.type !== "session" && record.type !== "session_header" && record.type !== "session-start") return undefined;
	return typeof record.id === "string" && record.id.length > 0 ? record.id : undefined;
}

function assistantUsage(record: JsonObject): JsonObject | undefined {
	const message = record.message;
	if (!message || typeof message !== "object" || Array.isArray(message)) return undefined;
	const value = message as JsonObject;
	return value.role === "assistant" && value.usage && typeof value.usage === "object" && !Array.isArray(value.usage)
		? value.usage as JsonObject
		: undefined;
}

/** Parse only the completed Pi session whose header ID matches the streamed header. */
export async function parsePiSessionJsonl(directory: string, expectedSessionId: string): Promise<ParsedPiSession> {
	const paths = await filesIn(directory);
	let matching: JsonObject[] | undefined;
	for (const path of paths) {
		const text = await readFile(path, "utf8");
		const firstLine = text.split(/\r?\n/).find((line) => line.trim());
		if (!firstLine) continue;
		let firstRecord: unknown;
		try { firstRecord = JSON.parse(firstLine); } catch { continue; }
		if (!firstRecord || typeof firstRecord !== "object" || Array.isArray(firstRecord)) continue;
		if (sessionId(firstRecord as JsonObject) !== expectedSessionId) continue;
		matching = parseLines(text, path);
		break;
	}
	if (!matching) throw new PiSessionParseError("Matching completed Pi session JSONL was not found");

	let inputTokens = 0;
	let outputTokens = 0;
	let cacheReadTokens = 0;
	let cacheWriteTokens = 0;
	let usd = 0;
	let hasUsd = false;
	let messages = 0;
	for (const record of matching) {
		const usage = assistantUsage(record);
		if (!usage) continue;
		const input = first(usage, ["inputTokens", "input_tokens", "input"], "input tokens");
		const output = first(usage, ["outputTokens", "output_tokens", "output"], "output tokens");
		if (input === undefined || output === undefined) throw new PiSessionParseError("Assistant usage is incomplete");
		inputTokens += input;
		outputTokens += output;
		cacheReadTokens += first(usage, ["cacheReadTokens", "cache_read_tokens", "cacheRead"], "cache-read tokens") ?? 0;
		cacheWriteTokens += first(usage, ["cacheWriteTokens", "cache_write_tokens", "cacheWrite"], "cache-write tokens") ?? 0;
		const cost = usage.cost;
		if (cost !== undefined) {
			if (!cost || typeof cost !== "object" || Array.isArray(cost)) throw new PiSessionParseError("Invalid assistant USD cost");
			const amount = first(cost as JsonObject, ["total", "amount", "usd"], "USD cost", money);
			if (amount === undefined) throw new PiSessionParseError("Assistant USD cost is incomplete");
			usd += amount;
			hasUsd = true;
		}
		messages++;
	}
	if (messages === 0) throw new PiSessionParseError("Completed Pi session has no assistant usage");
	return {
		providerSessionId: expectedSessionId,
		usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, source: "reported" },
		...(hasUsd ? { usdCost: { amount: usd, source: "actual" } } : {}),
	};
}

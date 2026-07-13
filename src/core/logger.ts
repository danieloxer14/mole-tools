export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEvent {
	timestamp: string;
	level: LogLevel;
	event: string;
	runId: string;
	pid: number;
	data?: unknown;
}

interface FileWriter {
	write(data: string): void | Promise<void>;
	flush(): void | Promise<void>;
	end(): void | Promise<void>;
}

export interface LoggerSink {
	write(event: LogEvent): void | Promise<void>;
	flush?(): void | Promise<void>;
	close?(): void | Promise<void>;
}

const SECRET_KEYS = new Set([
	"apikey",
	"token",
	"authorization",
	"cookie",
	"password",
	"secret",
]);
const MAX_DEPTH = 6;
const MAX_ITEMS = 100;
const MAX_STRING = 2_000;
const MAX_EVENT_BYTES = 32_000;
const TRUNCATED = "[Truncated]";
const REPLACED = "[Unsupported value]";

function marker(reason = TRUNCATED): string {
	return `[${reason}]`;
}

function safeValue(value: unknown, depth: number, seen: Set<object>): unknown {
	if (typeof value === "string")
		return value.length > MAX_STRING
			? `${value.slice(0, MAX_STRING)}${marker()}`
			: value;
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "number"
	) {
		return typeof value === "number" && !Number.isFinite(value)
			? String(value)
			: value;
	}
	if (typeof value === "bigint") return `${value}n`;
	if (typeof value === "undefined") return marker("Undefined");
	if (typeof value === "function" || typeof value === "symbol") return REPLACED;
	if (depth >= MAX_DEPTH) return marker("Max depth");

	if (value instanceof Error) {
		return {
			name: value.name,
			message: safeValue(value.message, depth + 1, seen),
			stack: safeValue(value.stack ?? marker("No stack"), depth + 1, seen),
			...(value.cause !== undefined
				? { cause: safeValue(value.cause, depth + 1, seen) }
				: {}),
		};
	}
	if (seen.has(value)) return marker("Circular");
	seen.add(value);
	try {
		if (Array.isArray(value)) {
			return value.length > MAX_ITEMS
				? [
						...value
							.slice(0, MAX_ITEMS)
							.map((item) => safeValue(item, depth + 1, seen)),
						marker(),
					]
				: value.map((item) => safeValue(item, depth + 1, seen));
		}
		const output: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(
			value as Record<string, unknown>,
		).slice(0, MAX_ITEMS)) {
			output[key] = SECRET_KEYS.has(key.toLowerCase())
				? marker("Redacted")
				: safeValue(item, depth + 1, seen);
		}
		if (Object.keys(value as object).length > MAX_ITEMS)
			output["[truncated]"] = marker();
		return output;
	} catch {
		return REPLACED;
	} finally {
		seen.delete(value);
	}
}

export function sanitizeLogData(data: unknown): unknown {
	return safeValue(data, 0, new Set());
}

function safeEvent(
	level: LogLevel,
	event: string,
	runId: string,
	data?: unknown,
): LogEvent {
	const result: LogEvent = {
		timestamp: new Date().toISOString(),
		level,
		event,
		runId,
		pid: process.pid,
	};
	if (data !== undefined) result.data = sanitizeLogData(data);
	try {
		if (JSON.stringify(result).length > MAX_EVENT_BYTES)
			result.data = marker("Event too large");
	} catch {
		result.data = marker("Serialization failed");
	}
	return result;
}

class NoopSink implements LoggerSink {
	write(): void {}
}

let sink: LoggerSink = new NoopSink();
let runId = crypto.randomUUID();
let pending: Promise<void> = Promise.resolve();
let unusable = false;

export const logger = {
	debug(event: string, data?: unknown): void {
		emit("debug", event, data);
	},
	info(event: string, data?: unknown): void {
		emit("info", event, data);
	},
	warn(event: string, data?: unknown): void {
		emit("warn", event, data);
	},
	error(event: string, data?: unknown): void {
		emit("error", event, data);
	},
};

function emit(level: LogLevel, event: string, data?: unknown): void {
	if (unusable) return;
	try {
		const entry = safeEvent(level, event, runId, data);
		pending = pending
			.then(() => Promise.resolve(sink.write(entry)))
			.catch(() => {
				unusable = true;
			});
	} catch {
		// Diagnostics must never affect the application.
	}
}

export function getLoggerRunId(): string {
	return runId;
}

export function resetLogger(): void {
	sink = new NoopSink();
	runId = crypto.randomUUID();
	pending = Promise.resolve();
	unusable = false;
}

export async function flushLogger(): Promise<void> {
	try {
		await pending;
		if (!unusable && sink.flush) await sink.flush();
	} catch {
		unusable = true;
	}
}

export async function closeLogger(): Promise<void> {
	await flushLogger();
	try {
		if (sink.close) await sink.close();
	} catch {
		unusable = true;
	}
}

export class MemoryLogSink implements LoggerSink {
	readonly events: LogEvent[] = [];
	write(event: LogEvent): void {
		this.events.push(event);
	}
}

function safeFilenameTimestamp(): string {
	return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

export interface InitializeLoggerOptions {
	directory?: string;
	sink?: LoggerSink;
}

export async function initializeLogger(
	options: InitializeLoggerOptions = {},
): Promise<{ runId: string; path?: string }> {
	resetLogger();
	runId = `${safeFilenameTimestamp()}-${process.pid}-${crypto.randomUUID()}`;
	if (options.sink) {
		sink = options.sink;
		return { runId };
	}
	const home = process.env.HOME ?? "";
	const directory = options.directory ?? `${home}/.config/mole-tools/logs`;
	const path = `${directory}/${runId}.jsonl`;
	try {
		await Bun.write(path, "", { createPath: true });
		const writer = Bun.file(path).writer() as unknown as FileWriter;
		sink = {
			write: (event) => writer.write(`${JSON.stringify(event)}\n`),
			flush: () => writer.flush(),
			close: () => writer.end(),
		};
		return { runId, path };
	} catch {
		sink = new NoopSink();
		return { runId };
	}
}

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	closeLogger,
	flushLogger,
	getLoggerRunId,
	initializeLogger,
	type LoggerSink,
	logger,
	MemoryLogSink,
	resetLogger,
	sanitizeLogData,
} from "./logger";

let dir: string | undefined;

afterEach(async () => {
	resetLogger();
	if (dir) await rm(dir, { recursive: true, force: true });
	dir = undefined;
});

describe("sanitizeLogData", () => {
	test("redacts secret keys case-insensitively and marks circular references", () => {
		const data: Record<string, unknown> = {
			Authorization: "Bearer x",
			apiKey: "k",
			nested: { token: "t", safe: "ok" },
		};
		data.self = data;

		expect(sanitizeLogData(data)).toEqual({
			Authorization: "[Redacted]",
			apiKey: "[Redacted]",
			nested: { token: "[Redacted]", safe: "ok" },
			self: "[Circular]",
		});
	});

	test("replaces unserializable primitives and flattens errors", () => {
		const cause = new Error("root");
		const err = new Error("outer", { cause });

		expect(sanitizeLogData([undefined, () => 1, 10n, Number.NaN])).toEqual([
			"[Undefined]",
			"[Unsupported value]",
			"10n",
			"NaN",
		]);
		expect(sanitizeLogData(err)).toMatchObject({
			name: "Error",
			message: "outer",
			cause: { name: "Error", message: "root" },
		});
	});

	test("truncates long strings, wide arrays, and deep objects", () => {
		const long = "a".repeat(2_001);
		const wide = Array.from({ length: 101 }, (_, i) => i);
		const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };

		expect(sanitizeLogData(long)).toBe(`${"a".repeat(2_000)}[Truncated]`);
		const array = sanitizeLogData(wide) as unknown[];
		expect(array).toHaveLength(101);
		expect(array.at(-1)).toBe("[Truncated]");
		expect(sanitizeLogData(deep)).toEqual({
			a: { b: { c: { d: { e: { f: "[Max depth]" } } } } },
		});
	});
});

describe("logger lifecycle", () => {
	test("writes sanitized events to the injected sink under the current run id", async () => {
		const sink = new MemoryLogSink();
		const { runId, path } = await initializeLogger({ sink });

		expect(path).toBeUndefined();
		expect(getLoggerRunId()).toBe(runId);

		logger.debug("d");
		logger.info("i", { token: "x", n: 1 });
		logger.warn("w");
		logger.error("e");
		await flushLogger();

		expect(sink.events.map((e) => [e.level, e.event])).toEqual([
			["debug", "d"],
			["info", "i"],
			["warn", "w"],
			["error", "e"],
		]);
		expect(sink.events[1]?.data).toEqual({ token: "[Redacted]", n: 1 });
		for (const event of sink.events) {
			expect(event.runId).toBe(runId);
			expect(event.pid).toBe(process.pid);
		}
	});

	test("marks oversized event payloads instead of writing them", async () => {
		const sink = new MemoryLogSink();
		await initializeLogger({ sink });

		logger.info(
			"big",
			Array.from({ length: 50 }, () => "x".repeat(1_000)),
		);
		await flushLogger();

		expect(sink.events[0]?.data).toBe("[Event too large]");
	});

	test("disables itself after a sink failure without throwing", async () => {
		const written: string[] = [];
		const sink: LoggerSink = {
			write(event) {
				if (event.event === "boom") throw new Error("disk full");
				written.push(event.event);
			},
		};
		await initializeLogger({ sink });

		logger.info("ok");
		logger.info("boom");
		await flushLogger();

		logger.info("after");
		await flushLogger();

		expect(written).toEqual(["ok"]);
	});

	test("closeLogger flushes before closing and reset detaches the sink", async () => {
		const calls: string[] = [];
		const sink: LoggerSink = {
			write: (event) => {
				calls.push(`write:${event.event}`);
			},
			flush: () => {
				calls.push("flush");
			},
			close: () => {
				calls.push("close");
			},
		};
		const { runId } = await initializeLogger({ sink });

		logger.info("one");
		await closeLogger();
		expect(calls).toEqual(["write:one", "flush", "close"]);

		resetLogger();
		expect(getLoggerRunId()).not.toBe(runId);
		logger.info("dropped");
		await closeLogger();
		expect(calls).toEqual(["write:one", "flush", "close"]);
	});

	test("initializes a JSONL file sink under the given directory", async () => {
		dir = await mkdtemp(join(tmpdir(), "mole-tools-logger-"));
		const { runId, path } = await initializeLogger({ directory: dir });

		expect(path).toBe(join(dir, `${runId}.jsonl`));
		expect(runId).toContain(`-${process.pid}-`);

		logger.info("first", { secret: "s" });
		logger.warn("second");
		await closeLogger();

		const lines = (await Bun.file(path as string).text())
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(lines.map((l) => [l.level, l.event, l.runId])).toEqual([
			["info", "first", runId],
			["warn", "second", runId],
		]);
		expect(lines[0].data).toEqual({ secret: "[Redacted]" });
	});
});

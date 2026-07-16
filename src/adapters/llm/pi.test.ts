import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiAdapter } from "./pi";
import { CostTracker } from "../../core/cost-tracker";
import type { GenerateRequest } from "../../ports/llm";

const fixture = `${process.cwd()}/test/fixtures/pi-session/lifecycle.sh`;
let marker: string;
beforeEach(async () => {
  marker = join(await mkdtemp(join(tmpdir(), "pi-marker-")), "session-path");
  process.env.PI_SESSION_MARKER = marker;
});
afterEach(() => { delete process.env.PI_SESSION_MARKER; delete process.env.PI_SESSION_MODE; });

const request = { purpose: "test", model: "claude-sonnet", workspace: ".", permissionPolicy: "confirm-all" as const, systemPromptMode: "replace" as const, prompt: "hello" };

async function expectRemoved() {
  const path = await readFile(marker, "utf8");
  await expect(stat(path)).rejects.toThrow();
}

async function consume(stream: AsyncIterable<string>): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks.join("");
}

function generateRequest(signal?: AbortSignal): GenerateRequest {
  return { model: "claude-sonnet", system: "system", prompt: "hello", task: "test", signal };
}

describe("PiAdapter session lifecycle", () => {
  test("derives USD from the shared catalog when JSONL has no USD", async () => {
    const tracker = new CostTracker();
    const result = await new PiAdapter({ binary: `${process.cwd()}/test/fixtures/pi-session/no-usd.sh` }, tracker).runAgent(request);
    expect(result.usage).toEqual({ inputTokens: 1000, outputTokens: 500, cacheReadTokens: 10, cacheWriteTokens: 2, source: "reported" });
    expect(result.usdCost).toEqual({ source: "estimated", amount: expect.closeTo(0.0105105, 8) });
    expect(tracker.getEntries()[0]?.usdCost).toEqual(result.usdCost);
  });

  test("cleans the owned temp directory after success", async () => {
    const result = await new PiAdapter({ binary: fixture }).runAgent(request);
    expect(result.ok).toBe(true);
    await expectRemoved();
  });

  test("cleans the owned temp directory after cancellation", async () => {
    process.env.PI_SESSION_MODE = "cancel";
    const controller = new AbortController();
    const pending = new PiAdapter({ binary: fixture }).runAgent({ ...request, signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toMatchObject({ name: "CostAccountingError" });
    await expectRemoved();
  });

  test("cleans the owned temp directory after process failure", async () => {
    process.env.PI_SESSION_MODE = "failure";
    await expect(new PiAdapter({ binary: fixture }).runAgent(request)).rejects.toThrow();
    await expectRemoved();
  });

  test("cleans the owned temp directory after parsing failure", async () => {
    process.env.PI_SESSION_MODE = "malformed";
    await expect(new PiAdapter({ binary: fixture }).runAgent(request)).rejects.toThrow();
    await expectRemoved();
  });

  test("generate records exactly one normalized entry after settlement", async () => {
    const tracker = new CostTracker();
    await expect(consume(new PiAdapter({ binary: fixture }, tracker).generate(generateRequest()))).resolves.toBe("output");
    expect(tracker.getEntries()).toHaveLength(1);
    expect(tracker.getEntries()[0]).toMatchObject({ type: "llm", provider: "pi", model: "claude-sonnet" });
    await expectRemoved();
  });

  test("runAgent forwards full tool output in progress updates", async () => {
    const progress: string[] = [];
    await new PiAdapter({ binary: fixture }).runAgent({ ...request, onProgress: (message) => progress.push(message) });
    expect(progress).toEqual(["bash…", "bash completed.\nfull tool output"]);
  });

  test("runAgent records exactly one normalized entry after settlement", async () => {
    const tracker = new CostTracker();
    const result = await new PiAdapter({ binary: fixture }, tracker).runAgent(request);
    expect(result.ok).toBe(true);
    expect(tracker.getEntries()).toHaveLength(1);
    expect(tracker.getEntries()[0]).toMatchObject({
      type: "llm", provider: "pi", model: "claude-sonnet", providerSessionId: "session-lifecycle",
    });
    await expectRemoved();
  });

  test("generate cleans up after cancellation", async () => {
    process.env.PI_SESSION_MODE = "cancel";
    const controller = new AbortController();
    const pending = consume(new PiAdapter({ binary: fixture }).generate(generateRequest(controller.signal)));
    setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toMatchObject({ name: "CostAccountingError" });
    await expectRemoved();
  });

  test("generate cleans up after process failure", async () => {
    process.env.PI_SESSION_MODE = "failure";
    await expect(consume(new PiAdapter({ binary: fixture }).generate(generateRequest()))).rejects.toThrow();
    await expectRemoved();
  });

  test("generate cleans up after parsing failure", async () => {
    process.env.PI_SESSION_MODE = "malformed";
    await expect(consume(new PiAdapter({ binary: fixture }).generate(generateRequest()))).rejects.toThrow();
    await expectRemoved();
  });
});

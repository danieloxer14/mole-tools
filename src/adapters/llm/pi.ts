import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CostTracker } from "../../core/cost-tracker";
import { PortError } from "../../core/errors";
import type {
  AgentRequest,
  AgentResult,
  GenerateRequest,
  Llm,
  LlmCapability,
} from "../../ports/llm";
import { deriveUsdCost } from "../../shared/cost/catalog";
import type { Usage, UsdCost } from "../../shared/cost/schema";
import { estimateTokens } from "../../shared/text";
import { parsePiSessionJsonl } from "./pi-session-parser";

export interface PiConfig {
  binary: string;
  projectRoot?: string;
}

const SUPPORTED_CAPABILITIES: LlmCapability[] = [
  "text-generation",
  "agentic-workspace",
];

function nativeUsage(message: Record<string, unknown>): { usage?: Usage; usdCost?: UsdCost } {
  const raw = message.usage;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  const inputTokens = typeof value.inputTokens === "number" ? value.inputTokens : undefined;
  const outputTokens = typeof value.outputTokens === "number" ? value.outputTokens : undefined;
  if (inputTokens === undefined || outputTokens === undefined) return {};
  const cacheReadTokens = typeof value.cacheReadTokens === "number" ? value.cacheReadTokens : 0;
  const cacheWriteTokens = typeof value.cacheWriteTokens === "number" ? value.cacheWriteTokens : 0;
  const cost = value.cost;
  const amount = cost && typeof cost === "object" && !Array.isArray(cost) && typeof (cost as { total?: unknown }).total === "number"
    ? (cost as { total: number }).total
    : undefined;
  return {
    usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, source: "reported" },
    ...(amount !== undefined ? { usdCost: { source: "actual", amount } } : {}),
  };
}

export class PiAdapter implements Llm {
  constructor(
    private readonly cfg: PiConfig,
    private readonly costTracker: CostTracker = new CostTracker(),
  ) {}

  capabilities(): LlmCapability[] {
    return SUPPORTED_CAPABILITIES;
  }

  /**
   * Text generation via Pi subprocess.
   * For now we delegate to a simple non-interactive prompt call.
   * Ollama remains the default for commit/MR — this path exists as the extension seam.
   */
  async *generate(req: GenerateRequest): AsyncIterable<string> {
    const child = spawn(this.cfg.binary, ["-p", "--model", req.model], {
      cwd: this.cfg.projectRoot ?? process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdin.end(`${req.system}\n\n${req.prompt}`);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    await new Promise<void>((resolve, reject) => {
      child.on("close", (code) => {
        if (code === 0) resolve();
        else
          reject(
            new PortError(`Pi exited with code ${code}`, stderr, code ?? 1),
          );
      });
      child.on("error", reject);
    });

    const tokens = stdout.split("\n").filter(Boolean);
    for (const token of tokens) yield token;

    const usage: Usage = {
      inputTokens: estimateTokens(req.system + req.prompt),
      outputTokens: estimateTokens(stdout),
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      source: "estimated",
    };
    this.costTracker.record({
      type: "llm",
      task: req.task,
      provider: "pi",
      model: req.model,
      usage,
      usdCost: deriveUsdCost(usage, "pi", req.model),
    });
  }

  runAgent(req: AgentRequest): Promise<AgentResult> {
    return new Promise((resolve, reject) => {
      const args = [
        "-p", // non-interactive prompt mode
        "--mode",
        "json", // exposes tool and lifecycle events while retaining machine-readable output
        "--model",
        req.model,
      ];

      if (req.permissionPolicy === "auto-approve") {
        args.push("--approve");
      }
      const sessionDir = mkdtempSync(join(tmpdir(), "mole-pi-"));
      args.push("--session-dir", sessionDir);

      if (req.signal?.aborted) {
        resolve({ output: "", stderr: "aborted before start", ok: false });
        return;
      }

      const child = spawn(this.cfg.binary, args, {
        cwd: this.cfg.projectRoot ?? process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      });

      let output = "";
      let stderr = "";
      let pendingStdout = "";
      let providerSessionId: string | undefined;
      let reportedUsage: Usage | undefined;
      let actualUsdCost: UsdCost | undefined;

      const preview = (value: unknown, maxLength = 240): string => {
        const text =
          typeof value === "string"
            ? value
            : Array.isArray(value)
              ? value
                  .map((part) =>
                    typeof part === "object" &&
                    part !== null &&
                    typeof (part as { text?: unknown }).text === "string"
                      ? (part as { text: string }).text
                      : "",
                  )
                  .join("\n")
              : "";
        const compact = text.replace(/\s+/g, " ").trim();
        return compact.length > maxLength
          ? `${compact.slice(0, maxLength - 1)}…`
          : compact;
      };
      const toolDetail = (toolName: unknown, args: unknown): string => {
        const input = args as Record<string, unknown> | null;
        if (!input || typeof input !== "object") return "";
        const target = [input.path, input.filePath, input.file].find(
          (value): value is string => typeof value === "string",
        );
        if (target) return target;
        if (String(toolName) === "bash" && typeof input.command === "string")
          return preview(input.command, 160);
        return preview(JSON.stringify(input), 160);
      };
      const handleEvent = (line: string) => {
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          if ((event.type === "session" || event.type === "session_header" || event.type === "session-start") && typeof event.id === "string") {
            providerSessionId = event.id;
          }
          if (event.type === "tool_execution_start") {
            const detail = toolDetail(event.toolName, event.args);
            req.onProgress?.(
              `${String(event.toolName)}${detail ? ` — ${detail}` : ""}…`,
            );
          }
          if (event.type === "tool_execution_end") {
            const result = event.result as { content?: unknown } | undefined;
            const detail = preview(result?.content);
            req.onProgress?.(
              `${String(event.toolName)} ${event.isError ? "failed" : "completed"}${detail ? ` — ${detail}` : "."}`,
            );
          }
          if (event.type === "message_end") {
            const message = event.message as
              | { role?: unknown; content?: unknown }
              | undefined;
            if (
              message?.role === "assistant" &&
              Array.isArray(message.content)
            ) {
              const text = message.content
                .filter(
                  (part): part is { type: "text"; text: string } =>
                    typeof part === "object" &&
                    part !== null &&
                    (part as { type?: unknown }).type === "text" &&
                    typeof (part as { text?: unknown }).text === "string",
                )
                .map((part) => part.text)
                .join("");
              if (text) output = text;
            }
            if (message?.role === "assistant") {
              const native = nativeUsage(message as Record<string, unknown>);
              if (native.usage) {
                reportedUsage = reportedUsage
                  ? {
                      inputTokens: reportedUsage.inputTokens + native.usage.inputTokens,
                      outputTokens: reportedUsage.outputTokens + native.usage.outputTokens,
                      cacheReadTokens: reportedUsage.cacheReadTokens + native.usage.cacheReadTokens,
                      cacheWriteTokens: reportedUsage.cacheWriteTokens + native.usage.cacheWriteTokens,
                      source: "reported",
                    }
                  : native.usage;
              }
              if (native.usdCost) {
                actualUsdCost = actualUsdCost
                  ? { source: "actual", amount: actualUsdCost.amount + native.usdCost.amount }
                  : native.usdCost;
              }
            }
          }
        } catch {
          // Preserve unexpected output for diagnostics rather than failing the agent run.
          stderr += `${line}\n`;
        }
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        pendingStdout += chunk.toString();
        const lines = pendingStdout.split("\n");
        pendingStdout = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) handleEvent(line);
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      // Send the prompt (with system prompt mode applied)
      const input = this.buildAgentInput(req);
      child.stdin.end(input);

      const abort = () => {
        try {
          if (child.pid) process.kill(-child.pid, "SIGTERM");
          else child.kill("SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      };
      if (req.signal)
        req.signal.addEventListener("abort", abort, { once: true });

      child.on("close", async (code) => {
        if (pendingStdout.trim()) handleEvent(pendingStdout);
        if (req.signal) req.signal.removeEventListener("abort", abort);
        const ok = code === 0 && !req.signal?.aborted;
        let sessionUsage: Usage | undefined;
        let sessionUsdCost: UsdCost | undefined;
        if (ok && providerSessionId) {
          try {
            const parsed = await parsePiSessionJsonl(sessionDir, providerSessionId);
            sessionUsage = parsed.usage;
            sessionUsdCost = parsed.usdCost;
          } catch {
            // Keep native stdout accounting as fallback while session parsing is optional.
          }
        }
        rmSync(sessionDir, { recursive: true, force: true });
        if (ok) {
          const usage = sessionUsage ?? reportedUsage ?? {
            inputTokens: estimateTokens(input),
            outputTokens: estimateTokens(output),
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            source: "estimated" as const,
          };
          const usdCost = sessionUsdCost ?? actualUsdCost ?? deriveUsdCost(usage, "pi", req.model);
          this.costTracker.record({
            type: "llm",
            task: req.purpose,
            provider: "pi",
            model: req.model,
            providerSessionId,
            usage,
            usdCost,
          });
          resolve({ output, stderr, ok, usage, usdCost, providerSessionId });
          return;
        }
        resolve({
          output,
          stderr: req.signal?.aborted ? "aborted" : stderr,
          ok,
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, source: "estimated" },
          usdCost: { source: "unavailable" },
        });
      });

      child.on("error", (err) => {
        rmSync(sessionDir, { recursive: true, force: true });
        if (req.signal) req.signal.removeEventListener("abort", abort);
        reject(new PortError(`Pi subprocess error: ${err.message}`, ""));
      });
    });
  }

  private buildAgentInput(req: AgentRequest): string {
    switch (req.systemPromptMode) {
      case "replace":
        return req.prompt;
      case "append":
        return `${req.prompt}`;
    }
  }
}

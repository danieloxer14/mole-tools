import { CostTracker } from "../../core/cost-tracker";
import { PortError } from "../../core/errors";
import type {
  AgentRequest,
  AgentResult,
  GenerateRequest,
  Llm,
  LlmCapability,
} from "../../ports/llm";
import { UnsupportedCapabilityError } from "../../ports/llm";
import { deriveUsdCost } from "../../shared/cost/catalog";
import { estimateTokens } from "../../shared/text";

export interface OllamaConfig {
  baseUrl: string;
}

interface OllamaChunk {
  response?: string;
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

const SUPPORTED_CAPABILITIES: LlmCapability[] = ["text-generation"];

export class OllamaAdapter implements Llm {
  constructor(
    private readonly cfg: OllamaConfig,
    private readonly costTracker: CostTracker = new CostTracker(),
  ) {}

  capabilities(): LlmCapability[] {
    return SUPPORTED_CAPABILITIES;
  }

  async *generate(req: GenerateRequest): AsyncIterable<string> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: req.model,
          system: req.system,
          prompt: req.prompt,
          stream: true,
          think: false,
        }),
        signal: AbortSignal.timeout(600000),
      });
    } catch (e) {
      throw new PortError(
        `Cannot reach Ollama daemon at ${this.cfg.baseUrl}: ${String(e)}`,
      );
    }

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 404 || /not found/i.test(text)) {
        throw new PortError(
          `Model "${req.model}" is not pulled. Run: ollama pull ${req.model}`,
          text,
          res.status,
        );
      }
      throw new PortError(
        `Ollama request failed (${res.status})`,
        text,
        res.status,
      );
    }
    if (!res.body)
      throw new PortError("Ollama returned an empty response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let responseText = "";
    let promptEvalCount: number | undefined;
    let evalCount: number | undefined;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          const chunk = JSON.parse(line) as OllamaChunk;
          if (chunk.response) {
            responseText += chunk.response;
            yield chunk.response;
          }
          if (chunk.prompt_eval_count !== undefined)
            promptEvalCount = chunk.prompt_eval_count;
          if (chunk.eval_count !== undefined) evalCount = chunk.eval_count;
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }

    const usage = {
      inputTokens: promptEvalCount ?? estimateTokens(req.system + req.prompt),
      outputTokens: evalCount ?? estimateTokens(responseText),
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      source:
        promptEvalCount !== undefined && evalCount !== undefined
          ? ("reported" as const)
          : ("estimated" as const),
    };
    this.costTracker.record({
      type: "llm",
      task: req.task,
      provider: "ollama",
      model: req.model,
      usage,
      usdCost: deriveUsdCost(usage, "ollama", req.model),
    });
  }

  runAgent(_req: AgentRequest): Promise<AgentResult> {
    throw new UnsupportedCapabilityError("agentic-workspace", "ollama");
  }
}

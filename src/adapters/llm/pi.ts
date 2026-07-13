import { spawn } from "node:child_process";
import { CostTracker } from "../../core/cost-tracker";
import { PortError } from "../../core/errors";
import type {
	AgentRequest,
	AgentResult,
	GenerateRequest,
	LlmCapability,
	Llm,
} from "../../ports/llm";
import { UnsupportedCapabilityError } from "../../ports/llm";
import { estimateTokens } from "../../shared/text";

export interface PiConfig {
	binary: string;
	projectRoot?: string;
}

const SUPPORTED_CAPABILITIES: LlmCapability[] = [
	"text-generation",
	"agentic-workspace",
];

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
				else reject(new PortError(`Pi exited with code ${code}`, stderr, code ?? 1));
			});
			child.on("error", reject);
		});

		const tokens = stdout.split("\n").filter(Boolean);
		for (const token of tokens) yield token;

		this.costTracker.record({
			type: "llm",
			task: req.task,
			inputTokens: estimateTokens(req.system + req.prompt),
			outputTokens: estimateTokens(stdout),
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

			if (req.signal?.aborted) {
				resolve({ output: "", stderr: "aborted before start", ok: false });
				return;
			}

			const child = spawn(this.cfg.binary, args, {
				cwd: this.cfg.projectRoot ?? process.cwd(),
				stdio: ["pipe", "pipe", "pipe"],
			});

			let output = "";
			let stderr = "";
			let pendingStdout = "";

			const handleEvent = (line: string) => {
				try {
					const event = JSON.parse(line) as Record<string, unknown>;
					if (event.type === "tool_execution_start") {
						req.onProgress?.(`Pi: running ${String(event.toolName)}…`);
					}
					if (event.type === "tool_execution_end") {
						req.onProgress?.(`Pi: ${String(event.toolName)} ${event.isError ? "failed" : "completed"}.`);
					}
					if (event.type === "message_end") {
						const message = event.message as { role?: unknown; content?: unknown } | undefined;
						if (message?.role === "assistant" && Array.isArray(message.content)) {
							const text = message.content
								.filter((part): part is { type: "text"; text: string } => typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string")
								.map((part) => part.text)
								.join("");
							if (text) output = text;
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

			const abort = () => { child.kill("SIGTERM"); };
			if (req.signal) req.signal.addEventListener("abort", abort, { once: true });

			child.on("close", (code) => {
				if (pendingStdout.trim()) handleEvent(pendingStdout);
				if (req.signal) req.signal.removeEventListener("abort", abort);
				const ok = code === 0 && !req.signal?.aborted;
				resolve({ output, stderr: req.signal?.aborted ? "aborted" : stderr, ok });
			});

			child.on("error", (err) => {
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

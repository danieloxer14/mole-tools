import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CostTracker } from "../../core/cost-tracker";
import type {
	AgentRequest,
	AgentResult,
	GenerateRequest,
	Llm,
	LlmCapability,
} from "../../ports/llm";
import { deriveUsdCost } from "../../shared/cost/catalog";
import { CostAccountingError } from "../../shared/cost/errors";
import { parsePiSessionJsonl, type ParsedPiSession } from "./pi-session-parser";

export interface PiConfig {
	binary: string;
	projectRoot?: string;
}

const SUPPORTED_CAPABILITIES: LlmCapability[] = [
	"text-generation",
	"agentic-workspace",
];

type SessionRequest = GenerateRequest | AgentRequest;
interface SessionResult {
	lines: string[];
	stderr: string;
	parsed?: ParsedPiSession;
	aborted: boolean;
}

function numberField(value: unknown): number | undefined {
	const number = typeof value === "number" ? value : Number(value);
	return Number.isFinite(number) ? number : undefined;
}

function firstNumber(value: Record<string, unknown>, keys: string[]): number | undefined {
	for (const key of keys) {
		const number = numberField(value[key]);
		if (number !== undefined) return number;
	}
	return undefined;
}

function preview(value: unknown, maxLength = 240): string {
	const text = typeof value === "string" ? value : Array.isArray(value)
		? value.map((part) => typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "").join("\n")
		: "";
	const compact = text.replace(/\s+/g, " ").trim();
	return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

function toolOutput(result: unknown): string {
	if (!result || typeof result !== "object") return preview(result);
	const content = (result as { content?: unknown }).content;
	if (Array.isArray(content)) {
		const text = content
			.filter((part): part is { text: string } => typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string")
			.map((part) => part.text)
			.join("\n")
			.trim();
		if (text) return text;
	}
	return preview(result);
}

/** Owns Pi's temporary session directory and settles only from its completed JSONL. */
async function withPiSession(
	cfg: PiConfig,
	req: SessionRequest,
	input: string,
	onEvent?: (event: Record<string, unknown>) => void,
): Promise<SessionResult> {
	const directory = await mkdtemp(join(tmpdir(), "mole-pi-"));
	let child: ChildProcess | undefined;
	let aborted = false;
	try {
		const args = ["-p", "--mode", "json", "--session-dir", directory, "--model", req.model];
		if ("permissionPolicy" in req && req.permissionPolicy === "auto-approve") args.push("--approve");
		child = spawn(cfg.binary, args, { cwd: cfg.projectRoot ?? process.cwd(), stdio: ["pipe", "pipe", "pipe"], detached: true });
		let pending = "";
		let stderr = "";
		const lines: string[] = [];
		let sessionId: string | undefined;
		const handle = (line: string) => {
			if (!line.trim()) return;
			lines.push(line);
			try {
				const event = JSON.parse(line) as Record<string, unknown>;
				if ((event.type === "session" || event.type === "session_header" || event.type === "session-start") && typeof event.id === "string") sessionId = event.id;
				onEvent?.(event);
			} catch { /* JSONL is validated by the completed-session parser. */ }
		};
		child.stdout?.on("data", (chunk: Buffer) => {
			pending += chunk.toString();
			const split = pending.split("\n");
			pending = split.pop() ?? "";
			for (const line of split) handle(line);
		});
		child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
		const abort = () => {
			aborted = true;
			try { if (child?.pid) process.kill(-child.pid, "SIGTERM"); else child?.kill("SIGTERM"); } catch { child?.kill("SIGTERM"); }
		};
		const signal = "signal" in req ? req.signal : undefined;
		signal?.addEventListener("abort", abort, { once: true });
		child.stdin?.end(input);
		const code = await new Promise<number>((resolve, reject) => {
			child?.once("error", (error) => reject(new CostAccountingError(`Pi subprocess error: ${error.message}`, error)));
			child?.once("close", (value) => resolve(value ?? 1));
		});
		if (pending.trim()) handle(pending);
		signal?.removeEventListener("abort", abort);
		if (aborted) throw new CostAccountingError("Pi operation was cancelled");
		if (code !== 0) throw new CostAccountingError(`Pi exited with code ${code}: ${stderr}`, stderr);
		if (!sessionId) throw new CostAccountingError("Pi session header is missing");
		const parsed = await parsePiSessionJsonl(directory, sessionId);
		return { lines, stderr, parsed, aborted: false };
	} finally {
		if (child && !child.killed) {
			try { if (child.pid) process.kill(-child.pid, "SIGTERM"); else child.kill("SIGTERM"); } catch { child.kill("SIGTERM"); }
		}
		await rm(directory, { recursive: true, force: true });
	}
}

export class PiAdapter implements Llm {
	constructor(private readonly cfg: PiConfig, private readonly costTracker: CostTracker = new CostTracker()) {}
	capabilities(): LlmCapability[] { return SUPPORTED_CAPABILITIES; }

	async *generate(req: GenerateRequest): AsyncIterable<string> {
		const result = await withPiSession(this.cfg, req, `${req.system}\n\n${req.prompt}`);
		for (const line of result.lines) {
			try {
				const event = JSON.parse(line) as Record<string, unknown>;
				if (event.type !== "message_end") continue;
				const message = event.message as { role?: unknown; content?: unknown } | undefined;
				if (message?.role === "assistant" && Array.isArray(message.content)) yield message.content.map((part) => typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "").join("");
			} catch { /* parser has already validated the persisted stream. */ }
		}
		if (result.parsed) this.record(req, result.parsed);
	}

	runAgent(req: AgentRequest): Promise<AgentResult> {
		let output = "";
		const resultPromise = withPiSession(this.cfg, req, this.buildAgentInput(req), (event) => {
			if (event.type === "tool_execution_start") req.onProgress?.(`${String(event.toolName)}…`);
			if (event.type === "tool_execution_end") {
				const status = event.isError ? "failed" : "completed";
				const output = toolOutput(event.result);
				req.onProgress?.(`${String(event.toolName)} ${status}.${output ? `\n${output}` : ""}`);
			}
			if (event.type === "message_end") {
				const message = event.message as { role?: unknown; content?: unknown } | undefined;
				if (message?.role === "assistant" && Array.isArray(message.content)) output = message.content.map((part) => typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "").join("");
			}
		});
		return resultPromise.then((settled) => {
			if (settled.aborted) throw new CostAccountingError("Pi operation was cancelled");
			const parsed = settled.parsed!;
			this.record(req, parsed);
			return { output, stderr: settled.stderr, ok: true, usage: parsed.usage, usdCost: parsed.usdCost ?? deriveUsdCost(parsed.usage, "pi", req.model), providerSessionId: parsed.providerSessionId };
		});
	}

	private record(req: SessionRequest, parsed: ParsedPiSession): void {
		this.costTracker.record({ type: "llm", task: "task" in req ? req.task : req.purpose, provider: "pi", model: req.model, providerSessionId: parsed.providerSessionId, usage: parsed.usage, usdCost: parsed.usdCost ?? deriveUsdCost(parsed.usage, "pi", req.model) });
	}
	private buildAgentInput(req: AgentRequest): string { return req.systemPromptMode === "replace" ? req.prompt : req.prompt; }
}

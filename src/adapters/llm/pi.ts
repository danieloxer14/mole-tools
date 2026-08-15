import { spawn } from "node:child_process";
import { PortError } from "../../core/errors";
import type { GenerateRequest, Llm } from "../../ports/llm";

export interface PiConfig {
	binary: string;
	projectRoot?: string;
}

export class PiAdapter implements Llm {
	constructor(private readonly cfg: PiConfig) {}

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
	}
}

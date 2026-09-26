import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type {
	AgentEvent,
	AgentTurn,
	ReviewAgent,
} from "../../../ports/review-agent";
import { createReviewRoutes, type ReviewApiState } from "../routes";
import { ReviewStateSchema } from "../state";
import { LayerPane } from "./components/LayerPane";
import { mergeLayerStreamFrame, startInitialLayerStream } from "./layer-stream";

const token = "layer-stream-test-token";
const originalFetch = globalThis.fetch;

class DeferredLayerAgent implements ReviewAgent {
	readonly started = Promise.withResolvers<void>();
	readonly release = Promise.withResolvers<void>();
	runs = 0;

	constructor(private readonly fail: boolean) {}

	async preflight(): Promise<void> {}

	async *run(turn: AgentTurn): AsyncIterable<AgentEvent> {
		this.runs += 1;
		this.started.resolve();
		await this.release.promise;
		if (this.fail) throw new Error("Layer agent failed");
		const outputPath = turn.message.match(/absolute path: ([^\n]+)/)?.[1];
		if (!outputPath) throw new Error("missing output path");
		await Bun.write(
			outputPath,
			JSON.stringify({
				version: 1,
				layers: [
					{
						title: "API layer",
						tldr: "Routes API requests.",
						files: ["src/app.ts"],
					},
				],
			}),
		);
		yield { kind: "session", sessionId: "layer-stream-session" };
		yield { kind: "turn_end" };
	}
}

test("reattaches to a running layer stream and renders its terminal state", async () => {
	try {
		for (const fail of [false, true]) {
			const dir = await mkdtemp(join(tmpdir(), "mole-layer-stream-client-"));
			const agent = new DeferredLayerAgent(fail);
			try {
				const routes = createReviewRoutes({
					token,
					state: ReviewStateSchema.parse({
						version: 1,
						mode: "code",
						mr: {
							host: "gitlab.example.com",
							projectPath: "group/project",
							iid: 42,
							webUrl:
								"https://gitlab.example.com/group/project/-/merge_requests/42",
							title: "Add feature",
							sourceBranch: "feature",
							targetBranch: "main",
						},
						revision: {
							headSha: "head",
							mergeBaseSha: "base",
							diffRefs: {
								baseSha: "base",
								startSha: "base",
								headSha: "head",
							},
							syncedAt: "2026-01-01T00:00:00.000Z",
						},
						worktreePath: dir,
						repoRoot: dir,
						layerStatus: "pending",
						layerError: null,
						layers: [],
						chatSessionId: null,
					}),
					paths: {
						layersDir: join(dir, "layers"),
						promptDir: join(dir, "prompt"),
						layerPath: (runId) => join(dir, "layers", `${runId}.json`),
						promptPath: (turnId) => join(dir, "prompt", `${turnId}.md`),
					},
					diff: [
						{
							oldPath: "src/app.ts",
							newPath: "src/app.ts",
							status: "modified",
							binary: false,
							insertions: 1,
							deletions: 0,
							hunks: [],
						},
					],
					layerDiff: [
						{
							path: "src/app.ts",
							statOnly: false,
							patch: "diff --git a/src/app.ts b/src/app.ts",
							insertions: 1,
							deletions: 0,
						},
					],
					layerAgent: agent,
					promptText: "Generate one review layer.",
				});

				const generation = await routes(
					new Request(`http://127.0.0.1/api/layers/regenerate?t=${token}`, {
						method: "POST",
					}),
				);
				const generationBody = generation.text();
				await agent.started.promise;
				const stateResponse = await routes(
					new Request(`http://127.0.0.1/api/state?t=${token}`),
				);
				const activeState = (await stateResponse.json()) as ReviewApiState;
				expect(activeState.layerStatus).toBe("running");

				const observerStarted = Promise.withResolvers<void>();
				globalThis.fetch = async (input, init) => {
					const url = input instanceof Request ? input.url : input.toString();
					const response = await routes(
						new Request(new URL(url, "http://127.0.0.1"), init),
					);
					observerStarted.resolve();
					return response;
				};
				let clientState = activeState;
				const stream = startInitialLayerStream(token, activeState, (frame) => {
					clientState = mergeLayerStreamFrame(clientState, frame);
				});
				expect(stream?.action).toBe("observe");
				if (!stream) throw new Error("Running state did not start an observer");
				await observerStarted.promise;

				agent.release.resolve();
				await Promise.all([generationBody, stream.stream]);
				const expectedStatus = fail ? "failed" : "ready";
				expect(clientState.layerStatus).toBe(expectedStatus);
				if (fail) {
					expect(clientState.layerError).toContain("Layer agent failed");
				} else {
					expect(clientState.layers).toEqual([
						expect.objectContaining({
							title: "API layer",
							tldr: "Routes API requests.",
						}),
					]);
				}
				expect(agent.runs).toBe(1);

				const markup = renderToStaticMarkup(
					<LayerPane
						state={clientState}
						files={["src/app.ts"]}
						filesContent={null}
						selectedPath={null}
						onSelectFile={() => undefined}
						onSelectLayer={() => undefined}
						onToggleDone={() => undefined}
						layerAction={null}
						actionError={null}
						externallyDisabled={false}
						onRegenerate={() => undefined}
						onRetry={() => undefined}
					/>,
				);
				expect(markup).not.toContain("Generating layers…");
				expect(markup).toContain(
					fail ? "Layer generation failed" : "Completed layers",
				);
			} finally {
				agent.release.resolve();
				await rm(dir, { recursive: true, force: true });
			}
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
});

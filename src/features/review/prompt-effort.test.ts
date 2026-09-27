import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PROMPTS } from "../../adapters/prompts/defaults";
import { createReviewRoutes } from "./routes";
import { ReviewStateSchema } from "./state";

const token = "prompt-effort-test-token";

function state() {
	return ReviewStateSchema.parse({
		version: 1,
		mode: "code",
		mr: {
			host: "gitlab.example.com",
			projectPath: "group/project",
			iid: 42,
			webUrl: "https://gitlab.example.com/group/project/-/merge_requests/42",
			title: "Prompt effort",
			sourceBranch: "feature",
			targetBranch: "main",
		},
		revision: {
			headSha: "head",
			mergeBaseSha: "base",
			diffRefs: { baseSha: "base", startSha: "base", headSha: "head" },
			syncedAt: "2026-01-01T00:00:00.000Z",
		},
		worktreePath: "/tmp/review-worktree",
		repoRoot: "/tmp/review-repo",
		layerStatus: "pending",
		layerError: null,
		layers: [],
		viewedFiles: [],
		chats: [
			{
				id: "chat-a",
				title: "",
				sessionId: null,
				createdAt: "2026-01-01T00:00:00.000Z",
			},
		],
		activeChatId: "chat-a",
		drafts: [],
	});
}

function request(path: string, init?: RequestInit): Request {
	return new Request(`http://127.0.0.1${path}`, init);
}

function getPrompt(path: string): Request {
	return request(`${path}${path.includes("?") ? "&" : "?"}t=${token}`);
}

function savePrompt(path: string, body: unknown): Request {
	return request(`${path}?t=${token}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("prompt effort version lifecycle", () => {
	test("round-trips effort, copies and rolls back it, then clears metadata on reset", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-prompt-effort-"));
		try {
			const routes = createReviewRoutes({
				token,
				state: state(),
				promptSourceDir: dir,
				config: { review: { agent: "claude" } },
			});
			const original = await routes(
				savePrompt("/api/prompts/commit-system", {
					preset: "default",
					text: "Keep this prompt body",
					agent: "claude",
					model: "claude-sonnet",
					effort: "high",
				}),
			);
			expect(original.status).toBe(200);
			expect(await original.json()).toEqual({ version: 2, saved: true });

			const effortOnlyChange = await routes(
				savePrompt("/api/prompts/commit-system", {
					preset: "default",
					text: "Keep this prompt body",
					agent: "claude",
					model: "claude-sonnet",
					effort: "max",
				}),
			);
			expect(effortOnlyChange.status).toBe(200);
			expect(await effortOnlyChange.json()).toEqual({
				version: 3,
				saved: true,
			});
			const current = await routes(getPrompt("/api/prompts/commit-system"));
			expect(await current.json()).toMatchObject({
				text: "Keep this prompt body",
				agent: "claude",
				model: "claude-sonnet",
				effort: "max",
				versions: [1, 2, 3],
			});

			const copied = await routes(
				savePrompt("/api/prompts/commit-system/presets", {
					name: "snapshot",
				}),
			);
			expect(copied.status).toBe(200);
			const copiedPrompt = await routes(
				getPrompt("/api/prompts/commit-system?preset=snapshot"),
			);
			expect(await copiedPrompt.json()).toMatchObject({
				agent: "claude",
				model: "claude-sonnet",
				effort: "max",
			});

			const rollback = await routes(
				savePrompt("/api/prompts/commit-system/rollback", {
					preset: "default",
					rev: 2,
				}),
			);
			expect(await rollback.json()).toEqual({ version: 4 });
			const rolledBack = await routes(getPrompt("/api/prompts/commit-system"));
			expect(await rolledBack.json()).toMatchObject({ effort: "high" });

			const reset = await routes(
				savePrompt("/api/prompts/commit-system/reset", {
					preset: "default",
				}),
			);
			expect(await reset.json()).toEqual({ version: 5 });
			const resetPrompt = await routes(getPrompt("/api/prompts/commit-system"));
			expect(await resetPrompt.json()).toMatchObject({
				text: DEFAULT_PROMPTS["commit-system"],
				agent: null,
				model: null,
				effort: null,
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("rejects invalid effort without creating a usable prompt version", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-prompt-invalid-effort-"));
		try {
			const routes = createReviewRoutes({
				token,
				state: state(),
				promptSourceDir: dir,
				config: { review: { agent: "claude" } },
			});
			const cases = [
				{ agent: "claude", effort: "off" },
				{ agent: "omp", effort: "ultra" },
				{ agent: null, effort: "off" },
			];
			for (const metadata of cases) {
				const response = await routes(
					savePrompt("/api/prompts/commit-system", {
						preset: "default",
						text: "Invalid metadata",
						...metadata,
					}),
				);
				expect(response.status).toBe(400);
			}

			const latest = await routes(getPrompt("/api/prompts/commit-system"));
			expect(await latest.json()).toMatchObject({
				effort: null,
				versions: [1],
			});
			expect(
				await Bun.file(
					join(dir, "commit-system", "default", "002.md"),
				).exists(),
			).toBe(false);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

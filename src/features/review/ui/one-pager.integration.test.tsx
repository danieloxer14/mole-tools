import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act } from "react";
import { FeatureFlagStore } from "../../../adapters/feature-flags/store";
import type {
	AgentEvent,
	AgentTurn,
	ReviewAgent,
} from "../../../ports/review-agent";
import { createReviewRoutes } from "../routes";
import { type ReviewState, ReviewStateSchema } from "../state";
import { ReviewStore } from "../store";
import { loadFeatureFlags } from "./feature-flags";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const token = "one-pager-mounted-smoke-token";

function reviewState(worktreePath: string): ReviewState {
	return ReviewStateSchema.parse({
		version: 1,
		mode: "code",
		mr: {
			host: "gitlab.example.com",
			projectPath: "group/project",
			iid: 42,
			webUrl: "https://gitlab.example.com/group/project/-/merge_requests/42",
			title: "One pager mounted smoke",
			description: "Review description.",
			sourceBranch: "feature",
			targetBranch: "main",
		},
		revision: {
			headSha: "head",
			mergeBaseSha: "base",
			diffRefs: { baseSha: "base", startSha: "base", headSha: "head" },
			syncedAt: "2026-01-01T00:00:00.000Z",
		},
		worktreePath,
		repoRoot: worktreePath,
		layerStatus: "ready",
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

class ScriptedOnePagerAgent implements ReviewAgent {
	runs = 0;
	firstRunStarted = false;
	readonly supportsScopedWrites = true;
	secondRunStarted = false;
	readonly releaseFailure = Promise.withResolvers<void>();
	readonly releaseSuccess = Promise.withResolvers<void>();

	async preflight(): Promise<void> {}

	async *run(turn: AgentTurn): AsyncIterable<AgentEvent> {
		this.runs++;
		if (this.runs === 1) {
			this.firstRunStarted = true;
			await this.releaseFailure.promise;
			yield { kind: "error", message: "boom" };
			return;
		}
		if (this.runs === 3) {
			if (!turn.writeDir)
				throw new Error("one-pager chat write directory missing");
			await Bun.write(
				join(turn.writeDir, "one-pager.md"),
				"# Edited summary\n",
			);
			yield { kind: "tool", name: "edit", phase: "start" };
			yield { kind: "tool", name: "edit", phase: "end" };
			yield { kind: "turn_end" };
			return;
		}

		this.secondRunStarted = true;
		const outputPath = turn.message.match(/absolute path: (\S+)/)?.[1];
		if (!outputPath) throw new Error("one pager output path is missing");
		await this.releaseSuccess.promise;
		await Bun.write(outputPath, "# Initial summary\n");
		yield { kind: "turn_end" };
	}
}

async function waitFor(
	label: string,
	condition: () => boolean | Promise<boolean>,
	timeoutMs = 4_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		let ready = false;
		await act(async () => {
			ready = await condition();
			if (!ready) await Bun.sleep(5);
		});
		if (ready) return;
	}
	throw new Error(`Timed out waiting for ${label}`);
}

function findButton(
	container: HTMLElement,
	label: string,
): HTMLButtonElement | null {
	return (
		[...container.querySelectorAll<HTMLButtonElement>("button")].find(
			(button) => button.textContent?.trim() === label,
		) ?? null
	);
}
describe("one pager mounted review UI smoke", () => {
	test("scopes chat to one-pager, reloads edits, and hides the tab when the flag turns off", async () => {
		if (process.env.MOLE_ONE_PAGER_SMOKE_CHILD !== "1") {
			const smokePath = new URL(
				"./one-pager.integration.test.tsx",
				import.meta.url,
			).pathname;
			const child = Bun.spawn(["bun", "test", smokePath], {
				cwd: process.cwd(),
				env: {
					...process.env,
					MOLE_ONE_PAGER_SMOKE_CHILD: "1",
				},
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			});
			const [exitCode, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			if (exitCode !== 0)
				throw new Error(
					`Mounted one pager smoke failed:\n${stdout}\n${stderr}`,
				);
			expect(`${stdout}\n${stderr}`).toContain("1 pass");
			return;
		}

		const dir = await mkdtemp(join(tmpdir(), "mole-one-pager-smoke-"));
		const container = document.createElement("div");
		container.innerHTML = '<div id="root"></div>';
		document.body.append(container);
		window.history.replaceState(null, "", `/?t=${token}`);

		const originalFetch = globalThis.fetch;
		const configDir = join(dir, "config");
		const featureFlagStore = new FeatureFlagStore(
			join(configDir, "features.json"),
		);
		const promptSourceDir = join(configDir, "prompts");
		const onePagerPromptDir = join(
			promptSourceDir,
			"review-one-pager",
			"default",
		);
		const onePagerDir = join(dir, "one-pager");
		const worktreePath = join(dir, "worktree");
		const store = new ReviewStore({
			statePath: join(dir, "review", "review.json"),
			chatPath: join(dir, "review", "chat.ndjson"),
			chatsDir: join(dir, "review", "chats"),
		});
		const agent = new ScriptedOnePagerAgent();

		try {
			await mkdir(configDir, { recursive: true });
			await writeFile(join(configDir, "features.json"), '{"one-pager":true}\n');
			await mkdir(onePagerPromptDir, { recursive: true });
			await writeFile(
				join(onePagerPromptDir, "001.md"),
				"Write a concise review summary.\n",
			);
			await mkdir(worktreePath, { recursive: true });
			await store.write(reviewState(worktreePath));
			await store.appendChat("chat-a", {
				role: "assistant",
				text: "Review chat restored",
			});

			const routes = createReviewRoutes({
				token,
				store,
				paths: {
					layersDir: join(dir, "layers"),
					promptDir: promptSourceDir,
					layerPath: (runId) => join(dir, "layers", `${runId}.json`),
					promptPath: (turnId) => join(promptSourceDir, `${turnId}.md`),
				},
				diff: [],
				featureFlagStore,
				onePagerDir,
				promptSourceDir,
				reviewAgent: agent,
			});
			const chatHistoryRequests: string[] = [];
			let rejectNextOnePagerChatCreation = false;
			let rejectNextChatSelection = false;
			globalThis.fetch = Object.assign(
				async (
					input: Parameters<typeof globalThis.fetch>[0],
					init?: Parameters<typeof globalThis.fetch>[1],
				) => {
					const request = new Request(
						input instanceof Request
							? input
							: new URL(
									input instanceof URL ? input.href : input,
									window.location.href,
								),
						init,
					);
					const pathname = new URL(request.url).pathname;
					if (
						request.method === "GET" &&
						/^\/api\/chats\/[^/]+$/.test(pathname)
					)
						chatHistoryRequests.push(pathname);
					if (
						rejectNextOnePagerChatCreation &&
						request.method === "POST" &&
						new URL(request.url).pathname === "/api/chats" &&
						((await request.clone().json()) as { kind?: string }).kind ===
							"one-pager"
					) {
						rejectNextOnePagerChatCreation = false;
						return new Response(null, { status: 503 });
					}
					if (
						rejectNextChatSelection &&
						request.method === "POST" &&
						new URL(request.url).pathname === "/api/chats/active"
					) {
						rejectNextChatSelection = false;
						return new Response(null, { status: 503 });
					}
					return routes(request);
				},
				{ preconnect: originalFetch.preconnect.bind(originalFetch) },
			);

			// Import after installing the root and route fetch: main boots the app on evaluation.
			await act(async () => {
				await import("./main");
				await Bun.sleep(0);
			});
			const root = container.querySelector<HTMLElement>("#root");
			if (!root) throw new Error("Review app root is missing");
			await waitFor("Overview navigation button", () =>
				Boolean(findButton(container, "Overview")),
			);
			act(() => findButton(container, "Overview")?.click());

			await waitFor("One pager tab", () => {
				const overview = container.querySelector('[aria-label="Overview"]');
				return [...(overview?.querySelectorAll('[role="tab"]') ?? [])].some(
					(tab) => tab.textContent?.trim() === "One pager",
				);
			});
			rejectNextOnePagerChatCreation = true;
			act(() => findButton(container, "One pager")?.click());
			await waitFor("initial Create panel", () => {
				const overview = container.querySelector('[aria-label="Overview"]');
				return (
					overview?.textContent?.includes(
						"Click here to create a one-page summary of this MR",
					) === true && findButton(container, "Create") !== null
				);
			});
			const firstCreate = findButton(container, "Create");
			if (!firstCreate) throw new Error("Initial Create button is missing");
			act(() => firstCreate.click());
			await waitFor(
				"first generation spinner",
				() =>
					container.textContent?.includes("Creating your one pager") === true &&
					agent.firstRunStarted &&
					container.querySelector('svg[data-slot="spinner"]') !== null,
			);
			agent.releaseFailure.resolve();
			await waitFor("failure alert and restored Create button", () => {
				const alert = container.querySelector(
					'[aria-label="Overview"] [role="alert"]',
				);
				return (
					alert?.textContent?.includes("boom") === true &&
					findButton(container, "Create") !== null
				);
			});

			const secondCreate = findButton(container, "Create");
			if (!secondCreate)
				throw new Error("Create button after failure is missing");
			act(() => secondCreate.click());
			await waitFor(
				"second generation spinner",
				() =>
					container.textContent?.includes("Creating your one pager") === true &&
					agent.secondRunStarted &&
					container.querySelector('svg[data-slot="spinner"]') !== null,
			);
			agent.releaseSuccess.resolve();
			await waitFor(
				"generated summary and Regenerate button",
				() =>
					container.querySelector('[aria-label="Overview"] h1')?.textContent ===
						"Initial summary" && findButton(container, "Regenerate") !== null,
			);
			expect(
				container.querySelector('[aria-label="Regenerate one pager"]'),
			).not.toBeNull();

			await waitFor(
				"scoped one-pager chat creation error",
				() =>
					container.textContent?.includes(
						"Create chat request failed (503)",
					) === true,
			);
			expect(container.textContent).not.toContain("Review unavailable");
			expect(
				container.querySelector('[aria-label="Overview"] h1')?.textContent,
			).toBe("Initial summary");
			const retryOnePagerChatButton =
				container.querySelector<HTMLButtonElement>(
					'button[aria-label="New chat"]',
				);
			if (!retryOnePagerChatButton)
				throw new Error("One-pager New chat retry button is missing");
			act(() => retryOnePagerChatButton.click());

			await waitFor("one-pager chat creation and filtered list", async () => {
				const state = await store.read();
				if (!state) return false;
				const chatCount = container.querySelector(
					'button[aria-label="Switch chat"] [data-slot="badge"]',
				);
				const onePagerChats = state.chats.filter(
					(chat) => chat.kind === "one-pager",
				);
				return (
					onePagerChats.length === 1 &&
					state.chats.filter((chat) => chat.kind === "review").length === 1 &&
					state.activeOnePagerChatId === onePagerChats[0]?.id &&
					chatCount?.textContent === "1"
				);
			});
			const createdState = await store.read();
			if (!createdState) throw new Error("Review state is missing");
			const onePagerChats = createdState.chats.filter(
				(chat) => chat.kind === "one-pager",
			);
			expect(onePagerChats).toHaveLength(1);
			expect(createdState.activeOnePagerChatId).toBe(onePagerChats[0]?.id);
			expect(
				container.querySelector(
					'button[aria-label="Switch chat"] [data-slot="badge"]',
				)?.textContent,
			).toBe("1");
			expect(container.textContent).not.toContain("Review chat restored");
			const initialOnePagerChatId = createdState.activeOnePagerChatId;
			if (!initialOnePagerChatId)
				throw new Error("Auto-created one-pager chat is not active");
			const newOnePagerChatButton = container.querySelector<HTMLButtonElement>(
				'button[aria-label="New chat"]',
			);
			if (!newOnePagerChatButton)
				throw new Error("One-pager New chat button is missing");
			act(() => newOnePagerChatButton.click());
			await waitFor("new chat uses one-pager scope", async () => {
				const state = await store.read();
				if (!state) return false;
				const onePagerChats = state.chats.filter(
					(chat) => chat.kind === "one-pager",
				);
				return (
					onePagerChats.length === 2 &&
					state.activeOnePagerChatId !== initialOnePagerChatId &&
					onePagerChats.some(
						(chat) => chat.id === state.activeOnePagerChatId,
					) &&
					state.activeChatId === "chat-a" &&
					container.querySelector(
						'button[aria-label="Switch chat"] [data-slot="badge"]',
					)?.textContent === "2" &&
					!newOnePagerChatButton.disabled
				);
			});
			const stateAfterNewChat = await store.read();
			if (!stateAfterNewChat) throw new Error("Review state is missing");
			await act(async () => {
				await Bun.sleep(25);
			});
			expect(chatHistoryRequests).not.toContain(
				`/api/chats/${stateAfterNewChat.activeOnePagerChatId}`,
			);
			expect(container.textContent).not.toContain("Review chat restored");

			const blockTag = container.querySelector<HTMLButtonElement>(
				'[aria-label="Overview"] .markdown-block-tag',
			);
			if (!blockTag) throw new Error("One-pager block Tag action is missing");
			act(() => {
				blockTag.dispatchEvent(
					new window.KeyboardEvent("keydown", {
						key: "Enter",
						bubbles: true,
						cancelable: true,
					}),
				);
				blockTag.dispatchEvent(
					new window.KeyboardEvent("keydown", {
						key: "Enter",
						bubbles: true,
						cancelable: true,
					}),
				);
			});
			await waitFor("deduplicated one-pager chat tag", () => {
				const matchingTags = [
					...container.querySelectorAll<HTMLElement>('[data-slot="badge"]'),
				].filter((badge) => badge.textContent?.includes("One pager:1-1"));
				return matchingTags.length === 1;
			});

			const composer = container.querySelector<HTMLTextAreaElement>(
				'textarea[aria-label="Chat message"]',
			);
			if (!composer) throw new Error("One-pager chat composer is missing");
			const valueSetter = Object.getOwnPropertyDescriptor(
				window.HTMLTextAreaElement.prototype,
				"value",
			)?.set;
			act(() => {
				valueSetter?.call(composer, "expand");
				composer.dispatchEvent(new window.Event("input", { bubbles: true }));
			});
			const send = findButton(container, "Send");
			if (!send) throw new Error("One-pager chat Send button is missing");
			act(() => send.click());
			await waitFor(
				"edited summary after one-pager chat",
				() =>
					container.querySelector('[aria-label="Overview"] h1')?.textContent ===
					"Edited summary",
				2_000,
			);

			act(() => findButton(container, "MR Description")?.click());
			await waitFor("review chat returns in Description scope", async () => {
				const state = await store.read();
				if (!state) return false;
				const chatCount = container.querySelector(
					'button[aria-label="Switch chat"] [data-slot="badge"]',
				);
				return (
					state.activeChatId === "chat-a" &&
					state.chats.find((chat) => chat.id === "chat-a")?.kind === "review" &&
					chatCount?.textContent === "1" &&
					container.textContent?.includes("Review chat restored") === true
				);
			});

			const restoredState = await store.read();
			if (!restoredState) throw new Error("Review state is missing");
			const activeOnePagerChatId = restoredState.activeOnePagerChatId;
			if (!activeOnePagerChatId)
				throw new Error("Active one-pager chat was not persisted");
			const newReviewChatButton = container.querySelector<HTMLButtonElement>(
				'button[aria-label="New chat"]',
			);
			if (!newReviewChatButton)
				throw new Error("Review New chat button is missing");
			act(() => newReviewChatButton.click());
			await waitFor("new chat uses review scope", async () => {
				const state = await store.read();
				if (!state) return false;
				return (
					state.chats.filter((chat) => chat.kind === "review").length === 2 &&
					state.activeChatId !== "chat-a" &&
					state.activeOnePagerChatId === activeOnePagerChatId &&
					container.querySelector(
						'button[aria-label="Switch chat"] [data-slot="badge"]',
					)?.textContent === "2" &&
					!newReviewChatButton.disabled
				);
			});

			const switchChatButton = container.querySelector<HTMLButtonElement>(
				'button[aria-label="Switch chat"]',
			);
			if (!switchChatButton) throw new Error("Switch chat button is missing");
			act(() => switchChatButton.click());
			await waitFor("review chat selection options", () =>
				[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].some(
					(item) => item.textContent?.includes("New chat 1") === true,
				),
			);
			const previousReviewChat = [
				...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
			].find((item) => item.textContent?.includes("New chat 1") === true);
			if (!previousReviewChat)
				throw new Error("Previous review chat option is missing");
			rejectNextChatSelection = true;
			act(() => previousReviewChat.click());
			await waitFor(
				"rejected chat selection error",
				() =>
					container.textContent?.includes(
						"Select chat request failed (503)",
					) === true,
			);

			await featureFlagStore.set("one-pager", false);
			await act(async () => loadFeatureFlags(token));
			await waitFor(
				"flag-off Description overview",
				() =>
					container.querySelector('[aria-label="Overview sections"]') ===
						null && container.querySelector("#description-heading") !== null,
			);
		} finally {
			agent.releaseFailure.resolve();
			agent.releaseSuccess.resolve();
			globalThis.fetch = originalFetch;
			container.remove();
			await rm(dir, { recursive: true, force: true });
		}
	});
});

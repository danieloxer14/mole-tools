import { describe, expect, test } from "bun:test";
import { createReviewServer } from "./server";
import { type ReviewState, ReviewStateSchema } from "./state";

function state(): ReviewState {
	return ReviewStateSchema.parse({
		version: 1,
		mode: "code",
		mr: {
			host: "gitlab.example.com",
			projectPath: "group/project",
			iid: 42,
			webUrl: "https://gitlab.example.com/group/project/-/merge_requests/42",
			title: "Review server",
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
		drafts: [],
	});
}

describe("ReviewServer", () => {
	test("starts on loopback with an ephemeral port and rejects missing tokens", async () => {
		const server = createReviewServer({
			state: state(),
			token: "server-token",
		});
		const address = server.start();
		try {
			expect(address.hostname).toBe("127.0.0.1");
			expect(address.port).toBeGreaterThan(0);
			expect(address.url).toBe(
				`http://127.0.0.1:${address.port}/?t=server-token`,
			);
			const page = await fetch(`http://127.0.0.1:${address.port}/`);
			expect(page.status).toBe(200);
			expect(await page.text()).toContain("<!doctype html>");
			const unauthorized = await fetch(
				`http://127.0.0.1:${address.port}/api/state`,
			);
			expect(unauthorized.status).toBe(401);
			expect(await unauthorized.text()).toBe("");
			const authorized = await fetch(
				`http://127.0.0.1:${address.port}/api/state?t=server-token`,
			);
			expect(authorized.status).toBe(200);
			expect((await authorized.json()).mr.title).toBe("Review server");
		} finally {
			await server.stop();
		}
	});

	test("mints a distinct token for each server run", () => {
		const first = createReviewServer({ state: state() });
		const second = createReviewServer({ state: state() });
		expect(first.token).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
		expect(second.token).not.toBe(first.token);
	});

	test("stop is safe before and after start", async () => {
		const server = createReviewServer({ state: state(), token: "stop-token" });
		await server.stop();
		server.start();
		await server.stop();
		await server.stop();
	});
});

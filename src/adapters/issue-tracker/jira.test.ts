import { afterEach, describe, expect, test } from "bun:test";
import { CostTracker } from "../../core/cost-tracker";
import { PortError } from "../../core/errors";
import { JiraAdapter } from "./jira";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("JiraAdapter", () => {
	test("fetches issue summary and description with bearer auth", async () => {
		let capturedUrl = "";
		let capturedAuth = "";
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			capturedUrl = String(url);
			capturedAuth = String(
				(init?.headers as Record<string, string>)?.Authorization,
			);
			return new Response(
				JSON.stringify({
					key: "AST-1",
					fields: { summary: "Add feature", description: "Details" },
				}),
				{ status: 200 },
			);
		}) as unknown as typeof fetch;

		const adapter = new JiraAdapter({
			url: "https://jira.example.com",
			apiKey: "secret",
		});
		const issue = await adapter.fetchIssue("AST-1");

		expect(issue).toEqual({
			key: "AST-1",
			summary: "Add feature",
			description: "Details",
		});
		expect(capturedUrl).toBe("https://jira.example.com/rest/api/2/issue/AST-1");
		expect(capturedAuth).toBe("Bearer secret");
	});

	test("uses Basic auth with email when configured (Jira Cloud)", async () => {
		let capturedAuth = "";
		globalThis.fetch = (async (_url: string, init?: RequestInit) => {
			capturedAuth = String(
				(init?.headers as Record<string, string>)?.Authorization,
			);
			return new Response(
				JSON.stringify({
					key: "AST-1",
					fields: { summary: "Add feature", description: "Details" },
				}),
				{ status: 200 },
			);
		}) as unknown as typeof fetch;

		const adapter = new JiraAdapter({
			url: "https://jira.example.com",
			apiKey: "secret",
			email: "user@example.com",
		});
		await adapter.fetchIssue("AST-1");

		expect(capturedAuth).toBe(`Basic ${btoa("user@example.com:secret")}`);
	});

	test("truncates description over 500 words", async () => {
		const longDescription = Array.from({ length: 600 }, (_, i) => `w${i}`).join(
			" ",
		);
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					key: "AST-3",
					fields: { summary: "Long ticket", description: longDescription },
				}),
				{ status: 200 },
			)) as unknown as typeof fetch;

		const adapter = new JiraAdapter({
			url: "https://jira.example.com",
			apiKey: "secret",
		});
		const issue = await adapter.fetchIssue("AST-3");
		const words = issue.description.split(" ");

		expect(words.length).toBe(501);
		expect(words.at(-1)).toBe("...");
		expect(issue.description).not.toContain("w500");
	});

	test("defaults description to an empty string when absent", async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({ key: "AST-2", fields: { summary: "No description" } }),
				{
					status: 200,
				},
			)) as unknown as typeof fetch;

		const adapter = new JiraAdapter({
			url: "https://jira.example.com",
			apiKey: "secret",
		});
		const issue = await adapter.fetchIssue("AST-2");
		expect(issue.description).toBe("");
	});

	test("throws PortError on network failure", async () => {
		globalThis.fetch = (async () => {
			throw new Error("network down");
		}) as unknown as typeof fetch;

		const adapter = new JiraAdapter({
			url: "https://jira.example.com",
			apiKey: "secret",
		});
		await expect(adapter.fetchIssue("AST-1")).rejects.toThrow(PortError);
	});

	test("throws PortError on 404", async () => {
		globalThis.fetch = (async () =>
			new Response("not found", { status: 404 })) as unknown as typeof fetch;
		const adapter = new JiraAdapter({
			url: "https://jira.example.com",
			apiKey: "secret",
		});
		await expect(adapter.fetchIssue("AST-404")).rejects.toThrow(PortError);
	});

	test("throws PortError on auth failure", async () => {
		globalThis.fetch = (async () =>
			new Response("forbidden", { status: 403 })) as unknown as typeof fetch;
		const adapter = new JiraAdapter({
			url: "https://jira.example.com",
			apiKey: "bad",
		});
		await expect(adapter.fetchIssue("AST-1")).rejects.toThrow(PortError);
	});

	test("records a jira cost entry sized by the response body", async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					key: "AST-1",
					fields: { summary: "Add feature", description: "Details" },
				}),
				{ status: 200 },
			)) as unknown as typeof fetch;

		const costTracker = new CostTracker();
		const adapter = new JiraAdapter(
			{ url: "https://jira.example.com", apiKey: "secret" },
			costTracker,
		);
		await adapter.fetchIssue("AST-1");

		expect(costTracker.getEntries()).toHaveLength(1);
		expect(costTracker.getEntries()[0]).toMatchObject({
			type: "jira",
			task: "fetchIssue",
			inputTokens: 0,
		});
		expect(costTracker.getEntries()[0]?.outputTokens).toBeGreaterThan(0);
	});

	test("throws PortError on other non-ok statuses", async () => {
		globalThis.fetch = (async () =>
			new Response("boom", { status: 500 })) as unknown as typeof fetch;
		const adapter = new JiraAdapter({
			url: "https://jira.example.com",
			apiKey: "secret",
		});
		await expect(adapter.fetchIssue("AST-1")).rejects.toThrow(PortError);
	});
});

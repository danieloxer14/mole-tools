import { afterEach, describe, expect, test } from "bun:test";
import { PortError } from "../../core/errors";
import { SlackWebhookNotifier } from "./slack-webhook";

const originalFetch = globalThis.fetch;
const webhookUrlEnv = "MOLE_TOOLS_TEST_SLACK_WEBHOOK_URL";
const originalWebhookUrl = process.env[webhookUrlEnv];

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalWebhookUrl === undefined) delete process.env[webhookUrlEnv];
	else process.env[webhookUrlEnv] = originalWebhookUrl;
});

describe("SlackWebhookNotifier", () => {
	test("posts one JSON text payload to the configured webhook", async () => {
		const webhookUrl = "https://hooks.slack.test/services/test-token";
		process.env[webhookUrlEnv] = webhookUrl;
		let calls = 0;
		let requestUrl = "";
		let requestInit: RequestInit | undefined;
		globalThis.fetch = (async (input, init) => {
			calls++;
			requestUrl = String(input);
			requestInit = init;
			return new Response(null, { status: 204 });
		}) as unknown as typeof fetch;

		await new SlackWebhookNotifier({ webhookUrlEnv }).sendText(
			"line one\nline two",
		);

		expect(calls).toBe(1);
		expect(requestUrl).toBe(webhookUrl);
		expect(requestInit?.method).toBe("POST");
		expect(new Headers(requestInit?.headers).get("content-type")).toBe(
			"application/json",
		);
		expect(JSON.parse(String(requestInit?.body))).toEqual({
			text: "line one\nline two",
		});
	});

	test("resolves the webhook URL lazily and rejects a missing environment", async () => {
		delete process.env[webhookUrlEnv];
		let calls = 0;
		globalThis.fetch = (async () => {
			calls++;
			return new Response(null, { status: 204 });
		}) as unknown as typeof fetch;
		const notifier = new SlackWebhookNotifier({ webhookUrlEnv });

		await expect(notifier.sendText("payload")).rejects.toThrow(
			`Missing Slack webhook environment variable: ${webhookUrlEnv}`,
		);
		expect(calls).toBe(0);

		process.env[webhookUrlEnv] = "   ";
		await expect(notifier.sendText("payload")).rejects.toThrow(
			`Missing Slack webhook environment variable: ${webhookUrlEnv}`,
		);
		expect(calls).toBe(0);
	});

	test("reports only HTTP status for non-success responses", async () => {
		const webhookUrl = "https://hooks.slack.test/services/secret-token";
		process.env[webhookUrlEnv] = webhookUrl;
		const responseBody = `secret response for ${webhookUrl}`;
		globalThis.fetch = (async () =>
			new Response(responseBody, { status: 503 })) as unknown as typeof fetch;

		const error = await new SlackWebhookNotifier({ webhookUrlEnv })
			.sendText("payload")
			.then(
				() => null,
				(cause: unknown) => cause,
			);

		expect(error).toBeInstanceOf(PortError);
		expect(String(error)).toContain("503");
		expect(String(error)).not.toContain(webhookUrl);
		expect(String(error)).not.toContain(responseBody);
		expect((error as PortError).stderr).toBeUndefined();
	});

	test("redacts a webhook URL when fetch cannot reach Slack", async () => {
		const webhookUrl = "https://hooks.slack.test/services/network-secret";
		process.env[webhookUrlEnv] = webhookUrl;
		globalThis.fetch = (async () => {
			throw new Error(`request failed for ${webhookUrl}`);
		}) as unknown as typeof fetch;

		const error = await new SlackWebhookNotifier({ webhookUrlEnv })
			.sendText("payload")
			.then(
				() => null,
				(cause: unknown) => cause,
			);

		expect(error).toBeInstanceOf(PortError);
		expect(String(error)).toBe(
			"Error: Slack webhook request failed: unable to reach endpoint",
		);
		expect(String(error)).not.toContain(webhookUrl);
	});
});

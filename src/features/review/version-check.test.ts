import { describe, expect, test } from "bun:test";
import {
	checkForUpdate,
	LATEST_RELEASE_URL,
	VERSION_CHECK_TIMEOUT_MS,
} from "./version-check";

function releaseFetcher(tagName: string, status = 200): typeof fetch {
	return async () =>
		new Response(JSON.stringify({ tag_name: tagName }), { status });
}

describe("checkForUpdate", () => {
	test("reports a newer release using numeric version comparison", async () => {
		expect(
			await checkForUpdate({
				current: "0.9.0",
				fetcher: releaseFetcher("v0.10.0"),
			}),
		).toEqual({ current: "0.9.0", latest: "0.10.0", updateAvailable: true });
	});

	test("reports an equal release without an available update", async () => {
		expect(
			await checkForUpdate({
				current: "0.9.0",
				fetcher: releaseFetcher("v0.9.0"),
			}),
		).toEqual({ current: "0.9.0", latest: "0.9.0", updateAvailable: false });
	});

	test("reports an older release without an available update", async () => {
		expect(
			await checkForUpdate({
				current: "0.9.0",
				fetcher: releaseFetcher("v0.8.0"),
			}),
		).toEqual({ current: "0.9.0", latest: "0.8.0", updateAvailable: false });
	});

	test("requests the latest GitHub release with the expected URL and headers", async () => {
		const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
			[];
		const fetcher: typeof fetch = async (input, init) => {
			requests.push({ input, init });
			return new Response(JSON.stringify({ tag_name: "v0.10.0" }));
		};

		await checkForUpdate({ current: "0.9.0", fetcher });

		expect(requests).toHaveLength(1);
		expect(requests[0]?.input).toBe(LATEST_RELEASE_URL);
		expect(requests[0]?.init?.headers).toEqual({
			accept: "application/vnd.github+json",
			"user-agent": "mole-tools/0.9.0",
		});
	});

	for (const status of [403, 500]) {
		test(`returns no update when GitHub responds with ${status}`, async () => {
			expect(
				await checkForUpdate({
					current: "0.9.0",
					fetcher: releaseFetcher("v0.10.0", status),
				}),
			).toEqual({ current: "0.9.0", latest: null, updateAvailable: false });
		});
	}

	test("returns no update when the response body is invalid JSON", async () => {
		const fetcher: typeof fetch = async () => new Response("not json");

		expect(await checkForUpdate({ current: "0.9.0", fetcher })).toEqual({
			current: "0.9.0",
			latest: null,
			updateAvailable: false,
		});
	});

	test("returns no update when the response has no tag_name", async () => {
		const fetcher: typeof fetch = async () => new Response(JSON.stringify({}));

		expect(await checkForUpdate({ current: "0.9.0", fetcher })).toEqual({
			current: "0.9.0",
			latest: null,
			updateAvailable: false,
		});
	});

	test("returns no update when the release tag is malformed", async () => {
		expect(
			await checkForUpdate({
				current: "0.9.0",
				fetcher: releaseFetcher("v1.0.0-rc1"),
			}),
		).toEqual({ current: "0.9.0", latest: null, updateAvailable: false });
	});

	test("returns no update when the fetcher throws synchronously", async () => {
		const fetcher: typeof fetch = () => {
			throw new Error("offline");
		};

		expect(await checkForUpdate({ current: "0.9.0", fetcher })).toEqual({
			current: "0.9.0",
			latest: null,
			updateAvailable: false,
		});
	});

	test("returns no update when the fetcher rejects", async () => {
		const fetcher: typeof fetch = async () => {
			throw new Error("offline");
		};

		expect(await checkForUpdate({ current: "0.9.0", fetcher })).toEqual({
			current: "0.9.0",
			latest: null,
			updateAvailable: false,
		});
	});

	test("returns no update when the request times out", async () => {
		const fetcher: typeof fetch = (_input, init) =>
			new Promise<Response>((_resolve, reject) => {
				const signal = init?.signal;
				if (!signal || signal.aborted) {
					reject(signal?.reason ?? new Error("missing abort signal"));
					return;
				}

				signal.addEventListener("abort", () => reject(signal.reason), {
					once: true,
				});
			});

		expect(VERSION_CHECK_TIMEOUT_MS).toBe(5000);
		expect(
			await checkForUpdate({ current: "0.9.0", fetcher, timeoutMs: 10 }),
		).toEqual({ current: "0.9.0", latest: null, updateAvailable: false });
	});
});

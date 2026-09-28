import { describe, expect, test } from "bun:test";
import {
	checkForUpdate,
	RELEASE_CATALOG_URL,
	VERSION_CHECK_TIMEOUT_MS,
} from "./version-check";

const CATALOG = [
	{
		version: "0.10.0",
		description: "Newest release.",
		features: [],
		improvements: [],
		fixes: [],
	},
	{
		version: "0.9.0",
		description: "Earlier release.",
		features: [],
		improvements: [],
		fixes: [],
	},
	{
		version: "0.8.0",
		description: "Old release.",
		features: [],
		improvements: [],
		fixes: [],
	},
];

function catalogFetcher(body: unknown = CATALOG, status = 200): typeof fetch {
	return async () => new Response(JSON.stringify(body), { status });
}

function failClosed(current: string) {
	return { current, latest: null, updateAvailable: false, releases: [] };
}

describe("checkForUpdate", () => {
	test("requests raw main catalog once with existing timeout and user-agent", async () => {
		const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
			[];
		const fetcher: typeof fetch = async (input, init) => {
			requests.push({ input, init });
			return new Response(JSON.stringify(CATALOG));
		};

		await checkForUpdate({ current: "0.9.0", fetcher });

		expect(requests).toHaveLength(1);
		expect(requests[0]?.input).toBe(RELEASE_CATALOG_URL);
		expect(requests[0]?.init?.headers).toEqual({
			"user-agent": "mole-tools/0.9.0",
		});
		expect(requests[0]?.init?.signal).toBeInstanceOf(AbortSignal);
		expect(VERSION_CHECK_TIMEOUT_MS).toBe(5000);
	});

	test("returns all releases newer than current in catalog order", async () => {
		expect(
			await checkForUpdate({ current: "0.8.0", fetcher: catalogFetcher() }),
		).toEqual({
			current: "0.8.0",
			latest: "0.10.0",
			updateAvailable: true,
			releases: CATALOG.slice(0, 2),
		});
	});

	test("returns an empty notes list for current equal to latest or newer", async () => {
		for (const current of ["0.10.0", "0.11.0"]) {
			expect(
				await checkForUpdate({ current, fetcher: catalogFetcher() }),
			).toEqual({
				current,
				latest: "0.10.0",
				updateAvailable: false,
				releases: [],
			});
		}
	});

	test("returns all releases when installed version predates the catalog", async () => {
		expect(
			await checkForUpdate({ current: "0.7.9", fetcher: catalogFetcher() }),
		).toMatchObject({
			latest: "0.10.0",
			updateAvailable: true,
			releases: CATALOG,
		});
	});

	for (const status of [403, 500]) {
		test(`fails closed on HTTP ${status}`, async () => {
			expect(
				await checkForUpdate({
					current: "0.9.0",
					fetcher: catalogFetcher(CATALOG, status),
				}),
			).toEqual(failClosed("0.9.0"));
		});
	}

	test("fails closed on invalid JSON", async () => {
		const fetcher: typeof fetch = async () => new Response("not json");
		expect(await checkForUpdate({ current: "0.9.0", fetcher })).toEqual(
			failClosed("0.9.0"),
		);
	});

	for (const [name, invalidCatalog] of [
		["non-array schema", {}],
		["duplicate versions", [CATALOG[0], CATALOG[0]]],
		["unordered versions", [CATALOG[1], CATALOG[0]]],
		["malformed version", [{ ...CATALOG[0], version: "v0.10.0" }]],
		["malformed string", [{ ...CATALOG[0], description: "<b>bad</b>" }]],
	] as const) {
		test(`fails closed on ${name}`, async () => {
			expect(
				await checkForUpdate({
					current: "0.9.0",
					fetcher: catalogFetcher(invalidCatalog),
				}),
			).toEqual(failClosed("0.9.0"));
		});
	}

	test("fails closed when installed version is malformed without requesting", async () => {
		let requested = false;
		const fetcher: typeof fetch = async () => {
			requested = true;
			return new Response(JSON.stringify(CATALOG));
		};
		expect(await checkForUpdate({ current: "malformed", fetcher })).toEqual(
			failClosed("malformed"),
		);
		expect(requested).toBe(false);
	});

	test("fails closed when fetch throws or rejects", async () => {
		for (const fetcher of [
			(() => {
				throw new Error("offline");
			}) as typeof fetch,
			(async () => {
				throw new Error("offline");
			}) as typeof fetch,
		]) {
			expect(await checkForUpdate({ current: "0.9.0", fetcher })).toEqual(
				failClosed("0.9.0"),
			);
		}
	});

	test("fails closed when request times out", async () => {
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

		expect(
			await checkForUpdate({ current: "0.9.0", fetcher, timeoutMs: 10 }),
		).toEqual(failClosed("0.9.0"));
	});
});

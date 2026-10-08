import { describe, expect, test } from "bun:test";
import { parseReleaseCatalog } from "./release-notes";

const VALID_RELEASE = {
	version: "1.2.0",
	description: "Adds a useful capability.",
	features: ["Adds a useful capability."],
	improvements: [],
	fixes: [],
};

function release(overrides: Record<string, unknown> = {}) {
	return { ...VALID_RELEASE, ...overrides };
}

describe("parseReleaseCatalog", () => {
	test("accepts strict plain-text entries and empty categories", () => {
		expect(parseReleaseCatalog([VALID_RELEASE])).toEqual([VALID_RELEASE]);
	});

	test("rejects empty catalogs and entries with unknown or missing fields", () => {
		expect(() => parseReleaseCatalog([])).toThrow();
		expect(() => parseReleaseCatalog([release({ extra: true })])).toThrow();
		const { fixes: _fixes, ...missingField } = VALID_RELEASE;
		expect(() => parseReleaseCatalog([missingField])).toThrow();
	});

	test("rejects versions that are not strict numeric triples", () => {
		for (const version of ["v1.2.0", "1.2", "1.2.0-rc.1", "1.2.0+build"]) {
			expect(() => parseReleaseCatalog([release({ version })])).toThrow();
		}
	});

	test("rejects duplicate or non-descending versions", () => {
		expect(() =>
			parseReleaseCatalog([VALID_RELEASE, release({ version: "1.2.0" })]),
		).toThrow();
		expect(() =>
			parseReleaseCatalog([
				release({ version: "1.1.0" }),
				release({ version: "1.2.0" }),
			]),
		).toThrow();
	});

	test("rejects empty, non-trimmed, and markup strings", () => {
		for (const description of [
			"",
			" padded ",
			"<b>bold</b>",
			"[link](https://example.com)",
			"*emphasis*",
			"_emphasis_",
		]) {
			expect(() => parseReleaseCatalog([release({ description })])).toThrow();
		}
		for (const features of [
			[""],
			[" trailing "],
			["**bold** text"],
			["*emphasis*"],
			["_emphasis_"],
		]) {
			expect(() => parseReleaseCatalog([release({ features })])).toThrow();
		}
	});

	test("parses root catalog and matches the package version", async () => {
		const [rawCatalog, packageJson] = await Promise.all([
			Bun.file(new URL("../../../releases.json", import.meta.url)).json(),
			Bun.file(new URL("../../../package.json", import.meta.url)).json(),
		]);
		const catalog = parseReleaseCatalog(rawCatalog);
		expect(catalog[0]?.version).toBe(packageJson.version);
	});
});

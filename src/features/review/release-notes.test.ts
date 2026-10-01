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

	test("parses root catalog with exact release sequence and strict schema", async () => {
		const catalog = parseReleaseCatalog(
			JSON.parse(
				await Bun.file(
					new URL("../../../releases.json", import.meta.url),
				).text(),
			),
		);
		expect(catalog.map(({ version }) => version)).toEqual([
			"0.12.0",
			"0.11.0",
			"0.10.1",
			"0.10.0",
			"0.9.0",
			"0.8.1",
			"0.8.0",
			"0.7.0",
			"0.6.1",
			"0.6.0",
			"0.5.0",
			"0.4.1",
			"0.4.0",
			"0.3.1",
			"0.3.0",
			"0.2.0",
		]);
	});
});

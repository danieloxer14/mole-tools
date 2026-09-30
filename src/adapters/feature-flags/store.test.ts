import { describe, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FeatureFlagStore, featureFlagsPath } from "./store";

const DEFAULTS = { "layer-importance": false } as const;

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "feature-flags-test-"));
	try {
		await run(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

describe("FeatureFlagStore", () => {
	test("uses defaults without creating a missing file", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "missing", "features.json");
			const store = new FeatureFlagStore(path);
			expect(await store.read()).toEqual(DEFAULTS);
			await expect(readFile(path, "utf8")).rejects.toMatchObject({
				code: "ENOENT",
			});
		});
	});

	test("invalid JSON returns defaults and leaves file bytes unchanged", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "features.json");
			const bytes = "{not json";
			await writeFile(path, bytes);
			expect(await new FeatureFlagStore(path).read()).toEqual(DEFAULTS);
			expect(await readFile(path, "utf8")).toBe(bytes);
		});
	});

	test.each([
		"[]",
		"null",
		"false",
		"42",
		'"text"',
	])("returns defaults for non-object JSON %s", async (content) => {
		await withTempDir(async (dir) => {
			const path = join(dir, "features.json");
			await writeFile(path, content);
			expect(await new FeatureFlagStore(path).read()).toEqual(DEFAULTS);
			expect(await readFile(path, "utf8")).toBe(content);
		});
	});

	test("defaults only non-boolean known values", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "features.json");
			await writeFile(path, JSON.stringify({ "layer-importance": "yes" }));
			expect(await new FeatureFlagStore(path).read()).toEqual(DEFAULTS);
		});
	});

	test("preserves unknown keys when updating known flag", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "features.json");
			await writeFile(path, JSON.stringify({ future: { enabled: true } }));
			await new FeatureFlagStore(path).set("layer-importance", true);
			expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
				future: { enabled: true },
				"layer-importance": true,
			});
		});
	});

	test("creates missing directories and writes tab-indented JSON with newline", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "missing", "features.json");
			expect(
				await new FeatureFlagStore(path).set("layer-importance", true),
			).toEqual({
				"layer-importance": true,
			});
			expect(await readFile(path, "utf8")).toBe(
				'{\n\t"layer-importance": true\n}\n',
			);
		});
	});

	test("repairs invalid JSON on write", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "features.json");
			await writeFile(path, "broken");
			await new FeatureFlagStore(path).set("layer-importance", true);
			expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
				"layer-importance": true,
			});
		});
	});

	test("rejects a failed rename without changing the destination or leaving a temp file", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "features.json");
			await mkdir(path);
			await writeFile(join(path, "sentinel"), "keep unchanged");
			const store = new FeatureFlagStore(path);

			await expect(store.set("layer-importance", true)).rejects.toBeDefined();

			expect(await readFile(join(path, "sentinel"), "utf8")).toBe(
				"keep unchanged",
			);
			expect(
				(await readdir(dir)).filter((entry) => entry.endsWith(".tmp")),
			).toEqual([]);
		});
	});

	test("serializes concurrent writes and leaves no temporary files", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "features.json");
			const store = new FeatureFlagStore(path);
			const [first, second] = await Promise.all([
				store.set("layer-importance", true),
				store.set("layer-importance", false),
			]);
			expect(first["layer-importance"]).toBe(true);
			expect(second["layer-importance"]).toBe(false);
			expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
				"layer-importance": false,
			});
			expect(
				(await readdir(dir)).filter((entry) => entry.endsWith(".tmp")),
			).toEqual([]);
		});
	});

	test("derives feature file beside config file", () => {
		expect(featureFlagsPath("/home/user/.config/mole-tools/config.json")).toBe(
			"/home/user/.config/mole-tools/features.json",
		);
	});
});

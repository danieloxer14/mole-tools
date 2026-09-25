import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillStore, SkillStoreError, skillsDir } from "./store";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "skills-"));
	roots.push(root);
	return root;
}

async function writeFiles(
	root: string,
	name: string,
	files: Record<string, string>,
): Promise<void> {
	const directory = join(root, name);
	await mkdir(directory, { recursive: true });
	await Promise.all(
		Object.entries(files).map(([file, content]) =>
			Bun.write(join(directory, file), content),
		),
	);
}

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("SkillStore", () => {
	test("creates an empty active v1 and derives skills directory from config path", async () => {
		const root = await makeRoot();
		const store = new SkillStore(root);

		const summary = await store.create("review-it");

		expect(summary).toEqual({
			name: "review-it",
			activeVersion: 1,
			versions: [1],
			lastUsedAt: null,
		});
		expect(await readFile(join(root, "review-it", "001.md"), "utf8")).toBe("");
		expect(await readFile(join(root, "review-it", "skill.json"), "utf8")).toBe(
			'{\n\t"activeVersion": 1,\n\t"lastUsedAt": null\n}\n',
		);
		expect(skillsDir(join(root, "config.json"))).toBe(join(root, "skills"));
	});

	test("rejects invalid names and case-insensitive duplicates, and validates reads before path joining", async () => {
		const store = new SkillStore(await makeRoot());
		await store.create("Review-It");

		await expect(store.create("review-it")).rejects.toMatchObject({
			name: "SkillStoreError",
			code: "conflict",
		});
		await expect(store.create("bad name")).rejects.toMatchObject({
			name: "SkillStoreError",
			code: "invalid",
		});
		await expect(store.read("../x")).rejects.toMatchObject({
			name: "SkillStoreError",
			message: "Invalid skill name",
			code: "invalid",
		});
		for (const operation of [
			() => store.saveActive("../x", "text"),
			() => store.createVersion("../x", "text"),
			() => store.activate("../x", 1),
			() => store.delete("../x"),
		]) {
			await expect(operation()).rejects.toMatchObject({
				name: "SkillStoreError",
				message: "Invalid skill name",
				code: "invalid",
			});
		}

		await expect(store.create("review-it")).rejects.toBeInstanceOf(
			SkillStoreError,
		);
	});

	test("replaces an existing directory that has no version files", async () => {
		const root = await makeRoot();
		await writeFiles(root, "review-it", {
			"skill.json": '{"activeVersion":9,"lastUsedAt":"old"}',
			"notes.txt": "partial create",
		});
		const store = new SkillStore(root);

		await expect(store.create("review-it")).resolves.toMatchObject({
			activeVersion: 1,
			versions: [1],
			lastUsedAt: null,
		});
		expect(await readFile(join(root, "review-it", "001.md"), "utf8")).toBe("");
		expect(await Bun.file(join(root, "review-it", "notes.txt")).exists()).toBe(
			false,
		);
	});

	test("lists no skills for a missing root and sorts valid skill directories", async () => {
		const parent = await makeRoot();
		const store = new SkillStore(join(parent, "missing"));
		expect(await store.list()).toEqual([]);

		await writeFiles(parent, "Beta", { "001.md": "b" });
		await writeFiles(parent, "alpha", { "001.md": "a" });
		await writeFiles(parent, "charlie", { "001.md": "c" });
		await writeFiles(parent, "bad", { "001.md": "invalid name" });
		await writeFiles(parent, "empty", { "skill.json": "{}" });

		expect(
			(await new SkillStore(parent).list()).map((skill) => skill.name),
		).toEqual(["alpha", "Beta", "charlie"]);
	});

	test("falls back to highest version for unparseable or invalid metadata", async () => {
		const root = await makeRoot();
		await writeFiles(root, "garbage", {
			"001.md": "old",
			"004.md": "new",
			"skill.json": "not JSON",
		});
		await writeFiles(root, "wrong-shape", {
			"002.md": "only",
			"skill.json": '{"activeVersion":2,"lastUsedAt":42}',
		});

		const skills = await new SkillStore(root).list();
		expect(skills).toEqual([
			{
				name: "garbage",
				activeVersion: 4,
				versions: [1, 4],
				lastUsedAt: null,
			},
			{
				name: "wrong-shape",
				activeVersion: 2,
				versions: [2],
				lastUsedAt: null,
			},
		]);
	});

	test("keeps hand-added versions inactive and creates after the maximum version", async () => {
		const root = await makeRoot();
		const store = new SkillStore(root);
		await store.create("review-it");
		await Bun.write(join(root, "review-it", "009.md"), "orphan");

		expect(await store.read("review-it")).toMatchObject({
			version: 1,
			versions: [1, 9],
		});
		expect(await store.createVersion("review-it", "v10")).toBe(10);
		expect(await store.read("review-it")).toMatchObject({
			version: 10,
			text: "v10",
			activeVersion: 10,
			versions: [1, 9, 10],
		});
	});
	test("discovers only canonical positive safe version filenames", async () => {
		const root = await makeRoot();
		await writeFiles(root, "one-only", { "1.md": "numeric alias" });
		await writeFiles(root, "zero-only", { "000.md": "zero version" });
		await writeFiles(root, "unsafe-only", {
			"9007199254740992.md": "unsafe version",
		});
		await writeFiles(root, "aliases", {
			"001.md": "canonical one",
			"1.md": "numeric alias",
			"000.md": "zero version",
			"002.md": "canonical two",
		});
		await writeFiles(root, "normal", {
			"001.md": "version one",
			"002.md": "version two",
			"1000.md": "version one thousand",
		});
		const store = new SkillStore(root);

		expect(await store.list()).toEqual([
			{
				name: "aliases",
				activeVersion: 2,
				versions: [1, 2],
				lastUsedAt: null,
			},
			{
				name: "normal",
				activeVersion: 1000,
				versions: [1, 2, 1000],
				lastUsedAt: null,
			},
		]);
		expect(await store.read("aliases", 1)).toMatchObject({
			text: "canonical one",
			versions: [1, 2],
		});
		expect(await store.read("aliases")).toMatchObject({
			version: 2,
			text: "canonical two",
		});
		expect(await store.read("normal", 1000)).toMatchObject({
			version: 1000,
			text: "version one thousand",
		});
		for (const name of ["one-only", "zero-only", "unsafe-only"]) {
			await expect(store.read(name)).rejects.toMatchObject({
				name: "SkillStoreError",
				code: "not_found",
			});
		}
		expect(
			await store.expansions(["aliases", "one-only", "zero-only"]),
		).toEqual(new Map([["aliases", { version: 2, text: "canonical two" }]]));
		expect(await store.expansions()).toEqual(
			new Map([
				["aliases", { version: 2, text: "canonical two" }],
				["normal", { version: 1000, text: "version one thousand" }],
			]),
		);
	});
	test("does not create a version beyond the safe integer range", async () => {
		const root = await makeRoot();
		await writeFiles(root, "max-safe", {
			"9007199254740991.md": "last safe version",
		});
		const store = new SkillStore(root);

		await expect(
			store.createVersion("max-safe", "overflow"),
		).rejects.toMatchObject({
			name: "SkillStoreError",
			code: "invalid",
		});
		expect(await readdir(join(root, "max-safe"))).toEqual([
			"9007199254740991.md",
		]);
	});

	test("saves active text in place and reads active or explicitly selected version", async () => {
		const store = new SkillStore(await makeRoot());
		await store.create("review-it");
		await store.createVersion("review-it", "version two");
		expect(await store.saveActive("review-it", "updated two")).toBe(2);
		expect(await store.list()).toMatchObject([
			{ versions: [1, 2], activeVersion: 2 },
		]);
		expect((await store.read("review-it")).text).toBe("updated two");
		expect(await store.read("review-it", 1)).toMatchObject({
			version: 1,
			text: "",
		});
		await expect(store.activate("review-it", 3)).rejects.toMatchObject({
			name: "SkillStoreError",
			code: "not_found",
		});
	});

	test("deletes all skill files and reports unknown skills", async () => {
		const root = await makeRoot();
		const store = new SkillStore(root);
		await store.create("review-it");
		await store.createVersion("review-it", "second");
		await store.delete("review-it");

		expect(await readdir(root)).toEqual([]);
		await expect(store.delete("review-it")).rejects.toMatchObject({
			name: "SkillStoreError",
			code: "not_found",
		});
	});

	test("expansions contain active version text only", async () => {
		const store = new SkillStore(await makeRoot());
		await store.create("review-it");
		await store.saveActive("review-it", "active text");
		await store.createVersion("review-it", "new active text");

		expect(await store.expansions()).toEqual(
			new Map([["review-it", { version: 2, text: "new active text" }]]),
		);
	});

	test("touch updates use time without changing active version and ignores unknown names", async () => {
		const root = await makeRoot();
		const store = new SkillStore(root);
		await store.create("review-it");
		await store.createVersion("review-it", "second");
		await store.activate("review-it", 1);
		const timestamp = new Date("2026-01-02T03:04:05.000Z");

		await store.touch(["review-it", "unknown", "bad name"], timestamp);

		expect(await store.read("review-it")).toMatchObject({
			activeVersion: 1,
			versions: [1, 2],
		});
		expect(
			await readFile(join(root, "review-it", "skill.json"), "utf8"),
		).toContain('"lastUsedAt": "2026-01-02T03:04:05.000Z"');
		expect(await readdir(root)).toEqual(["review-it"]);
	});

	test("serializes concurrent touch and activation without losing either update", async () => {
		const root = await makeRoot();
		const store = new SkillStore(root);
		await store.create("review-it");
		await store.createVersion("review-it", "second");
		const timestamp = new Date("2026-02-03T04:05:06.000Z");

		await Promise.all([
			store.touch(["review-it"], timestamp),
			store.activate("review-it", 1),
		]);

		expect(await store.read("review-it")).toMatchObject({ activeVersion: 1 });
		expect(
			await readFile(join(root, "review-it", "skill.json"), "utf8"),
		).toContain('"lastUsedAt": "2026-02-03T04:05:06.000Z"');
	});
});

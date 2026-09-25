import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	SKILL_NAME_PATTERN,
	type SkillDetail,
	type SkillSummary,
	skillNameError,
} from "../../shared/skills";
import { defaultConfigPath } from "../config/loader";

export function skillsDir(configPath: string = defaultConfigPath()): string {
	return join(dirname(configPath), "skills");
}

export type SkillStoreErrorCode = "invalid" | "conflict" | "not_found";

export class SkillStoreError extends Error {
	constructor(
		message: string,
		readonly code: SkillStoreErrorCode,
	) {
		super(message);
		this.name = "SkillStoreError";
	}
}

interface SkillMetadata {
	activeVersion: number;
	lastUsedAt: string | null;
}

interface StoredSkill extends SkillMetadata {
	versions: number[];
}

function versionFile(version: number): string {
	return `${String(version).padStart(3, "0")}.md`;
}

function isMetadata(value: unknown): value is SkillMetadata {
	if (typeof value !== "object" || value === null) return false;
	const metadata = value as Record<string, unknown>;
	return (
		typeof metadata.activeVersion === "number" &&
		Number.isSafeInteger(metadata.activeVersion) &&
		metadata.activeVersion > 0 &&
		(metadata.lastUsedAt === null || typeof metadata.lastUsedAt === "string")
	);
}

function isMissing(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error.code === "ENOENT" || error.code === "ENOTDIR")
	);
}

async function writeAtomic(path: string, content: string): Promise<void> {
	const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await Bun.write(tempPath, content);
		await rename(tempPath, path);
	} finally {
		if (await Bun.file(tempPath).exists()) await unlink(tempPath);
	}
}

function compareSkillNames(a: SkillSummary, b: SkillSummary): number {
	const aName = a.name.toLowerCase();
	const bName = b.name.toLowerCase();
	return aName < bName ? -1 : aName > bName ? 1 : 0;
}

export class SkillStore {
	private queue: Promise<void> = Promise.resolve();

	constructor(private readonly dir: string) {}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.queue.then(operation);
		this.queue = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	private assertName(name: string): void {
		if (!SKILL_NAME_PATTERN.test(name)) {
			throw new SkillStoreError("Invalid skill name", "invalid");
		}
	}

	private async readSkill(name: string): Promise<StoredSkill | null> {
		const entries = await readdir(join(this.dir, name), {
			withFileTypes: true,
		}).catch((error) => {
			if (isMissing(error)) return null;
			throw error;
		});
		if (entries === null) return null;

		const versions = entries
			.flatMap((entry) => {
				if (!entry.isFile()) return [];
				const match = /^(\d+)\.md$/.exec(entry.name);
				if (!match) return [];
				const version = Number(match[1]);
				return Number.isSafeInteger(version) &&
					version > 0 &&
					versionFile(version) === entry.name
					? [version]
					: [];
			})
			.sort((a, b) => a - b);
		if (versions.length === 0) return null;

		const highestVersion = versions[versions.length - 1];
		let metadata: unknown;
		try {
			metadata = JSON.parse(
				await readFile(join(this.dir, name, "skill.json"), "utf8"),
			);
		} catch (error) {
			if (!isMissing(error) && !(error instanceof SyntaxError)) throw error;
			return { versions, activeVersion: highestVersion, lastUsedAt: null };
		}

		if (!isMetadata(metadata)) {
			return { versions, activeVersion: highestVersion, lastUsedAt: null };
		}

		return {
			versions,
			activeVersion: versions.includes(metadata.activeVersion)
				? metadata.activeVersion
				: highestVersion,
			lastUsedAt: metadata.lastUsedAt,
		};
	}

	private async writeMetadata(
		name: string,
		metadata: SkillMetadata,
	): Promise<void> {
		await writeAtomic(
			join(this.dir, name, "skill.json"),
			`${JSON.stringify(metadata, null, "\t")}\n`,
		);
	}

	async list(): Promise<SkillSummary[]> {
		const entries = await readdir(this.dir, { withFileTypes: true }).catch(
			(error) => {
				if (isMissing(error)) return [];
				throw error;
			},
		);

		const names = entries
			.filter(
				(entry) => entry.isDirectory() && SKILL_NAME_PATTERN.test(entry.name),
			)
			.map((entry) => entry.name);
		const skills = await Promise.all(
			names.map(async (name): Promise<SkillSummary | null> => {
				const stored = await this.readSkill(name);
				return stored
					? {
							name,
							activeVersion: stored.activeVersion,
							versions: stored.versions,
							lastUsedAt: stored.lastUsedAt,
						}
					: null;
			}),
		);
		return skills
			.filter((skill): skill is SkillSummary => skill !== null)
			.sort(compareSkillNames);
	}

	create(name: string): Promise<SkillSummary> {
		return this.enqueue(async () => {
			const nameError = skillNameError(
				name,
				(await this.list()).map((skill) => skill.name),
			);
			if (nameError) {
				throw new SkillStoreError(
					nameError,
					nameError === "A skill with this name already exists"
						? "conflict"
						: "invalid",
				);
			}

			const entries = await readdir(this.dir, { withFileTypes: true }).catch(
				(error) => {
					if (isMissing(error)) return [];
					throw error;
				},
			);
			const staleDirectory = entries.find(
				(entry) =>
					entry.isDirectory() &&
					entry.name.toLowerCase() === name.toLowerCase(),
			);
			if (staleDirectory) {
				const stored = await this.readSkill(staleDirectory.name);
				if (stored) {
					throw new SkillStoreError(
						"A skill with this name already exists",
						"conflict",
					);
				}
				await rm(join(this.dir, staleDirectory.name), { recursive: true });
			}

			const skillPath = join(this.dir, name);
			await mkdir(skillPath, { recursive: true });
			await writeAtomic(join(skillPath, versionFile(1)), "");
			await this.writeMetadata(name, { activeVersion: 1, lastUsedAt: null });
			return {
				name,
				activeVersion: 1,
				versions: [1],
				lastUsedAt: null,
			};
		});
	}

	async read(name: string, version?: number): Promise<SkillDetail> {
		this.assertName(name);
		const skill = await this.readSkill(name);
		if (!skill) throw new SkillStoreError("Skill not found", "not_found");
		const selectedVersion = version ?? skill.activeVersion;
		if (!skill.versions.includes(selectedVersion)) {
			throw new SkillStoreError("Skill version not found", "not_found");
		}
		const text = await readFile(
			join(this.dir, name, versionFile(selectedVersion)),
			"utf8",
		);
		return {
			name,
			version: selectedVersion,
			text,
			activeVersion: skill.activeVersion,
			versions: skill.versions,
		};
	}

	saveActive(name: string, text: string): Promise<number> {
		return this.enqueue(async () => {
			this.assertName(name);
			const skill = await this.readSkill(name);
			if (!skill) throw new SkillStoreError("Skill not found", "not_found");
			await writeAtomic(
				join(this.dir, name, versionFile(skill.activeVersion)),
				text,
			);
			return skill.activeVersion;
		});
	}

	createVersion(name: string, text: string): Promise<number> {
		return this.enqueue(async () => {
			this.assertName(name);
			const skill = await this.readSkill(name);
			if (!skill) throw new SkillStoreError("Skill not found", "not_found");
			const version = skill.versions[skill.versions.length - 1] + 1;
			if (!Number.isSafeInteger(version)) {
				throw new SkillStoreError("Skill version limit reached", "invalid");
			}
			await writeAtomic(join(this.dir, name, versionFile(version)), text);
			await this.writeMetadata(name, {
				activeVersion: version,
				lastUsedAt: skill.lastUsedAt,
			});
			return version;
		});
	}

	activate(name: string, version: number): Promise<number> {
		return this.enqueue(async () => {
			this.assertName(name);
			const skill = await this.readSkill(name);
			if (!skill) throw new SkillStoreError("Skill not found", "not_found");
			if (!skill.versions.includes(version)) {
				throw new SkillStoreError("Skill version not found", "not_found");
			}
			await this.writeMetadata(name, {
				activeVersion: version,
				lastUsedAt: skill.lastUsedAt,
			});
			return version;
		});
	}

	delete(name: string): Promise<void> {
		return this.enqueue(async () => {
			this.assertName(name);
			const skill = await this.readSkill(name);
			if (!skill) throw new SkillStoreError("Skill not found", "not_found");
			await rm(join(this.dir, name), { recursive: true });
		});
	}

	async expansions(
		names?: readonly string[],
	): Promise<Map<string, { version: number; text: string }>> {
		const requestedNames =
			names === undefined
				? (await this.list()).map((skill) => skill.name)
				: [...new Set(names)].filter((name) => SKILL_NAME_PATTERN.test(name));
		const expanded = await Promise.all(
			requestedNames.map(async (name) => {
				try {
					const detail = await this.read(name);
					return [
						name,
						{ version: detail.version, text: detail.text },
					] as const;
				} catch (error) {
					if (error instanceof SkillStoreError && error.code === "not_found")
						return undefined;
					throw error;
				}
			}),
		);
		return new Map(
			expanded.filter(
				(
					entry,
				): entry is readonly [string, { version: number; text: string }] =>
					entry !== undefined,
			),
		);
	}

	touch(names: readonly string[], at = new Date()): Promise<void> {
		return this.enqueue(async () => {
			const lastUsedAt = at.toISOString();
			for (const name of names) {
				if (!SKILL_NAME_PATTERN.test(name)) continue;
				const skill = await this.readSkill(name);
				if (!skill) continue;
				await this.writeMetadata(name, {
					activeVersion: skill.activeVersion,
					lastUsedAt,
				});
			}
		});
	}
}

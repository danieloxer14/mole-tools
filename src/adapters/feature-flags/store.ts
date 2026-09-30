import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { logger } from "../../core/logger";
import {
	defaultFeatureFlagValues,
	FEATURE_FLAGS,
	type FeatureFlagId,
	FeatureFlagIdSchema,
	type FeatureFlagValues,
} from "../../shared/feature-flags";
import { defaultConfigPath } from "../config/loader";

export function featureFlagsPath(
	configPath: string = defaultConfigPath(),
): string {
	return join(dirname(configPath), "features.json");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function isMissing(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error.code === "ENOENT" || error.code === "ENOTDIR")
	);
}

export class FeatureFlagStore {
	private writing: Promise<unknown> = Promise.resolve();

	constructor(readonly path: string) {}

	private async readRaw(): Promise<Record<string, unknown> | null> {
		const file = Bun.file(this.path);
		if (!(await file.exists())) return null;
		try {
			const raw = await file.text();
			const parsed: unknown = JSON.parse(raw);
			if (isPlainObject(parsed)) return parsed;
			logger.warn("review.feature-flags.invalid", {
				path: this.path,
				error: "Expected a plain object",
			});
			return null;
		} catch (error) {
			if (isMissing(error)) return null;
			logger.warn("review.feature-flags.invalid", { path: this.path, error });
			return null;
		}
	}

	async read(): Promise<FeatureFlagValues> {
		const raw = await this.readRaw();
		const values = defaultFeatureFlagValues();
		if (!raw) return values;
		for (const { id, defaultEnabled } of FEATURE_FLAGS) {
			const value = raw[id];
			values[id] = typeof value === "boolean" ? value : defaultEnabled;
		}
		return values;
	}

	async set(id: FeatureFlagId, enabled: boolean): Promise<FeatureFlagValues> {
		const validId = FeatureFlagIdSchema.parse(id);
		const operation = this.writing.then(async () => {
			const object = (await this.readRaw()) ?? {};
			object[validId] = enabled;
			await mkdir(dirname(this.path), { recursive: true });
			const tempPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
			try {
				await Bun.write(tempPath, `${JSON.stringify(object, null, "\t")}\n`);
				await rename(tempPath, this.path);
			} finally {
				if (await Bun.file(tempPath).exists()) await unlink(tempPath);
			}
			return this.read();
		});
		this.writing = operation.catch(() => undefined);
		return operation;
	}
}

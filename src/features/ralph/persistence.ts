import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { join } from "node:path";

import {
	RalphStateFileSchema,
	parseRalphStateFile,
	parseRalphLockFile,
	RalphError,
	type RalphStateFile,
} from "./schema";

// ─── internals ──────────────────────────────────────────────────────────

/** Base directory for `.ralph/` — normally determined by cwd, overridable for testing */
let _ralphDir: string | null = null;

/** Testing-only override */
export function setRalphDirForTesting(path: string): void {
	_ralphDir = path;
}

export function resetRalphDirForTesting(): void {
	_ralphDir = null;
}

// ─── Lock liveness check ────────────────────────────────────────────────

/**
 * Check if the PID stored in a lock is still alive.
 * On POSIX: `process.kill(pid, 0)` throws when PID is dead.
 */
function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0); // sends signal 0 — checks existence without interrupting
		return true;
	} catch {
		return false;
	}
}

/**
 * Whether a lock entry is stale. A live PID owns the lock regardless of
 * age; long-running Ralph sessions must not be stolen after an arbitrary
 * timeout. Malformed/dead-PID locks are reclaimable.
 */
function isLockStale(
	lockPid: number,
	_lockedAt?: number,
	_createdAt?: string,
): boolean {
	return !isPidAlive(lockPid);
}

// ─── Atomic write helper ────────────────────────────────────────────────

/**
 * Atomically write content to a target file using a temp file + rename.
 * Temp file is created in the same directory as the target to guarantee
 * same-filesystem rename.
 */
async function atomicWrite(targetPath: string, content: string): Promise<void> {
	const dir = join(targetPath, "..");
	// Ensure the target directory exists
	await fsPromises.mkdir(dir, { recursive: true });

	// Create temp in the same directory as target — guarantees same-filesystem rename
	const tmpName = `${targetPath.split("/").pop()}.tmp.${process.pid}.${Date.now()}`;
	const tmpPath = join(dir, tmpName);

	let writeErr: unknown;

	try {
		await fsPromises.writeFile(tmpPath, content, "utf-8");
		await fsPromises.rename(tmpPath, targetPath);
	} catch (err) {
		writeErr = err;
		// Clean up temp on failure
		try {
			await fsPromises.unlink(tmpPath);
		} catch {
			// Temp might already be gone — ignore
		}
	}

	if (writeErr) throw writeErr;
}

/** Atomically write JSON content */
async function atomicWriteJson(targetPath: string, data: unknown): Promise<void> {
	const content = JSON.stringify(data, null, 2);
	await atomicWrite(targetPath, content);
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Ensure `.ralph/` directory exists and return its path.
 */
export function ensureRalphDir(): string {
	const dir = resolveRalphDir();
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

/** Resolve the Ralph base dir path (without creating it) */
function resolveRalphDir(): string {
	if (_ralphDir) return _ralphDir;
	return join(process.cwd(), ".ralph");
}

// ─── Path helpers ──────────────────────────────────────────────────────

function statePath(name: string): string {
	return join(resolveRalphDir(), `${name}.state.json`);
}

function taskPath(name: string): string {
	return join(resolveRalphDir(), `${name}.md`);
}

function snapshotPath(name: string): string {
	return join(resolveRalphDir(), `${name}.snap.md`);
}

function lockPath(name: string): string {
	return join(resolveRalphDir(), `${name}.lock`);
}

// ─── State file I/O ──────────────────────────────────────────────

/**
 * Write RalphState to `.ralph/<name>.state.json` with atomic rename-on-write.
 */
export async function writeState(name: string, state: RalphStateFile): Promise<void> {
	RalphStateFileSchema.parse(state);
	await atomicWriteJson(statePath(name), state);
}

/**
 * Read and validate RalphState from `.ralph/<name>.state.json`.
 * Throws RalphError if file is missing, malformed JSON, or fails schema validation.
 */
export async function readState(name: string): Promise<RalphStateFile> {
	const path = statePath(name);
	try {
		const raw = await fsPromises.readFile(path, "utf-8");
		const state = parseRalphStateFile(raw);

		if (state.name !== name) {
			throw new RalphError(
				`State name mismatch: expected "${name}" but file contains "${state.name}"`,
			);
		}

		return state;
	} catch (err: unknown) {
		if (err instanceof RalphError) throw err;
		throw new RalphError(`Failed to read state file for "${name}": ${err}`);
	}
}

// ─── Task file I/O ──────────────────────────────────────────────

/** Write raw task Markdown atomically */
export async function writeTaskFile(name: string, content: string): Promise<void> {
	await atomicWrite(taskPath(name), content);
}

/** Read raw task Markdown; returns null if not found */
export async function readTaskFile(name: string): Promise<string | null> {
	try {
		return await fsPromises.readFile(taskPath(name), "utf-8");
	} catch {
		return null;
	}
}

/** Best-effort cleanup for a failed init transaction. */
export async function removeLoopArtifacts(name: string): Promise<void> {
	await Promise.all([
		fsPromises.rm(taskPath(name), { force: true }),
		fsPromises.rm(statePath(name), { force: true }),
	]);
}

// ─── Snapshot helpers ────────────────────────────────────────────

/**
 * Create a sidecar snapshot of the current task file.
 */
export function snapshotTaskFile(name: string): void {
	const src = taskPath(name);
	const dst = snapshotPath(name);
	fs.copyFileSync(src, dst);
}

/**
 * Restore task file from snapshot and delete the snapshot.
 */
export function discardSnapshot(name: string): void {
	try { fs.unlinkSync(snapshotPath(name)); } catch { /* already absent */ }
}

export function restoreSnapshot(name: string): void {
	const snap = snapshotPath(name);
	const path = taskPath(name);

	try {
		fs.accessSync(snap);
	} catch {
		throw new RalphError(`No snapshot found at ${snap}`);
	}

	fs.copyFileSync(snap, path);
	fs.unlinkSync(snap);
}

// ─── Lock management ────────────────────────────────────────

export interface LockHandle {
	release(): void;
}

/**
 * Create an exclusive PID-based lock for the named loop.
 * - Throws if a live collision is detected (another process or same-process re-lock).
 * - Overwrites stale locks where the original PID is dead or lock is very old.
 */
export function createLock(name: string, runId: string): LockHandle {
	ensureRalphDir();
	const path = lockPath(name);

	try {
		const existingRaw = fs.readFileSync(path, "utf-8");
		let existingParsed: { pid: number; runId?: string; lockedAt?: number; createdAt?: string } | null;
		try {
			existingParsed = JSON.parse(existingRaw) as typeof existingParsed;
		} catch {
			// Malformed lock — treat as stale, proceed to overwrite
			existingParsed = null;
		}

		if (existingParsed) {
			const isStale = isLockStale(
				existingParsed.pid,
				existingParsed.lockedAt,
				existingParsed.createdAt,
			);
			if (!isStale) {
				throw new RalphError(
					`Loop "${name}" is already locked by PID ${existingParsed.pid}`,
				);
			}
			// Stale — fall through to overwrite
		}
	} catch (err: unknown) {
		const nodeErr = err as NodeJS.ErrnoException;
		if (nodeErr?.code !== "ENOENT") {
			if (err instanceof RalphError) throw err;
			throw err;
		}
		// File doesn't exist — proceed to create
	}

	const lockData = {
		pid: process.pid,
		runId,
		lockedAt: Date.now(),
		createdAt: new Date().toISOString(),
	};

	// O_EXCL is the lock acquisition primitive: a read-then-write sequence
	// would allow two concurrent runners to both believe they own the loop.
	try {
		const fd = fs.openSync(path, "wx");
		try {
			fs.writeFileSync(fd, JSON.stringify(lockData), "utf-8");
		} finally {
			fs.closeSync(fd);
		}
	} catch (err) {
		const nodeErr = err as NodeJS.ErrnoException;
		if (nodeErr?.code !== "EEXIST") throw err;

		// A stale lock may have appeared after the initial inspection. Reclaim
		// it only after rechecking, then retry exclusive creation once.
		let current: { pid: number; runId?: string; lockedAt?: number; createdAt?: string };
		try {
			current = JSON.parse(fs.readFileSync(path, "utf-8"));
		} catch {
			current = { pid: -1 };
		}
		if (!isLockStale(current.pid, current.lockedAt, current.createdAt)) {
			throw new RalphError(`Loop "${name}" is already locked by PID ${current.pid}`);
		}
		try { fs.unlinkSync(path); } catch { /* another owner may have reclaimed it */ }
		const fd = fs.openSync(path, "wx");
		try { fs.writeFileSync(fd, JSON.stringify(lockData), "utf-8"); }
		finally { fs.closeSync(fd); }
	}

	return {
		release(): void {
			try {
				const current = JSON.parse(fs.readFileSync(path, "utf-8"));
				if (current.pid === process.pid && current.runId === runId) fs.unlinkSync(path);
			} catch {
				// Already gone or replaced — non-critical
			}
		},
	};
}

// ─── Collision detection ──────────────────────────────────────────

/**
 * Check whether a loop name already has artifacts present.
 * Throws RalphError if `.ralph/<name>.md` or `.ralph/<name>.state.json` exist.
 */
export function checkCollision(name: string): void {
	const taskFile = taskPath(name);
	const stateFile = statePath(name);

	let hasTask = false;
	let hasState = false;

	try {
		fs.accessSync(taskFile);
		hasTask = true;
	} catch {
		// not found
	}

	try {
		fs.accessSync(stateFile);
		hasState = true;
	} catch {
		// not found
	}

	if (hasTask || hasState) {
		const parts: string[] = [];
		if (hasTask) parts.push("task file");
		if (hasState) parts.push("state file");
		throw new RalphError(
			`Collision detected for "${name}": ${parts.join(" and ")} already exist`,
		);
	}
}

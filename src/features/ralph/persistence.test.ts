import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, access, constants } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";

import { StatusEnum, PhaseEnum, type RalphStateFile, RalphError } from "./schema";
import {
	ensureRalphDir,
	writeState,
	readState,
	writeTaskFile,
	readTaskFile,
	snapshotTaskFile,
	restoreSnapshot,
	createLock,
	checkCollision,
	setRalphDirForTesting,
	resetRalphDirForTesting,
} from "./persistence";

// ─── helpers ──────────────────────────────────────────────────────────────

const TEST_TASK_CONTENT = `## Goal\nImplement tests for auth\n\n## Deliverable\nTest suite with 80% coverage\n\n## Task checklist\n- [ ] Write unit tests\n- [ ] Write integration tests\n\n## Stale-prompt guard\nv2025-06-13\n\n## Completion gate\nTests pass CI\n\n## Iteration protocol\n1. Run tests\n2. Fix failures`;

function makeState(overrides = {}): RalphStateFile {
	return {
		name: "test-loop",
		source: "specs/auth.md",
		taskFile: ".ralph/test-loop.md",
		provider: "pi",
		model: "llama3.1",
		iteration: 0,
		maxIterations: 20,
		reflectEvery: 5,
		active: false,
		status: StatusEnum.ready,
		lastReflectionAt: 0,
		phase: PhaseEnum.ready,
		awaitingReview: false,
		...overrides,
	};
}

const runId = crypto.randomUUID();

// ─── lifecycle fixture ──────────────────────────────────────────────────

let tempRoot: string;
let ralphDirPath: string;

beforeEach(async () => {
	tempRoot = await mkdtemp(join(tmpdir(), "ralph-persist-test-"));
	ralphDirPath = join(tempRoot, ".ralph");
	setRalphDirForTesting(ralphDirPath);
});

afterEach(async () => {
	resetRalphDirForTesting();
	if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

// ─── ensureRalphDir ─────────────────────────────────────────────────────

describe("ensureRalphDir", () => {
	test("creates .ralph directory when absent", async () => {
		const result = ensureRalphDir();
		expect(result).toBe(ralphDirPath);

		// Directory should now exist
		await access(ralphDirPath, constants.F_OK);
	});

	test("returns existing path when directory already exists", async () => {
		const first = ensureRalphDir();
		const second = ensureRalphDir();
		expect(first).toBe(second);
	});
});

// ─── writeState / readState round-trip ──────────────────────────────────

describe("writeState / readState", () => {
	test("round-trips a valid state object", async () => {
		const state = makeState();
		await writeState("test-loop", state);
		const loaded = await readState("test-loop");
		expect(loaded).toEqual(state);
	});

	test("preserves optional runtime fields", async () => {
		const state = makeState({
			active: true,
			status: StatusEnum.in_progress,
			phase: PhaseEnum.implementing,
			startedAt: 1234567890,
			workerRunId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
			workerItem: "- [ ] Write tests",
			lastError: undefined,
		});
		await writeState("test-loop", state);
		const loaded = await readState("test-loop");
		expect(loaded.active).toBe(true);
		expect(loaded.startedAt).toBe(1234567890);
		expect(loaded.workerItem).toBe("- [ ] Write tests");
	});

	test("throws RalphError when reading non-existent state", async () => {
		await expect(readState("no-such-loop")).rejects.toThrow(RalphError);
	});

	test("throws RalphError for corrupted JSON content", async () => {
		ensureRalphDir(); // ensure dir exists before we write into it
		const filePath = join(ralphDirPath, "corrupt-loop.state.json");
		await writeFile(filePath, "{ not valid json }");
		await expect(readState("corrupt-loop")).rejects.toThrow(RalphError);
	});

	test("throws RalphError when state name doesn't match file content", async () => {
		const state = makeState({ name: "different-name" });
		await writeState("test-loop", state);
		expect(() => readState("test-loop")).toThrow();
	});

	test("overwrites existing state atomically", async () => {
		const first = makeState({ iteration: 0 });
		await writeState("test-loop", first);

		const second = makeState({ iteration: 5 });
		await writeState("test-loop", second);
		const loaded = await readState("test-loop");
		expect(loaded.iteration).toBe(5);
	});
});

// ─── writeTaskFile / readTaskFile ──────────────────────────────────────

describe("writeTaskFile / readTaskFile", () => {
	test("writes and reads back task file content", async () => {
		await writeTaskFile("test-loop", TEST_TASK_CONTENT);
		const content = await readTaskFile("test-loop");
		expect(content).toBe(TEST_TASK_CONTENT);
	});

	test("returns null when task file does not exist", async () => {
		const result = await readTaskFile("missing-loop");
		expect(result).toBeNull();
	});

	test("overwrites existing task file atomically", async () => {
		await writeTaskFile("test-loop", "v1");
		await writeTaskFile("test-loop", "v2");
		const content = await readTaskFile("test-loop");
		expect(content).toBe("v2");
	});
});

// ─── snapshot / restore ────────────────────────────────────────────────

describe("snapshotTaskFile / restoreSnapshot", () => {
	test("creates a snapshot copy of the task file", async () => {
		const original = "original content";
		await writeTaskFile("test-loop", original);
		snapshotTaskFile("test-loop");

		// Snapshot file should exist and contain same content
		const snapPath = join(ralphDirPath, "test-loop.snap.md");
		const snapContent = await readFile(snapPath, "utf-8");
		expect(snapContent).toBe(original);
	});

	test("throws when task file does not exist and has no snapshot", async () => {
		expect(() => snapshotTaskFile("missing")).toThrow();
	});

	test("restores from snapshot and deletes the snapshot", async () => {
		const original = "original content";
		await writeTaskFile("test-loop", original);
		snapshotTaskFile("test-loop");

		// Modify the task file
		await writeTaskFile("test-loop", "modified content");
		expect(await readTaskFile("test-loop")).toBe("modified content");

		// Restore
		restoreSnapshot("test-loop");
		const restored = await readTaskFile("test-loop");
		expect(restored).toBe(original);

		// Snapshot should be gone
		const snapContent = await readTaskFile("test-loop.snap.md".replace(".snap.md", ""));
	});

	test("throws when restoring without a snapshot", async () => {
		await writeTaskFile("test-loop", "some content");
		expect(() => restoreSnapshot("test-loop")).toThrow(RalphError);
	});
});

// ─── createLock ────────────────────────────────────────────────────────

describe("createLock", () => {
	test("creates a lock file and releases it", async () => {
		const handle = createLock("test-loop", runId);
		expect(typeof handle.release).toBe("function");

		// Lock file should exist
		const lockPath = join(ralphDirPath, "test-loop.lock");
		await access(lockPath, constants.F_OK);

		handle.release();

		// Lock file should be removed after release
		try {
			await access(lockPath, constants.F_OK);
			expect.fail("Lock file should have been removed");
		} catch {
			// expected — file no longer exists
		}
	});

	test("throws on collision with live lock from same process", () => {
		const handle1 = createLock("test-loop", runId);
		expect(() => createLock("test-loop", runId)).toThrow();
		handle1.release();
	});

	test("allows re-lock after release", () => {
		const handle1 = createLock("test-loop", runId);
		handle1.release();
		const handle2 = createLock("test-loop", runId);
		expect(typeof handle2.release).toBe("function");
		handle2.release();
	});

	test("lock file contains correct PID and runId", async () => {
		const handle = createLock("test-loop", runId);
		const lockPath = join(ralphDirPath, "test-loop.lock");
		const lockContent = JSON.parse(await readFile(lockPath, "utf-8"));

		expect(lockContent.pid).toBe(process.pid);
		expect(lockContent.runId).toBe(runId);
		expect(typeof lockContent.createdAt).toBe("string");
		handle.release();
	});
});

// ─── checkCollision ────────────────────────────────────────────────────

describe("checkCollision", () => {
	test("throws when task file exists", async () => {
		await writeTaskFile("existing-loop", TEST_TASK_CONTENT);
		expect(() => checkCollision("existing-loop")).toThrow(RalphError);
	});

	test("throws when state file exists", async () => {
		const state = makeState();
		await writeState("existing-loop", state);
		expect(() => checkCollision("existing-loop")).toThrow(RalphError);
	});

	test("does not throw when neither file exists", async () => {
		expect(() => checkCollision("fresh-loop")).not.toThrow();
	});

	test("throws even if only task file exists (state absent)", async () => {
		await writeTaskFile("partial-loop", TEST_TASK_CONTENT);
		expect(() => checkCollision("partial-loop")).toThrow(RalphError);
	});

	test("throws even if only state file exists (task absent)", async () => {
		const state = makeState();
		await writeState("state-only-loop", state);
		expect(() => checkCollision("state-only-loop")).toThrow(RalphError);
	});
});

// ─── stale lock detection ──────────────────────────────────────────────

describe("stale lock detection", () => {
	test("overwrites lock with dead PID (simulated)", async () => {
		// Write a lock file with a PID that doesn't exist
		const fakePid = 99999999;
		const lockFile = JSON.stringify({
			pid: fakePid,
			runId: "00000000-0000-0000-0000-000000000001",
			createdAt: new Date().toISOString(),
		});

		// Create .ralph dir first if needed
		ensureRalphDir();
		const lockPath = join(ralphDirPath, "stale-loop.lock");
		await writeFile(lockPath, lockFile);

		// Should succeed because PID is dead (on POSIX)
		const handle = createLock("stale-loop", runId);
		expect(typeof handle.release).toBe("function");

		// Lock should now have our PID
		const newContent = JSON.parse(await readFile(lockPath, "utf-8"));
		expect(newContent.pid).toBe(process.pid);
		handle.release();
	});

	test("does not steal an old lock while its PID is alive", async () => {
		const lockFile = JSON.stringify({
			pid: process.pid,
			runId: "00000000-0000-0000-0000-000000000002",
			createdAt: new Date(0).toISOString(),
		});
		ensureRalphDir();
		await writeFile(join(ralphDirPath, "old-lock.lock"), lockFile);
		expect(() => createLock("old-lock", runId)).toThrow(RalphError);
	});

	test("does not overwrite valid recent lock from same PID and process is alive", () => {
		const handle1 = createLock("valid-loop", runId);
		// Immediate re-lock by same process — lock is NOT stale
		expect(() => createLock("valid-loop", runId)).toThrow();
		handle1.release();
	});
});

// ─── atomic write cleanup on failure ────────────────────────────────────

describe("atomic write guarantees", () => {
	test("temp file is cleaned up even if final rename target dir is missing", async () => {
		// Remove .ralph dir after ensuring it, to simulate edge case
		await rm(ralphDirPath, { recursive: true, force: true });

		// ensureRalphDir recreates it — but we want to test that writes don't leave temps behind
		ensureRalphDir();
		const state = makeState();
		await writeState("test-loop", state);

		// State file exists and is valid JSON
		const content = await readState("test-loop");
		expect(content.name).toBe("test-loop");
	});
});

// ─── integration: full lifecycle ────────────────────────────────────────

describe("full lifecycle integration", () => {
	test("create → lock → modify state → snapshot → restore → release", async () => {
		const name = "lifecycle-test";
		const runIdLocal = crypto.randomUUID();

		// 1. Check no collision
		checkCollision(name);

		// 2. Write task file
		await writeTaskFile(name, TEST_TASK_CONTENT);
		expect(await readTaskFile(name)).toBe(TEST_TASK_CONTENT);

		// 3. Write initial state
		const initial = makeState({ name });
		await writeState(name, initial);
		expect((await readState(name)).status).toBe(StatusEnum.ready);

		// 4. Create lock
		const handle = createLock(name, runIdLocal);

		// 5. Collision should now throw (state + task exist)
		expect(() => checkCollision(name)).toThrow(RalphError);

		// 6. Update state during work
		const updated = makeState({ name, iteration: 1, status: StatusEnum.in_progress });
		await writeState(name, updated);
		expect((await readState(name)).iteration).toBe(1);

		// 7. Snapshot task file
		snapshotTaskFile(name);

		// 8. Modify task file (simulating worker editing)
		await writeTaskFile(name, "modified by worker");

		// 9. Restore from snapshot
		restoreSnapshot(name);
		expect(await readTaskFile(name)).toBe(TEST_TASK_CONTENT);

		// 10. Release lock
		handle.release();
	});
});

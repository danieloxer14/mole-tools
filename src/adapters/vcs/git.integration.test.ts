import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitAdapter } from "./git";

async function run(cmd: string[], cwd: string): Promise<void> {
	const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
	await proc.exited;
}

describe("GitAdapter (real git subprocess)", () => {
	test("stages, commits, and reads back a real repo", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-tools-git-"));
		const originalCwd = process.cwd();
		try {
			await run(["git", "init", "-q"], dir);
			await run(["git", "config", "user.email", "test@test.com"], dir);
			await run(["git", "config", "user.name", "Test"], dir);
			await Bun.write(join(dir, "a.txt"), "hello\n");
			await run(["git", "add", "a.txt"], dir);

			process.chdir(dir);
			const git = new GitAdapter();

			expect(await git.hasStagedChanges()).toBe(true);
			const { sha } = await git.commit("feat: add a.txt");
			expect(sha).toMatch(/^[0-9a-f]{40}$/);
			expect(await git.hasStagedChanges()).toBe(false);
			expect(await git.currentBranch()).toMatch(/master|main/);
		} finally {
			process.chdir(originalCwd);
			await rm(dir, { recursive: true, force: true });
		}
	});
});

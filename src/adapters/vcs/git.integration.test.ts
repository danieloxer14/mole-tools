import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitAdapter } from "./git";

async function run(cmd: string[], cwd: string): Promise<void> {
	const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
	await proc.exited;
}
async function runOutput(cmd: string[], cwd: string): Promise<string> {
	const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
	const stdout = await new Response(proc.stdout).text();
	await proc.exited;
	return stdout.trim();
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
	test("ignoreWhitespace hides whitespace-only files but keeps substantive changes", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-tools-git-"));
		try {
			await run(["git", "init", "-q"], dir);
			await run(["git", "config", "user.email", "test@test.com"], dir);
			await run(["git", "config", "user.name", "Test"], dir);
			await Bun.write(join(dir, "whitespace.txt"), "hello world\n");
			await Bun.write(join(dir, "substantive.txt"), "before\n");
			await run(["git", "add", "."], dir);
			await run(["git", "commit", "-qm", "base"], dir);
			const base = await runOutput(["git", "rev-parse", "HEAD"], dir);

			await Bun.write(join(dir, "whitespace.txt"), "hello  world\n");
			await Bun.write(join(dir, "substantive.txt"), "after\n");
			await run(["git", "add", "."], dir);
			await run(["git", "commit", "-qm", "head"], dir);
			const head = await runOutput(["git", "rev-parse", "HEAD"], dir);

			const git = new GitAdapter();
			const normal = await git.diffRange(dir, base, head);
			const hidden = await git.diffRange(dir, base, head, {
				ignoreWhitespace: true,
			});

			expect(normal.map(({ path }) => path).sort()).toEqual([
				"substantive.txt",
				"whitespace.txt",
			]);
			expect(hidden.map(({ path }) => path)).toEqual(["substantive.txt"]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

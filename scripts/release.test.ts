import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Scenario {
	branch?: string;
	dirty?: boolean;
	head?: string;
	originMain?: string;
	existingTag?: string;
	existingRelease?: string;
	notes?: string;
}

interface Result {
	exitCode: number;
	stdout: string;
	stderr: string;
	commands: string;
	packageContents: string;
	originalPackageContents: string;
	notesPath: string;
	artifactExists: boolean;
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function runRelease(
	scenario: Scenario = {},
	args = ["publish", "--notes-file", "release-notes.md"],
): Promise<Result> {
	const root = await mkdtemp(join(tmpdir(), "mole-tools-release-test-"));
	temporaryDirectories.push(root);
	const bin = join(root, "bin");
	await mkdir(join(root, "scripts"), { recursive: true });
	await mkdir(bin);

	const releaseScript = await Bun.file(
		join(import.meta.dir, "release.ts"),
	).text();
	await Bun.write(join(root, "scripts", "release.ts"), releaseScript);
	const packageContents = JSON.stringify(
		{
			name: "release-test",
			version: "1.2.3",
			scripts: { build: "echo built-artifact > mole-tools" },
		},
		null,
		2,
	);
	await Bun.write(join(root, "package.json"), packageContents);
	await Bun.write(
		join(root, "release-notes.md"),
		scenario.notes ?? "## Features\n\n- Add verified feature.\n",
	);

	const commandsPath = join(root, "commands.log");
	const gitPath = join(bin, "git");
	await Bun.write(
		gitPath,
		`#!/bin/sh
printf 'git %s\\n' "$*" >> "$RELEASE_COMMANDS"
case "$1 $2" in
  "status --porcelain")
    if [ "$RELEASE_DIRTY" = "true" ]; then printf ' M package.json\\n'; fi
    ;;
  "branch --show-current") printf '%s\\n' "$RELEASE_BRANCH" ;;
  "fetch --tags") ;;
  "rev-parse HEAD") printf '%s\\n' "$RELEASE_HEAD" ;;
  "rev-parse refs/remotes/origin/main") printf '%s\\n' "$RELEASE_ORIGIN_MAIN" ;;
  "tag --list")
    if [ "$3" = "$RELEASE_EXISTING_TAG" ]; then printf '%s\\n' "$3"; fi
    ;;
  "tag -a") ;;
  "push origin") ;;
  *) printf 'unexpected fake git command: %s\\n' "$*" >&2; exit 64 ;;
esac
`,
	);
	await chmod(gitPath, 0o755);

	const ghPath = join(bin, "gh");
	await Bun.write(
		ghPath,
		`#!/bin/sh
printf 'gh %s\\n' "$*" >> "$RELEASE_COMMANDS"
case "$1 $2" in
  "auth status") ;;
  "release list")
    if [ -n "$RELEASE_EXISTING_RELEASE" ]; then
      printf '[{"tagName":"%s"}]\\n' "$RELEASE_EXISTING_RELEASE"
    else
      printf '[]\\n'
    fi
    ;;
  "release create") printf 'release created\\n' ;;
  *) printf 'unexpected fake gh command: %s\\n' "$*" >&2; exit 64 ;;
esac
`,
	);
	await chmod(ghPath, 0o755);

	const child = Bun.spawn({
		cmd: [process.execPath, "run", "scripts/release.ts", ...args],
		cwd: root,
		env: {
			PATH: `${bin}:${process.env.PATH ?? ""}`,
			RELEASE_COMMANDS: commandsPath,
			RELEASE_BRANCH: scenario.branch ?? "main",
			RELEASE_DIRTY: scenario.dirty ? "true" : "false",
			RELEASE_HEAD: scenario.head ?? "commit123",
			RELEASE_ORIGIN_MAIN: scenario.originMain ?? "commit123",
			RELEASE_EXISTING_TAG: scenario.existingTag ?? "",
			RELEASE_EXISTING_RELEASE: scenario.existingRelease ?? "",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);

	return {
		exitCode,
		stdout,
		stderr,
		commands: await Bun.file(commandsPath)
			.text()
			.catch(() => ""),
		packageContents: await Bun.file(join(root, "package.json")).text(),
		originalPackageContents: packageContents,
		notesPath: await realpath(join(root, "release-notes.md")),
		artifactExists: await Bun.file(join(root, "mole-tools")).exists(),
	};
}

describe("release publish script", () => {
	test("publishes the existing package version with supplied notes and tag-only push", async () => {
		const result = await runRelease();

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Published v1.2.3");
		expect(result.packageContents).toContain('"version": "1.2.3"');
		expect(result.packageContents).toBe(result.originalPackageContents);
		expect(result.artifactExists).toBe(true);
		expect(result.commands).toContain("git tag -a v1.2.3 -m v1.2.3");
		expect(result.commands).toContain(
			"git push origin refs/tags/v1.2.3:refs/tags/v1.2.3",
		);
		expect(result.commands).toContain("gh release create v1.2.3");
		expect(result.commands).toContain(`--notes-file ${result.notesPath}`);
		expect(result.commands).toContain("--verify-tag");
	});

	test("rejects empty notes before release operations", async () => {
		const result = await runRelease({ notes: "" });

		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain("Release notes file must not be empty.");
		expect(result.commands).toBe("");
		expect(result.artifactExists).toBe(false);
	});

	test("requires the publish command and notes-file argument", async () => {
		const result = await runRelease({}, ["publish"]);

		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain(
			"Usage: bun run release publish --notes-file <path>",
		);
		expect(result.commands).toBe("");
	});

	for (const [name, scenario, error] of [
		["dirty tree", { dirty: true }, "dirty working tree"],
		["non-main branch", { branch: "release/v1.2.3" }, "current branch is main"],
		[
			"stale main",
			{ head: "old-commit", originMain: "new-commit" },
			"main does not match origin/main",
		],
		[
			"existing tag",
			{ existingTag: "v1.2.3" },
			"Git tag v1.2.3 already exists",
		],
		[
			"existing GitHub release",
			{ existingRelease: "v1.2.3" },
			"GitHub release v1.2.3 already exists",
		],
	] as const) {
		test(`refuses ${name} before tagging or publishing`, async () => {
			const result = await runRelease(scenario);

			expect(result.exitCode).not.toBe(0);
			expect(result.stderr).toContain(error);
			expect(result.commands).not.toContain("git tag -a");
			expect(result.commands).not.toContain("git push origin");
			expect(result.commands).not.toContain("gh release create");
			expect(result.artifactExists).toBe(false);
		});
	}
});

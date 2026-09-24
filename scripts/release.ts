import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const packagePath = resolve(repositoryRoot, "package.json");
const binaryPath = resolve(repositoryRoot, "mole-tools");
const assetName = "mole-tools-darwin-arm64";
const usage = "Usage: bun run release publish --notes-file <path>";

function fail(message: string): never {
	throw new Error(message);
}

function commandOutput(command: string[]): string {
	const result = Bun.spawnSync({
		cmd: command,
		cwd: repositoryRoot,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0) {
		fail(
			new TextDecoder().decode(result.stderr).trim() || `${command[0]} failed.`,
		);
	}
	return new TextDecoder().decode(result.stdout);
}

async function run(command: string[]): Promise<void> {
	const child = Bun.spawn({
		cmd: command,
		cwd: repositoryRoot,
		stdout: "inherit",
		stderr: "inherit",
	});
	if ((await child.exited) !== 0) fail(`${command.join(" ")} failed.`);
}

function parseNotesFile(argv: string[]): string {
	if (
		argv.length !== 3 ||
		argv[0] !== "publish" ||
		argv[1] !== "--notes-file" ||
		!argv[2]
	) {
		fail(usage);
	}
	return resolve(repositoryRoot, argv[2]);
}

function readPackageVersion(contents: string): string {
	const packageJson = JSON.parse(contents) as { version?: unknown };
	if (typeof packageJson.version !== "string")
		fail("package.json has no string version.");
	if (!/^\d+\.\d+\.\d+$/.test(packageJson.version)) {
		fail(
			`package.json version must be MAJOR.MINOR.PATCH; found ${packageJson.version}.`,
		);
	}
	return packageJson.version;
}

function assertNoExistingRelease(tag: string): void {
	const releases = JSON.parse(
		commandOutput([
			"gh",
			"release",
			"list",
			"--limit",
			"1000",
			"--json",
			"tagName",
		]),
	) as unknown;
	if (!Array.isArray(releases)) fail("Could not inspect GitHub releases.");

	const releaseTags = (releases as unknown[]).map((release) => {
		if (
			typeof release !== "object" ||
			release === null ||
			!("tagName" in release) ||
			typeof release.tagName !== "string"
		) {
			fail("Could not inspect GitHub releases.");
		}
		return release.tagName;
	});
	if (releaseTags.includes(tag)) fail(`GitHub release ${tag} already exists.`);
}

function assertCleanWorkingTree(): void {
	if (
		commandOutput([
			"git",
			"status",
			"--porcelain",
			"--untracked-files=all",
		]).trim()
	) {
		fail("Refusing to publish from a dirty working tree.");
	}
}

async function main(): Promise<void> {
	const notesPath = parseNotesFile(Bun.argv.slice(2));
	const notes = Bun.file(notesPath);
	if (!(await notes.exists()))
		fail(`Release notes file does not exist: ${notesPath}`);
	if (!(await notes.text()).trim())
		fail("Release notes file must not be empty.");
	if (!Bun.which("gh")) {
		fail(
			"GitHub CLI is required. Install it with 'brew install gh', then run 'gh auth login'.",
		);
	}

	if (commandOutput(["git", "branch", "--show-current"]).trim() !== "main") {
		fail("Refusing to publish unless the current branch is main.");
	}
	assertCleanWorkingTree();
	await run([
		"git",
		"fetch",
		"--tags",
		"origin",
		"refs/heads/main:refs/remotes/origin/main",
	]);
	assertCleanWorkingTree();

	const head = commandOutput(["git", "rev-parse", "HEAD"]).trim();
	const originMain = commandOutput([
		"git",
		"rev-parse",
		"refs/remotes/origin/main",
	]).trim();
	if (!head || head !== originMain) {
		fail(
			"Refusing to publish: main does not match origin/main. Fetch and fast-forward main first.",
		);
	}

	await run(["gh", "auth", "status"]);

	const packageContents = await Bun.file(packagePath).text();
	const version = readPackageVersion(packageContents);
	const tag = `v${version}`;
	if (commandOutput(["git", "tag", "--list", tag]).trim()) {
		fail(`Git tag ${tag} already exists.`);
	}
	assertNoExistingRelease(tag);

	await run([process.execPath, "run", "build"]);
	assertCleanWorkingTree();
	if ((await Bun.file(packagePath).text()) !== packageContents) {
		fail("Build changed package.json; refusing to publish.");
	}
	if (commandOutput(["git", "rev-parse", "HEAD"]).trim() !== head) {
		fail("Build changed HEAD; refusing to publish.");
	}
	if (!(await Bun.file(binaryPath).exists())) {
		fail(`Build did not produce ${binaryPath}.`);
	}

	await run(["git", "tag", "-a", tag, "-m", tag]);
	await run(["git", "push", "origin", `refs/tags/${tag}:refs/tags/${tag}`]);
	await run([
		"gh",
		"release",
		"create",
		tag,
		`${binaryPath}#${assetName}`,
		"--verify-tag",
		"--title",
		tag,
		"--notes-file",
		notesPath,
	]);
	console.log(`Published ${tag}: ${assetName}`);
}

main().catch((error: unknown) => {
	console.error(
		`release failed: ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exitCode = 1;
});

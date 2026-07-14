type Bump = "major" | "minor" | "patch";

const [bump] = Bun.argv.slice(2);
const validBumps = new Set<Bump>(["major", "minor", "patch"]);
const packagePath = "package.json";
const binaryPath = "mole-tools";
const assetName = "mole-tools-darwin-arm64";

function fail(message: string): never {
	throw new Error(message);
}

function commandOutput(command: string[]): string {
	const result = Bun.spawnSync({
		cmd: command,
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
		stdout: "inherit",
		stderr: "inherit",
	});
	if ((await child.exited) !== 0) fail(`${command[0]} failed.`);
}

function nextVersion(version: string, type: Bump): string {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!match)
		fail(`package.json version must be MAJOR.MINOR.PATCH; found ${version}.`);

	const [major, minor, patch] = match.slice(1).map(Number);

	if (major === undefined || minor === undefined || patch === undefined) {
		fail(`package.json version must be MAJOR.MINOR.PATCH; found ${version}.`);
	}

	switch (type) {
		case "major":
			return `${major + 1}.0.0`;
		case "minor":
			return `${major}.${minor + 1}.0`;
		case "patch":
			return `${major}.${minor}.${patch + 1}`;
	}
}

async function main(): Promise<void> {
	if (!validBumps.has(bump as Bump)) {
		fail("Usage: bun run release <major|minor|patch>");
	}
	if (!Bun.which("gh")) {
		fail(
			"GitHub CLI is required. Install it with 'brew install gh', then run 'gh auth login'.",
		);
	}
	if (commandOutput(["git", "status", "--porcelain"]).trim()) {
		fail(
			"Refusing to release from a dirty working tree. Commit or stash your changes first.",
		);
	}

	await run(["gh", "auth", "status"]);

	const originalPackage = await Bun.file(packagePath).text();
	const packageJson = JSON.parse(originalPackage) as { version?: unknown };
	if (typeof packageJson.version !== "string")
		fail("package.json has no string version.");

	const version = nextVersion(packageJson.version, bump as Bump);
	const updatedPackage = originalPackage.replace(
		/("version"\s*:\s*")[^"]+(")/,
		`$1${version}$2`,
	);
	if (updatedPackage === originalPackage)
		fail("Could not update package.json version.");

	let committed = false;
	try {
		await Bun.write(packagePath, updatedPackage);
		await run([process.execPath, "run", "build"]);
		await run(["git", "add", packagePath]);
		await run(["git", "commit", "-m", `chore(release): v${version}`]);
		committed = true;
		await run(["git", "tag", "-a", `v${version}`, "-m", `v${version}`]);
		await run(["git", "push", "origin", "HEAD", `v${version}`]);
		await run([
			"gh",
			"release",
			"create",
			`v${version}`,
			`${binaryPath}#${assetName}`,
			"--title",
			`v${version}`,
			"--generate-notes",
		]);
		console.log(`Published v${version}: ${assetName}`);
	} catch (error) {
		if (!committed) await Bun.write(packagePath, originalPackage);
		throw error;
	}
}

main().catch((error: unknown) => {
	console.error(
		`release failed: ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exitCode = 1;
});

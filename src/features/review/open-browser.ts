export type BrowserOpen = (url: string) => Promise<void>;

export async function openBrowser(url: string): Promise<void> {
	const args =
		process.platform === "darwin"
			? ["open", url]
			: process.platform === "win32"
				? ["cmd", "/c", "start", "", url]
				: ["xdg-open", url];
	const child = Bun.spawn(args, { stdout: "ignore", stderr: "ignore" });
	const exitCode = await child.exited;
	if (exitCode !== 0)
		throw new Error(`Unable to open browser (exit ${exitCode})`);
}

export const openUrl = openBrowser;

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SyncBanner } from "./SyncBanner";

const base = {
	refreshing: false,
	syncing: false,
	regenerateAfterSync: false,
	onRefresh: () => {},
	onSync: () => {},
	onRegenerateAfterSyncChange: () => {},
};

test("current merge request presents the review commit as Merge request at: <sha>", () => {
	const html = renderToStaticMarkup(
		<SyncBanner
			{...base}
			stale={false}
			newCommitCount={0}
			headSha="9f86d081884c7d659a2feaa0c55ad015a3bf4f1b"
		/>,
	);
	expect(html).toContain(
		"Merge request at: <code>9f86d081884c7d659a2feaa0c55ad015a3bf4f1b</code>",
	);
	expect(html).not.toContain("Merge request is current");
	expect(html).not.toContain("has changed");
	expect(html).toContain(">Refresh</button>");
});

test("stale merge request keeps the changed wording and commit count", () => {
	const html = renderToStaticMarkup(
		<SyncBanner {...base} stale newCommitCount={2} headSha="abc123" />,
	);
	expect(html).toContain("Merge request has changed");
	expect(html).toContain("2 new commits detected");
	expect(html).toContain(">Sync</button>");
});

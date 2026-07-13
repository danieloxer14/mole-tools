import type { Context } from "../../core/context";
import { logger } from "../../core/logger";
import type { HostMember } from "../../ports/git-host";
import type { Choice } from "../../ports/ui";

export interface ReviewerSuggestion {
	handle: string;
	displayName: string;
	commits: number;
	source: "touch" | "recent" | "codeowners";
}

const CODEOWNERS_DEPTH = 3;
const CODEOWNERS_LOCATIONS = [
	".gitlab/CODEOWNERS",
	"CODEOWNERS",
	".github/CODEOWNERS",
	"docs/CODEOWNERS",
];

/** Extract owner handles while ignoring comments and pattern tokens. */
export function parseCodeowners(text: string): string[] {
	const handles: string[] = [];
	for (const line of text.split(/\r?\n/)) {
		const content = line.replace(/#.*$/, "");
		const tokens = content.trim().split(/\s+/).slice(1);
		for (const token of tokens) {
			if (token.startsWith("@") && token.length > 1)
				handles.push(token.slice(1));
		}
	}
	return [...new Set(handles)];
}

export async function findCodeowners(
	root: string,
	_ctx: Context,
): Promise<string | null> {
	for (const location of CODEOWNERS_LOCATIONS) {
		const path = `${root}/${location}`;
		const exists = await Bun.file(path).exists();

		if (exists) return path;
	}
	// Keep the fallback deliberately bounded. CODEOWNERS is not a general
	// repository search (and must not crawl dependencies or .git).
	const glob = new Bun.Glob("**/CODEOWNERS");

	try {
		for await (const relative of glob.scan({ cwd: root, onlyFiles: true })) {
			const normalized = relative.replaceAll("\\", "/");
			if (
				normalized.split("/").length <= CODEOWNERS_DEPTH &&
				!normalized.startsWith(".git/") &&
				!normalized.startsWith("node_modules/")
			)
				return `${root}/${normalized}`;
		}
	} catch (err) {
		logger.warn("reviewers.codeowners-glob-failed", { error: err });
	}
	return null;
}

function normalized(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9.]/g, "");
}

/** Build reviewer suggestions directly from git history when no CODEOWNERS member pool is available. */
export function buildFallbackReviewerSuggestions(
	touchAuthors: { author: string; count: number }[],
	recentAuthors: string[],
	currentUser?: { id: string; handle: string } | null,
): ReviewerSuggestion[] {
	const picked = new Map<string, ReviewerSuggestion>();
	const add = (
		author: string,
		commits: number,
		source: ReviewerSuggestion["source"],
	) => {
		const key = normalized(author);
		if (currentUser && normalized(currentUser.handle) === key) return;
		const existing = picked.get(key);
		if (existing) {
			if (source === "touch") existing.commits += commits;
			return;
		}
		picked.set(key, {
			handle: key,
			displayName: author.trim(),
			commits,
			source,
		});
	};
	for (const touch of touchAuthors) {
		add(touch.author, touch.count, "touch");
	}
	for (const author of recentAuthors) {
		add(author, 0, "recent");
	}
	return [...picked.values()].sort((a, b) => b.commits - a.commits).slice(0, 4);
}

/** Return the first matching member according to the product's precedence. */
export function matchAuthorToMember(
	author: string,
	members: HostMember[],
): HostMember | null {
	const name = normalized(author);
	const words = author.toLowerCase().trim().split(/\s+/).filter(Boolean);
	const first = normalized(words[0] ?? "");
	const last = normalized(words.at(-1) ?? "");
	const rules = [
		(member: HostMember) =>
			normalized(member.handle) === name ||
			normalized(member.displayName ?? "") === name,
		(member: HostMember) =>
			first !== "" &&
			last !== "" &&
			normalized(member.handle).startsWith(first[0]) &&
			normalized(member.handle).includes(last),
		(member: HostMember) =>
			first !== "" &&
			last !== "" &&
			normalized(member.handle).startsWith(last[0]) &&
			normalized(member.handle).includes(first),
		(member: HostMember) =>
			normalized(member.handle).startsWith(name) ||
			name.startsWith(normalized(member.handle)),
	];
	for (const rule of rules) {
		const found = members.find(rule);
		if (found) return found;
	}
	return null;
}

export function rankReviewerSuggestions(
	members: HostMember[],
	touchAuthors: { author: string; count: number }[],
	recentAuthors: string[],
	currentUser?: { id: string; handle: string } | null,
): ReviewerSuggestion[] {
	const available = members.filter(
		(member) =>
			!currentUser ||
			(member.id !== currentUser.id &&
				normalized(member.handle) !== normalized(currentUser.handle)),
	);
	const picked = new Map<string, ReviewerSuggestion>();
	const add = (
		member: HostMember,
		commits: number,
		source: ReviewerSuggestion["source"],
	) => {
		const key = normalized(member.handle);
		const existing = picked.get(key);
		if (existing) {
			if (source === "touch") existing.commits += commits;
			return;
		}
		picked.set(key, {
			handle: member.handle,
			displayName: member.displayName ?? member.handle,
			commits,
			source,
		});
	};
	for (const touch of touchAuthors) {
		const member = matchAuthorToMember(touch.author, available);
		if (member) add(member, touch.count, "touch");
	}
	for (const author of recentAuthors) {
		const member = matchAuthorToMember(author, available);
		if (member) add(member, 0, "recent");
	}
	for (const member of available) add(member, 0, "codeowners");
	return [...picked.values()].sort((a, b) => b.commits - a.commits).slice(0, 4);
}

export async function selectReviewers(
	ctx: Context,
	base: string,
): Promise<string[]> {
	if (!ctx.gitHost) return [];

	const [files, currentUser] = await Promise.all([
		ctx.vcs.changedFiles(base),
		ctx.gitHost.currentUser(),
	]);

	const repoRoot = await ctx.vcs.repoRoot();


	// Try CODEOWNERS first for the member pool.
	const path = await findCodeowners(repoRoot, ctx);

	let members: HostMember[] = [];
	if (path) {
		const handles = parseCodeowners(await Bun.file(path).text());

		members = (
			await Promise.all(
				handles.map(
					(handle) =>
						ctx.gitHost?.resolveHandle(handle) ?? Promise.resolve(null),
				),
			)
		).filter((member): member is HostMember => member !== null);
	}


	// Build suggestions from CODEOWNERS members, touch authors, and recent authors.
	let suggestions = rankReviewerSuggestions(
		members,
		await ctx.vcs.touchAuthorsForFiles(files, 200),
		await ctx.vcs.recentAuthors(100),
		currentUser,
	);


	// If no candidates ranked from CODEOWNERS pool, fall back to git history only.
	if (suggestions.length === 0 && members.length === 0) {

		const [touchAuthors, recentAuthors] = await Promise.all([
			ctx.vcs.touchAuthorsForFiles(files, 200),
			ctx.vcs.recentAuthors(100),
		]);
		suggestions = buildFallbackReviewerSuggestions(
			touchAuthors,
			recentAuthors,
			currentUser,
		);
	}

	// If no candidates were ranked, return early (nothing to show).
	if (suggestions.length === 0) return [];

	const choices: Choice<string>[] = suggestions.map((suggestion) => ({
		value: suggestion.handle,
		label: `${suggestion.displayName} (@${suggestion.handle}, ${suggestion.commits} commits)`,
	}));
	const selected = await ctx.ui.multiSelect("Select reviewers", choices);

	return [...new Set(selected)];
}

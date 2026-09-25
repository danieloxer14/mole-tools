import { z } from "zod";

export const SKILL_NAME_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;
export const SKILL_NAME_MIN_LENGTH = 4;
export const SKILL_NAME_MAX_LENGTH = 64;
export const SKILL_PICKER_LIMIT = 3;

/** D4 order; returns the first failing message or null. `existing` compared case-insensitively. */
export function skillNameError(
	name: string,
	existing: readonly string[],
): string | null {
	if (name === "") return "Name is required";
	if (/[^A-Za-z0-9_-]/.test(name)) return "Use only letters, numbers, _ and -";
	if (name.length <= 3) return "Name must be more than 3 characters";
	if (name.length > SKILL_NAME_MAX_LENGTH)
		return "Name must be 64 characters or fewer";
	if (existing.some((value) => value.toLowerCase() === name.toLowerCase()))
		return "A skill with this name already exists";
	return null;
}

export const SkillRefSchema = z
	.object({
		name: z.string().regex(SKILL_NAME_PATTERN),
		version: z.number().int().positive(),
		text: z.string(),
	})
	.strict();
export type SkillRef = z.infer<typeof SkillRefSchema>;

export const SkillTokenSchema = z
	.object({
		name: z.string().regex(SKILL_NAME_PATTERN),
		start: z.number().int().nonnegative(),
		end: z.number().int().positive(),
	})
	.strict()
	.refine((token) => token.end === token.start + token.name.length + 1);

export interface SkillSummary {
	name: string;
	activeVersion: number;
	versions: number[];
	lastUsedAt: string | null;
}

export interface SkillDetail {
	name: string;
	version: number;
	text: string;
	activeVersion: number;
	versions: number[];
}

/**
 * `start` is slash index; `end` is exclusive end of the full `/<name>` token.
 */
export interface SkillToken {
	name: string;
	start: number;
	end: number;
}

/** Return syntactically valid slash tokens, whether or not a skill exists. */
export function findSkillTokenCandidates(text: string): SkillToken[] {
	const tokens: SkillToken[] = [];
	const pattern = /(^|\s)\/([A-Za-z0-9_-]+)(?=\s|$)/g;
	for (const match of text.matchAll(pattern)) {
		const boundary = match[1] ?? "";
		const name = match[2] ?? "";
		if (!name) continue;
		const start = (match.index ?? 0) + boundary.length;
		tokens.push({ name, start, end: start + 1 + name.length });
	}
	return tokens;
}

/** Match `findSkillTokenCandidates` against exact, case-sensitive skill names. */
export function findSkillTokens(
	text: string,
	names: ReadonlySet<string>,
): SkillToken[] {
	return findSkillTokenCandidates(text).filter((token) =>
		names.has(token.name),
	);
}

/** Replace each known token; refs are distinct and tokens retain every occurrence. */
export function expandSkillTokens(
	text: string,
	skills: ReadonlyMap<string, { version: number; text: string }>,
): { message: string; skills: SkillRef[]; invocations: SkillToken[] } {
	const invocations = findSkillTokens(text, new Set(skills.keys()));
	const seen = new Set<string>();
	const refs: SkillRef[] = [];
	const parts: string[] = [];
	let cursor = 0;

	for (const token of invocations) {
		const skill = skills.get(token.name);
		if (!skill) continue;

		parts.push(text.slice(cursor, token.start), skill.text);
		cursor = token.end;
		if (!seen.has(token.name)) {
			seen.add(token.name);
			refs.push({ name: token.name, version: skill.version, text: skill.text });
		}
	}
	parts.push(text.slice(cursor));

	return { message: parts.join(""), skills: refs, invocations };
}

/** For refs with non-empty text, longest text first: text.split(ref.text).join(`/${ref.name}`). */
export function collapseSkillText(
	text: string,
	refs: readonly SkillRef[],
): string {
	const sorted = refs
		.filter((ref) => ref.text.length > 0)
		.sort((a, b) => b.text.length - a.text.length);
	for (const ref of sorted) {
		text = text.split(ref.text).join(`/${ref.name}`);
	}
	return text;
}

/** D9 ranking + case-insensitive prefix filter on name, sliced to `limit` (default SKILL_PICKER_LIMIT). */
export function rankSkills(
	skills: readonly SkillSummary[],
	query: string,
	limit = SKILL_PICKER_LIMIT,
): SkillSummary[] {
	const prefix = query.toLowerCase();
	return skills
		.filter((skill) => skill.name.toLowerCase().startsWith(prefix))
		.sort((a, b) => {
			const aLastUsedAt = a.lastUsedAt;
			const bLastUsedAt = b.lastUsedAt;
			if (aLastUsedAt !== bLastUsedAt) {
				if (aLastUsedAt === null) return 1;
				if (bLastUsedAt === null) return -1;
				return aLastUsedAt < bLastUsedAt ? 1 : -1;
			}

			const aName = a.name.toLowerCase();
			const bName = b.name.toLowerCase();
			return aName < bName ? -1 : aName > bName ? 1 : 0;
		})
		.slice(0, limit);
}

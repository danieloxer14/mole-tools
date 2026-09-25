import { expect, test } from "bun:test";
import {
	collapseSkillText,
	expandSkillTokens,
	findSkillTokenCandidates,
	findSkillTokens,
	rankSkills,
	SKILL_NAME_MAX_LENGTH,
	SKILL_NAME_MIN_LENGTH,
	SKILL_NAME_PATTERN,
	SKILL_PICKER_LIMIT,
	type SkillRef,
	type SkillSummary,
	skillNameError,
} from "./skills";

test("validates skill names in D4 rule order", () => {
	expect(skillNameError("", [])).toBe("Name is required");
	expect(skillNameError("ab cd", [])).toBe(
		"Use only letters, numbers, _ and -",
	);
	expect(skillNameError("abc!", [])).toBe("Use only letters, numbers, _ and -");
	expect(skillNameError("a!", [])).toBe("Use only letters, numbers, _ and -");
	expect(skillNameError("abc", [])).toBe("Name must be more than 3 characters");
	expect(skillNameError("abcd", [])).toBeNull();
	expect(skillNameError("a".repeat(64), [])).toBeNull();
	expect(skillNameError("a".repeat(65), [])).toBe(
		"Name must be 64 characters or fewer",
	);
	expect(skillNameError("ABCD", ["abcd"])).toBe(
		"A skill with this name already exists",
	);
	expect(SKILL_NAME_PATTERN.test("abcd")).toBe(true);
	expect(SKILL_NAME_PATTERN.test("abc")).toBe(false);
	expect(SKILL_NAME_MIN_LENGTH).toBe(4);
	expect(SKILL_NAME_MAX_LENGTH).toBe(64);
});

test("finds only known skill tokens at start, after spaces, and after newlines", () => {
	const tokens = findSkillTokens("/abcd /abcd\n/abcd", new Set(["abcd"]));
	expect(tokens).toEqual([
		{ name: "abcd", start: 0, end: 5 },
		{ name: "abcd", start: 6, end: 11 },
		{ name: "abcd", start: 12, end: 17 },
	]);
	expect(findSkillTokens("x/abcd", new Set(["abcd"]))).toEqual([]);
	expect(findSkillTokens("/abcd.", new Set(["abcd"]))).toEqual([]);
	expect(findSkillTokens("/unknown", new Set(["abcd"]))).toEqual([]);
	expect(findSkillTokens("/ABCD", new Set(["abcd"]))).toEqual([]);
});

test("finds token candidates with the same boundaries before name lookup", () => {
	expect(
		findSkillTokenCandidates("/abcd x/abcd\n/xy /valid-name /nope."),
	).toEqual([
		{ name: "abcd", start: 0, end: 5 },
		{ name: "xy", start: 13, end: 16 },
		{ name: "valid-name", start: 17, end: 28 },
	]);
});

test("expands known tokens, preserves surrounding text, and de-duplicates refs", () => {
	const result = expandSkillTokens(
		"before /first middle /missing then /second and /first",
		new Map([
			["first", { version: 2, text: "first text" }],
			["second", { version: 3, text: "second text" }],
		]),
	);

	expect(result).toEqual({
		message:
			"before first text middle /missing then second text and first text",
		skills: [
			{ name: "first", version: 2, text: "first text" },
			{ name: "second", version: 3, text: "second text" },
		],
		invocations: [
			{ name: "first", start: 7, end: 13 },
			{ name: "second", start: 35, end: 42 },
			{ name: "first", start: 47, end: 53 },
		],
	});
});

test("collapses expanded multiline skill text back to its token", () => {
	const original =
		"Open with /multi-name now.\nThen read /multi-name carefully.";
	const expansions = new Map([
		[
			"multi-name",
			{ version: 4, text: "# Multi-line skill\nFirst line\nSecond line" },
		],
	]);
	const expanded = expandSkillTokens(original, expansions);
	expect(collapseSkillText(expanded.message, expanded.skills)).toBe(original);
});

test("ignores empty-text refs when collapsing skill text", () => {
	const emptyRef: SkillRef = { name: "empty", version: 1, text: "" };
	expect(collapseSkillText("keep this text", [emptyRef])).toBe(
		"keep this text",
	);
});

function summary(name: string, lastUsedAt: string | null): SkillSummary {
	return { name, activeVersion: 1, versions: [1], lastUsedAt };
}

test("ranks by recency, case-insensitive name, null recency, and default limit", () => {
	const skills = [
		summary("beta", "2025-01-01T00:00:00.000Z"),
		summary("Gamma", null),
		summary("Alpha", "2025-01-01T00:00:00.000Z"),
		summary("delta", "2026-01-01T00:00:00.000Z"),
		summary("charlie", "2025-04-01T00:00:00.000Z"),
		summary("Bravo", "2025-01-01T00:00:00.000Z"),
	];

	expect(rankSkills(skills, "").map(({ name }) => name)).toEqual([
		"delta",
		"charlie",
		"Alpha",
	]);
	expect(rankSkills(skills, "", 10).map(({ name }) => name)).toEqual([
		"delta",
		"charlie",
		"Alpha",
		"beta",
		"Bravo",
		"Gamma",
	]);
	expect(SKILL_PICKER_LIMIT).toBe(3);
});

test("ranks null last-used dates by case-insensitive name", () => {
	const skills = [
		summary("zeta", null),
		summary("Beta", null),
		summary("alpha", null),
	];

	expect(rankSkills(skills, "").map(({ name }) => name)).toEqual([
		"alpha",
		"Beta",
		"zeta",
	]);
});

test("filters all skills by a case-insensitive prefix before limiting", () => {
	const skills = [
		summary("outside", "2026-01-01T00:00:00.000Z"),
		summary("ReView-old", "2023-01-01T00:00:00.000Z"),
		summary("Reactor", "2024-01-01T00:00:00.000Z"),
		summary("Reentry", "2025-01-01T00:00:00.000Z"),
	];

	expect(rankSkills(skills, "rE").map(({ name }) => name)).toEqual([
		"Reentry",
		"Reactor",
		"ReView-old",
	]);
});

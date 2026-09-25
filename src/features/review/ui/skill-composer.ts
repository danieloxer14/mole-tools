import { findSkillTokens } from "../../../shared/skills";

export interface SlashQuery {
	start: number;
	end: number;
	query: string;
}

const NAME_CHARACTER = /^[A-Za-z0-9_-]$/;
const WHITESPACE = /\s/;

export function activeSlashQuery(
	text: string,
	selectionStart: number,
	selectionEnd: number,
): SlashQuery | null {
	if (selectionStart !== selectionEnd) return null;

	let queryStart = selectionStart;
	while (queryStart > 0 && NAME_CHARACTER.test(text[queryStart - 1] ?? "")) {
		queryStart -= 1;
	}

	const start = queryStart - 1;
	if (start < 0 || text[start] !== "/") return null;
	if (start > 0 && !WHITESPACE.test(text[start - 1] ?? "")) return null;

	return {
		start,
		end: selectionStart,
		query: text.slice(queryStart, selectionStart),
	};
}

export function replaceWithSkillToken(
	text: string,
	range: { start: number; end: number },
	name: string,
): { text: string; caret: number } {
	const trailingSpace = WHITESPACE.test(text[range.end] ?? "") ? "" : " ";
	const token = `/${name}${trailingSpace}`;
	return {
		text: text.slice(0, range.start) + token + text.slice(range.end),
		caret: range.start + name.length + 2,
	};
}

export function insertSkillAtCaret(
	text: string,
	caret: number,
	name: string,
): { text: string; caret: number } {
	const prefixSpace =
		caret > 0 && !WHITESPACE.test(text[caret - 1] ?? "") ? " " : "";
	const tokenStart = caret + prefixSpace.length;
	const withPrefix = text.slice(0, caret) + prefixSpace + text.slice(caret);
	return replaceWithSkillToken(
		withPrefix,
		{ start: tokenStart, end: tokenStart },
		name,
	);
}

export function atomicTokenDelete(
	text: string,
	selectionStart: number,
	selectionEnd: number,
	key: "Backspace" | "Delete",
	names: ReadonlySet<string>,
): { text: string; caret: number } | null {
	if (selectionStart !== selectionEnd) return null;

	const token = findSkillTokens(text, names).find((candidate) =>
		key === "Backspace"
			? candidate.start < selectionStart && selectionStart <= candidate.end
			: candidate.start <= selectionStart && selectionStart < candidate.end,
	);
	if (!token) return null;

	return {
		text: text.slice(0, token.start) + text.slice(token.end),
		caret: token.start,
	};
}

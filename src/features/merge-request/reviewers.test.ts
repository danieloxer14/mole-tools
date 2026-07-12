import { describe, expect, test } from "bun:test";
import { matchAuthorToMember, parseCodeowners, rankReviewerSuggestions } from "./reviewers";

const member = (handle: string, displayName = handle) => ({ id: handle, handle, displayName, kind: "user" as const });

describe("merge-request reviewers", () => {
	test("parses unique owners and ignores comments", () => {
		expect(parseCodeowners("# comment\n*.ts @alice @team/reviewers\n*.ts @alice")).toEqual(["alice", "team/reviewers"]);
	});

	test("matches author names by precedence and ranks touch history", () => {
		const members = [member("asmith", "Alice Smith"), member("bob")];
		expect(matchAuthorToMember("Alice Smith", members)?.handle).toBe("asmith");
		const result = rankReviewerSuggestions(members, [{ author: "Alice Smith", count: 3 }], ["bob"], null);
		expect(result.map((item) => item.handle)).toEqual(["asmith", "bob"]);
		expect(result[0].commits).toBe(3);
	});

	test("excludes the authenticated user and pads from CODEOWNERS", () => {
		const result = rankReviewerSuggestions(
			[member("alice"), member("self"), member("other")],
			[], [], { id: "self", handle: "self" },
		);
		expect(result.map((item) => item.handle)).toEqual(["alice", "other"]);
	});
});

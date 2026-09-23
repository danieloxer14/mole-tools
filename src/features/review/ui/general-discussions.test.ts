import { describe, expect, test } from "bun:test";
import type { HostDiscussion, HostNote } from "../../../ports/git-host";
import { generalDiscussions } from "./general-discussions";

const hiddenBodies = [
	"added 1 commit\n\n<ul><li>abc - x</li></ul>",
	"added 3 commits",
	"changed title from **{-a-}** to **{+b+}**",
	"changed the description",
	"mentioned in merge request !12",
	"mentioned in commit abc1234",
	"marked this merge request as **draft**",
	"assigned to @alice",
	"requested review from @bob",
];

const visibleSystemBodies = [
	"added ~bug label",
	"unassigned @bob",
	"mentioned in issue #3",
	"approved this merge request",
	"removed review request for @bob",
];

function note(body: string, system: boolean, id = "n1"): HostNote {
	return {
		id,
		author: "alice",
		body,
		createdAt: "2026-01-01T00:00:00Z",
		system,
	};
}

function discussion(
	notes: HostNote[],
	position: HostDiscussion["position"] = null,
): HostDiscussion {
	return {
		id: "d1",
		resolved: false,
		notes,
		position,
	};
}

describe("generalDiscussions", () => {
	test("hides listed system activity notes", () => {
		for (const body of hiddenBodies) {
			expect(generalDiscussions([discussion([note(body, true)])])).toEqual([]);
		}
	});

	test("keeps human notes with listed system activity wording", () => {
		for (const body of hiddenBodies) {
			expect(
				generalDiscussions([discussion([note(body, false)])]),
			).toHaveLength(1);
		}
	});

	test("keeps non-matching system notes", () => {
		for (const body of visibleSystemBodies) {
			expect(generalDiscussions([discussion([note(body, true)])])).toHaveLength(
				1,
			);
		}
	});

	test("drops positioned discussions", () => {
		const position: NonNullable<HostDiscussion["position"]> = {
			newPath: "src/example.ts",
			oldPath: null,
			newLine: 1,
			oldLine: null,
		};

		expect(
			generalDiscussions([discussion([note("human note", false)], position)]),
		).toEqual([]);
	});

	test("keeps human notes and does not mutate mixed discussions", () => {
		const hidden = note("assigned to @alice", true, "hidden");
		const human = note("I will fix this", false, "human");
		const inputNotes = [hidden, human];
		const input = discussion(inputNotes);

		const result = generalDiscussions([input]);

		expect(result).toHaveLength(1);
		expect(result[0]?.notes).toEqual([human]);
		expect(input.notes).toHaveLength(2);
		expect(input.notes).toEqual([hidden, human]);
		expect(input.notes).toBe(inputNotes);
	});

	test("preserves unchanged discussion identity", () => {
		const input = discussion([note("human note", false)]);

		expect(generalDiscussions([input])[0]).toBe(input);
	});

	test("matches leading whitespace and case differences", () => {
		expect(
			generalDiscussions([discussion([note("  Assigned to @alice", true)])]),
		).toEqual([]);
	});
});

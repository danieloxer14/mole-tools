import { describe, expect, test } from "bun:test";
import {
	AbortError,
	PortError,
	UserRejectedError,
} from "../../src/core/errors";
import { commit, runCommitFlow } from "../../src/features/commit";
import type { FileDiff } from "../../src/ports/vcs";
import { FakeIssueTracker } from "../fakes/FakeIssueTracker";
import { FakeLlm } from "../fakes/FakeLlm";
import { FakeUiPort } from "../fakes/FakeUiPort";
import { FakeVcs } from "../fakes/FakeVcs";
import { fakeContext } from "../fakes/fakeContext";

class NoInputUiPort extends FakeUiPort {
	override async select<T>(): Promise<T> {
		throw new Error("select must not be called in auto mode");
	}

	override async editText(): Promise<string> {
		throw new Error("editText must not be called in auto mode");
	}

	override async confirm(): Promise<boolean> {
		throw new Error("confirm must not be called in auto mode");
	}
}

describe("commit args schema", () => {
	test("rejects whitespace-only context with Zod error", () => {
		expect(() => commit.args.parse({ context: "   " })).toThrow();
	});

	test("accepts valid non-blank context", () => {
		const result = commit.args.parse({
			context: "Emphasize the migration risk",
		});
		expect(result.context).toBe("Emphasize the migration risk");
	});

	test("accepts empty object (no context)", () => {
		const result = commit.args.parse({});
		expect(result).toEqual({ auto: false });
	});

	test("parses the bare auto flag as true", () => {
		expect(commit.args.parse({ auto: true }).auto).toBe(true);
	});
});

describe("commit feature", () => {
	test("auto mode commits once without UI input or pushing", async () => {
		const vcs = new FakeVcs();
		const ui = new NoInputUiPort();
		const ctx = fakeContext({
			vcs,
			ui,
			llm: new FakeLlm([["feat: add x"]]),
			issues: null,
		});

		const result = await runCommitFlow(ctx, { auto: true });

		expect(result).toEqual({ committed: true, sha: "fakesha" });
		expect(vcs.committedMessages).toEqual(["feat: add x"]);
		expect(vcs.pushCalls).toEqual([]);
		expect(
			ui.transcript.filter((entry) =>
				["select", "editText", "confirm"].includes(entry.kind),
			),
		).toEqual([]);
		expect(
			ui.transcript.some(
				(entry) => entry.kind === "info" && entry.text === "feat: add x",
			),
		).toBe(true);
		expect(
			ui.transcript.some(
				(entry) =>
					entry.kind === "info" &&
					entry.text === "Committed fakesha: feat: add x",
			),
		).toBe(true);
	});

	// #2 — nothing staged
	test("aborts with 'No staged changes' when nothing is staged", async () => {
		const vcs = new FakeVcs({ staged: false });
		const ctx = fakeContext({ vcs });
		await expect(commit.run(ctx, {})).rejects.toThrow(/No staged changes/);
		expect(vcs.committedMessages).toEqual([]);
	});

	// #5 — branch matches Jira pattern + Jira configured
	test("includes the fetched Jira issue in the prompt when the branch matches", async () => {
		const issues = new FakeIssueTracker({
			"AST-1": { key: "AST-1", summary: "Add feature", description: "Details" },
		});
		const llm = new FakeLlm([["feat: add feature"]]);
		const ctx = fakeContext({
			vcs: new FakeVcs({ branch: "AST-1-add-feature" }),
			issues,
			llm,
			ui: new FakeUiPort([{ select: "accept" }, { confirm: false }]),
		});
		await commit.run(ctx, {});
		expect(issues.fetchedKeys).toEqual(["AST-1"]);
		expect(llm.requests[0]?.prompt).toContain("Add feature");
		expect(llm.requests[0]?.prompt).toContain("Details");
	});

	// #6 — Jira fetch fails
	test("aborts without committing when the Jira fetch fails", async () => {
		const issues = new FakeIssueTracker({}, new PortError("Jira down"));
		const vcs = new FakeVcs({ branch: "AST-1-add-feature" });
		const ctx = fakeContext({ vcs, issues });
		await expect(commit.run(ctx, {})).rejects.toThrow(PortError);
		expect(vcs.committedMessages).toEqual([]);
	});

	// #7 — branch doesn't match / Jira disabled: proceed diff-only, no error
	test("proceeds without a ticket when the branch doesn't match the Jira pattern", async () => {
		const issues = new FakeIssueTracker({});
		const ctx = fakeContext({
			vcs: new FakeVcs({ branch: "chore/cleanup" }),
			issues,
			ui: new FakeUiPort([{ select: "accept" }, { confirm: false }]),
		});
		const result = await commit.run(ctx, {});
		expect(issues.fetchedKeys).toEqual([]);
		expect(result.committed).toBe(true);
	});

	test("proceeds without a ticket when Jira is disabled (issues is null)", async () => {
		const ctx = fakeContext({
			issues: null,
			ui: new FakeUiPort([{ select: "accept" }, { confirm: false }]),
		});
		const result = await commit.run(ctx, {});
		expect(result.committed).toBe(true);
	});

	// #8 — lockfile / generated file excluded from full diff, appears stat-only
	test("excludes ignored files from the prompt's diff body, keeping only stats", async () => {
		const diff: FileDiff[] = [
			{
				path: "bun.lockb",
				statOnly: false,
				patch: "binary diff junk",
				insertions: 5,
				deletions: 2,
			},
			{
				path: "src/a.ts",
				statOnly: false,
				patch: "@@ -1 +1 @@",
				insertions: 1,
				deletions: 0,
			},
		];
		const llm = new FakeLlm([["feat: update lockfile and code"]]);
		const ctx = fakeContext({
			vcs: new FakeVcs({ diff }),
			llm,
			ui: new FakeUiPort([{ select: "accept" }, { confirm: false }]),
		});
		await commit.run(ctx, {});
		const prompt = llm.requests[0]?.prompt ?? "";
		expect(prompt).not.toContain("binary diff junk");
		expect(prompt).toContain("bun.lockb (+5/-2)");
		expect(prompt).toContain("@@ -1 +1 @@");
	});

	// #9 — invalid format retries, then aborts with violations after N attempts
	test("retries generation on invalid format and aborts after exhausting attempts", async () => {
		const llm = new FakeLlm([
			["not conventional"],
			["still bad"],
			["also bad"],
		]);
		const ctx = fakeContext({ llm });
		await expect(commit.run(ctx, {})).rejects.toThrow(AbortError);
		expect(llm.requests).toHaveLength(3);
	});

	test("succeeds after retrying once on invalid format", async () => {
		const llm = new FakeLlm([["not conventional"], ["feat: valid message"]]);
		const ctx = fakeContext({
			llm,
			ui: new FakeUiPort([{ select: "accept" }, { confirm: false }]),
		});
		const result = await commit.run(ctx, {});
		expect(result.committed).toBe(true);
		expect(llm.requests).toHaveLength(2);
	});

	// #9b — context propagates to every LLM request across retries
	test("context appears in every LLM request including retries", async () => {
		const llm = new FakeLlm([["not conventional"], ["feat: valid message"]]);
		const ctx = fakeContext({
			llm,
			ui: new FakeUiPort([{ select: "accept" }, { confirm: false }]),
		});
		await commit.run(ctx, { context: "Emphasize the migration risk" });
		expect(llm.requests).toHaveLength(2);
		for (const req of llm.requests) {
			expect(req.prompt).toContain("Additional user context:");
			expect(req.prompt).toContain("Emphasize the migration risk");
		}
	});

	// #9c — multi-word context with internal newlines/spaces is accepted and preserved
	test("multi-word multiline context is accepted and preserved in prompt", async () => {
		const llm = new FakeLlm([["feat: add feature"]]);
		const ctx = fakeContext({
			llm,
			ui: new FakeUiPort([{ select: "accept" }, { confirm: false }]),
		});
		await commit.run(ctx, {
			context:
				"This is a long context message\nwith multiple lines\n  and internal spacing.",
		});
		const prompt = llm.requests[0]?.prompt ?? "";
		expect(prompt).toContain("This is a long context message");
		expect(prompt).toContain("with multiple lines");
		expect(prompt).toContain("and internal spacing.");
	});

	// #10 — valid message shown with accept/edit/reject
	test("presents the generated message via select with accept/edit/reject options", async () => {
		const ui = new FakeUiPort([{ select: "accept" }, { confirm: false }]);
		const ctx = fakeContext({ ui, llm: new FakeLlm([["feat: add x"]]) });
		await commit.run(ctx, {});
		const selectEntry = ui.transcript.find((e) => e.kind === "select");
		expect(selectEntry?.opts).toEqual([
			{ label: "Accept", value: "accept" },
			{ label: "Edit", value: "edit" },
			{ label: "Reject", value: "reject" },
		]);
	});

	// #11 — reject aborts, no commit
	test("rejecting the message throws UserRejectedError and does not commit", async () => {
		const vcs = new FakeVcs();
		const ctx = fakeContext({
			vcs,
			ui: new FakeUiPort([{ select: "reject" }]),
		});
		await expect(commit.run(ctx, {})).rejects.toThrow(UserRejectedError);
		expect(vcs.committedMessages).toEqual([]);
	});

	// #12 — edit is prefilled and committed as-is, no re-check
	test("editing commits the edited text as-is without re-running the format check", async () => {
		const vcs = new FakeVcs();
		const ui = new FakeUiPort([
			{ select: "edit" },
			{ editText: "not conventional at all" },
			{ confirm: false },
		]);
		const ctx = fakeContext({
			vcs,
			ui,
			llm: new FakeLlm([["feat: original"]]),
		});
		const result = await commit.run(ctx, {});
		expect(result.committed).toBe(true);
		expect(vcs.committedMessages).toEqual(["not conventional at all"]);
		const editEntry = ui.transcript.find((e) => e.kind === "editText");
		expect(editEntry?.initial).toBe("feat: original");
	});

	// #13 — accept commits the message
	test("accepting commits the generated message", async () => {
		const vcs = new FakeVcs();
		const ctx = fakeContext({
			vcs,
			llm: new FakeLlm([["feat: add x"]]),
			ui: new FakeUiPort([{ select: "accept" }, { confirm: false }]),
		});
		const result = await commit.run(ctx, {});
		expect(vcs.committedMessages).toEqual(["feat: add x"]);
		expect(result).toEqual({ committed: true, sha: "fakesha" });
	});

	// #14 — post-commit push, yes
	test("pushes the current branch when the user confirms push", async () => {
		const vcs = new FakeVcs({ branch: "feature/x" });
		const ctx = fakeContext({
			vcs,
			llm: new FakeLlm([["feat: add x"]]),
			ui: new FakeUiPort([{ select: "accept" }, { confirm: true }]),
		});
		await commit.run(ctx, {});
		expect(vcs.pushCalls).toEqual([
			{ setUpstream: false, branch: "feature/x" },
		]);
	});

	test("does not push when the user declines", async () => {
		const vcs = new FakeVcs();
		const ctx = fakeContext({
			vcs,
			llm: new FakeLlm([["feat: add x"]]),
			ui: new FakeUiPort([{ select: "accept" }, { confirm: false }]),
		});
		await commit.run(ctx, {});
		expect(vcs.pushCalls).toEqual([]);
	});

	test("merge-request flow stays interactive without its push prompt", async () => {
		const vcs = new FakeVcs();
		const ui = new FakeUiPort([{ select: "accept" }]);
		const ctx = fakeContext({
			vcs,
			llm: new FakeLlm([["feat: add x"]]),
			ui,
		});

		await runCommitFlow(ctx, { askToPush: false });

		expect(ui.transcript.find((entry) => entry.kind === "select")).toBeDefined();
		expect(
			ui.transcript.some((entry) => entry.kind === "confirm"),
		).toBe(false);
		expect(vcs.pushCalls).toEqual([]);
		expect(vcs.committedMessages).toEqual(["feat: add x"]);
	});

	// #15 — push rejected by remote surfaces the error verbatim
	test("propagates a PortError verbatim when the remote rejects the push", async () => {
		const vcs = new FakeVcs({
			pushError: new PortError("push failed", "! [rejected] main -> main"),
		});
		const ctx = fakeContext({
			vcs,
			llm: new FakeLlm([["feat: add x"]]),
			ui: new FakeUiPort([{ select: "accept" }, { confirm: true }]),
		});
		expect.assertions(2);
		try {
			await commit.run(ctx, {});
		} catch (e) {
			expect(e).toBeInstanceOf(PortError);
			expect((e as PortError).stderr).toBe("! [rejected] main -> main");
		}
	});
});

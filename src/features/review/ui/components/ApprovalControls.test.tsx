import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { MrApprovalState } from "../../../ports/git-host";
import { ApprovalControls } from "./ApprovalControls";

const approval: MrApprovalState = {
	approved: true,
	currentUser: "reviewer",
	approvalsLeft: 0,
	approvedBy: ["reviewer", "maintainer"],
	rules: [
		{
			name: "default",
			approvalsRequired: 2,
			approvalsLeft: 0,
			approvedBy: ["reviewer", "maintainer"],
		},
	],
};

function render(
	props: Partial<Parameters<typeof ApprovalControls>[0]> = {},
): string {
	return renderToStaticMarkup(
		<ApprovalControls
			mrWebUrl="https://gitlab.example.com/group/project/-/merge_requests/42"
			approval={approval}
			loading={false}
			pendingAction={null}
			error={null}
			onAction={() => {}}
			{...props}
		/>,
	);
}

test("renders GitLab link and approved state", () => {
	const markup = render();

	expect(markup).toContain("Open in GitLab");
	expect(markup).toContain('target="_blank"');
	expect(markup).toContain('rel="noopener noreferrer"');
	expect(markup).toContain(">Approved</span>");
	expect(markup).toContain("Unapprove");
	expect(markup).toContain("Approved by reviewer, maintainer");
});

test("disables action while approval request is pending", () => {
	const markup = render({
		approval: { ...approval, approved: false },
		pendingAction: "approve",
	});

	expect(markup).toContain("Approving…");
	expect(markup).toContain('<button type="button" disabled="">');
});

test("reports unavailable approval and disables action", () => {
	const markup = render({ approval: null, loading: false });

	expect(markup).toContain(">Unavailable</span>");
	expect(markup).toContain("Approval status unavailable.");
	expect(markup).toContain('<button type="button" disabled="">');
});

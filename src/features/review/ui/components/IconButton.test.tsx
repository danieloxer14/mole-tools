import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { IconButton } from "./IconButton";

const icon = <span aria-hidden="true">icon</span>;

test("renders labelled disabled button", () => {
	const html = renderToStaticMarkup(
		<IconButton label="Approve" disabled>
			{icon}
		</IconButton>,
	);

	expect(html).toContain('class="icon-button"');
	expect(html).toContain('aria-label="Approve"');
	expect(html).toContain('title="Approve"');
	expect(html).toContain('disabled=""');
	expect(html).toContain(">icon</span>");
});

test("renders busy spinner and badge marker", () => {
	const html = renderToStaticMarkup(
		<IconButton label="Refresh" busy badge>
			{icon}
		</IconButton>,
	);

	expect(html).toContain('aria-busy="true"');
	expect(html).toContain('class="icon-button-spinner"');
	expect(html).toContain('class="icon-button-badge"');
});

test("renders href actions as external links instead of buttons", () => {
	const html = renderToStaticMarkup(
		<IconButton label="Open" href="https://gitlab.example.test/mr/1">
			{icon}
		</IconButton>,
	);

	expect(html).toContain('<a class="icon-button"');
	expect(html).toContain('href="https://gitlab.example.test/mr/1"');
	expect(html).toContain('target="_blank"');
	expect(html).toContain('rel="noreferrer"');
	expect(html).not.toContain("<button");
});

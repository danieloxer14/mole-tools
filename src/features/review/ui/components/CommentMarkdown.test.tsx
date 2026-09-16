import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CommentMarkdown } from "./CommentMarkdown";

test("preserves source line breaks in rendered comment paragraphs", () => {
	const markup = renderToStaticMarkup(
		<CommentMarkdown body={"first line\nsecond line"} />,
	);

	expect(markup).toContain("<p>first line\nsecond line</p>");
});

test("renders multiline comment paragraphs with visible line breaks", async () => {
	const style = document.createElement("style");
	style.textContent = await Bun.file(
		new URL("../app.css", import.meta.url),
	).text();
	document.head.append(style);

	const container = document.createElement("div");
	container.innerHTML = renderToStaticMarkup(
		<CommentMarkdown body={"first line\nsecond line"} />,
	);
	document.body.append(container);

	try {
		const paragraph = container.querySelector("p");
		expect(paragraph).not.toBeNull();
		expect(paragraph?.textContent).toBe("first line\nsecond line");
		expect(window.getComputedStyle(paragraph as Element).whiteSpace).toBe(
			"pre-wrap",
		);
	} finally {
		container.remove();
		style.remove();
	}
});

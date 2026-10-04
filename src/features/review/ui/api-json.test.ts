import { expect, test } from "bun:test";
import { responseErrorMessage } from "./api-json";

test("includes a JSON API error with the request fallback", async () => {
	const response = Response.json(
		{ error: "Unable to refresh discussions: GitLab returned 503" },
		{ status: 502 },
	);

	expect(
		await responseErrorMessage(response, "Sync request failed (502)"),
	).toBe(
		"Sync request failed (502): Unable to refresh discussions: GitLab returned 503",
	);
});

test("keeps the fallback when an upstream error body is not JSON", async () => {
	const response = new Response("Bad Gateway", {
		status: 502,
		headers: { "content-type": "text/plain" },
	});

	expect(
		await responseErrorMessage(response, "Sync request failed (502)"),
	).toBe("Sync request failed (502)");
});

test("keeps the fallback when JSON body has no useful error", async () => {
	const response = Response.json({ message: "unstructured" }, { status: 502 });

	expect(
		await responseErrorMessage(response, "Sync request failed (502)"),
	).toBe("Sync request failed (502)");
});

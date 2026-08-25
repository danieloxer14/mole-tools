import { describe, expect, test } from "bun:test";
import { PortError } from "../core/errors";
import { encodeProjectPath, parseMrUrl } from "./mr-url";

describe("parseMrUrl", () => {
	test("parses a nested GitLab project and IID", () => {
		expect(
			parseMrUrl(
				"https://gitlab.example.com/group/sub-project/-/merge_requests/42",
			),
		).toEqual({
			host: "gitlab.example.com",
			projectPath: "group/sub-project",
			iid: 42,
		});
	});

	test("accepts both HTTP schemes", () => {
		expect(
			parseMrUrl("http://gitlab.example.com/acme/api/-/merge_requests/1").iid,
		).toBe(1);
	});

	test.each([
		"ftp://gitlab.example.com/acme/api/-/merge_requests/1",
		"https://gitlab.example.com/acme/api/merge_requests/1",
		"https://gitlab.example.com/acme/api/-/merge_requests/0",
		"https://gitlab.example.com/acme/api/-/merge_requests/01",
	])("rejects invalid URL %s", (url) => {
		expect(() => parseMrUrl(url)).toThrow(PortError);
	});
});

test("encodeProjectPath encodes slashes for GitLab API paths", () => {
	expect(encodeProjectPath("group/sub-project")).toBe("group%2Fsub-project");
});

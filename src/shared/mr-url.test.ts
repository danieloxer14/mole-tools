import { describe, expect, test } from "bun:test";
import { PortError } from "../core/errors";
import {
	encodeProjectPath,
	parseMrUrl,
	parsePullRequestUrl,
	parseReviewUrl,
} from "./mr-url";

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

test.each([
	" https://gitlab.example.com/acme/api/-/merge_requests/1 ",
	"ftp://gitlab.example.com/acme/api/-/merge_requests/1",
])("rejects invalid HTTP URL envelope in both parsers: %s", (input) => {
	const expectedError = `Invalid merge request URL: ${input}`;
	expect(() => parseMrUrl(input)).toThrow(expectedError);
	expect(() => parsePullRequestUrl(input)).toThrow(expectedError);
});

describe("parseReviewUrl", () => {
	test("parses a GitHub pull request with a trailing page path", () => {
		expect(parseReviewUrl("https://github.com/o/r/pull/42/files")).toEqual({
			provider: "github",
			ref: { host: "github.com", projectPath: "o/r", iid: 42 },
		});
	});

	test("parses a GitHub pull request without a suffix", () => {
		expect(parseReviewUrl("https://github.com/o/r/pull/42")).toEqual({
			provider: "github",
			ref: { host: "github.com", projectPath: "o/r", iid: 42 },
		});
	});

	test("preserves GitHub Enterprise host", () => {
		expect(parseReviewUrl("https://github.example.com/o/r/pull/3")).toEqual({
			provider: "github",
			ref: { host: "github.example.com", projectPath: "o/r", iid: 3 },
		});
	});

	test("parses a GitLab merge request using parseMrUrl", () => {
		const input =
			"https://gitlab.example.com/group/sub-project/-/merge_requests/42";
		expect(parseReviewUrl(input)).toEqual({
			provider: "gitlab",
			ref: parseMrUrl(input),
		});
	});

	test.each([
		"https://gitlab.example.com/a/b/-/merge_requests/0",
		"https://gitlab.example.com/a/b/pull/5/-/merge_requests/x",
	])("rejects invalid GitLab merge request URL %s", (input) => {
		expect(() => parseReviewUrl(input)).toThrow(
			`Invalid merge request URL: ${input}`,
		);
	});

	test.each([
		"https://github.com/o/pull/1",
		"https://github.com/o/r/pull/0",
		"https://github.com/o/r/issues/1",
	])("rejects invalid review URL %s", (input) => {
		expect(() => parseReviewUrl(input)).toThrow(
			`Invalid merge request URL: ${input}`,
		);
	});
});

test("encodeProjectPath encodes slashes for GitLab API paths", () => {
	expect(encodeProjectPath("group/sub-project")).toBe("group%2Fsub-project");
});

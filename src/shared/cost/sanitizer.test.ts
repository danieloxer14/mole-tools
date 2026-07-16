import { describe, expect, test } from "bun:test";
import { sanitizeDiagnostic } from "./sanitizer";

describe("cost diagnostics sanitizer", () => {
	test("removes temp paths, session/prompt content, credentials, and stacks", () => {
		const result = sanitizeDiagnostic("Error at /var/folders/ab/tmp/session-123/file.json\n" +
			"prompt: secret user request\n" +
			"Authorization: Bearer abc123\n" +
			"    at privateFn (/tmp/app.ts:1:2)");
		expect(result).not.toContain("/var/folders");
		expect(result).not.toContain("/tmp/");
		expect(result).not.toContain("secret user request");
		expect(result).not.toContain("abc123");
		expect(result).not.toContain("privateFn");
	});

	test("caps diagnostic length", () => {
		expect(sanitizeDiagnostic("x".repeat(10_000)).length).toBeLessThanOrEqual(2000);
	});
});

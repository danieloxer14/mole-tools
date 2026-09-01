import { describe, expect, test } from "bun:test";
import { PiAdapter } from "./pi";

describe("PiAdapter", () => {
	test("constructor accepts binary and optional projectRoot", () => {
		const withCustom = new PiAdapter({ binary: "npx pi", projectRoot: "/foo" });
		expect(withCustom).toBeDefined();
	});

	test("surfaces a non-zero Pi process exit", async () => {
		const adapter = new PiAdapter({ binary: "sh" });
		const consume = async () => {
			for await (const _chunk of adapter.generate({
				model: "claude",
				system: "",
				prompt: "hello",
			})) {
				// Drain output so the subprocess can finish.
			}
		};

		await expect(consume()).rejects.toThrow(/Pi exited with code/);
	});
});

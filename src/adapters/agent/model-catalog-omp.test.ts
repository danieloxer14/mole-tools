import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	discoverOmpModels,
	OMP_MODEL_CATALOG_MAX_OUTPUT_BYTES,
	OMP_MODEL_CATALOG_TIMEOUT_MS,
	type OmpModelCatalogProcessOptions,
	type OmpModelCatalogProcessResult,
	type OmpModelCatalogProcessRunner,
	resolveOmpModelCatalogBinary,
} from "./model-catalog-omp";

interface Invocation {
	binary: string;
	args: string[];
	options: OmpModelCatalogProcessOptions;
}

function commandResult(
	stdout: string,
	exitCode = 0,
	stderr = "",
): OmpModelCatalogProcessResult {
	const encoder = new TextEncoder();
	return {
		stdout: encoder.encode(stdout),
		stderr: encoder.encode(stderr),
		exitCode,
	};
}

function recordingRunner(
	result: OmpModelCatalogProcessResult,
	calls: Invocation[],
): OmpModelCatalogProcessRunner {
	return async (binary, args, options) => {
		calls.push({ binary, args: [...args], options });
		return result;
	};
}

async function withTemporaryExecutable<T>(
	script: string,
	run: (binary: string) => Promise<T>,
): Promise<T> {
	const directory = await mkdtemp(join(tmpdir(), "omp catalog test "));
	const binary = join(directory, "omp executable");
	try {
		await Bun.write(binary, `#!/bin/sh\n${script}\n`);
		await chmod(binary, 0o755);
		return await run(binary);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
describe("OMP model catalog", () => {
	test("runs selected OMP binary with argument array and filters duplicate model efforts", async () => {
		const config = {
			review: {
				agent: "omp" as const,
				binary: "/custom path/omp",
				model: "saved-model",
			},
		};
		const originalConfig = structuredClone(config);
		const calls: Invocation[] = [];
		const runner = recordingRunner(
			commandResult(
				JSON.stringify({
					models: [
						{
							selector: " opus ",
							thinking: [
								"high",
								"ultra",
								"constructor",
								"off",
								"future-level",
								"high",
							],
						},
						{ selector: "opus", thinking: ["low"] },
						{ selector: "sonnet", thinking: ["auto", "ultra"] },
					],
				}),
			),
			calls,
		);

		expect(await discoverOmpModels(config, runner)).toEqual([
			{ id: "opus", label: "opus", efforts: ["off", "low", "high"] },
			{ id: "sonnet", label: "sonnet", efforts: ["auto"] },
		]);
		expect(calls).toEqual([
			{
				binary: "/custom path/omp",
				args: ["models", "--json"],
				options: {
					cwd: process.cwd(),
					timeoutMs: OMP_MODEL_CATALOG_TIMEOUT_MS,
					maxOutputBytes: OMP_MODEL_CATALOG_MAX_OUTPUT_BYTES,
				},
			},
		]);
		expect(config).toEqual(originalConfig);
	});

	test("invokes a configured executable directly with models --json", async () => {
		const stdout = JSON.stringify({
			models: [{ selector: "actual-process-model", thinking: ["minimal"] }],
		});
		await withTemporaryExecutable(
			`[ "$1" = "models" ] && [ "$2" = "--json" ] || exit 42\nprintf '%s' '${stdout}'`,
			async (binary) => {
				expect(
					await discoverOmpModels({
						review: { agent: "omp", binary },
					}),
				).toEqual([
					{
						id: "actual-process-model",
						label: "actual-process-model",
						efforts: ["minimal"],
					},
				]);
			},
		);
	});

	test("uses omp when another review agent has its own configured binary", async () => {
		expect(
			resolveOmpModelCatalogBinary({
				review: { agent: "claude", binary: "/custom path/claude" },
			}),
		).toBe("omp");

		const calls: Invocation[] = [];
		await discoverOmpModels(
			{ review: { agent: "claude", binary: "/custom path/claude" } },
			recordingRunner(commandResult('{"models":[]}'), calls),
		);
		expect(calls[0]?.binary).toBe("omp");
	});

	test("rejects malformed JSON without changing configured settings", async () => {
		const config = {
			review: {
				agent: "omp" as const,
				binary: "omp-custom",
				model: "saved-model",
			},
		};
		const originalConfig = structuredClone(config);

		await expect(
			discoverOmpModels(config, recordingRunner(commandResult("{"), [])),
		).rejects.toThrow("malformed JSON");
		expect(config).toEqual(originalConfig);
	});

	test("rejects malformed selector and thinking shapes", async () => {
		const malformedCatalogs = [
			{ models: [{ selector: "  ", thinking: ["high"] }] },
			{ models: [{ selector: "opus", thinking: "high" }] },
			{ models: [{ selector: "opus" }] },
		];
		for (const response of malformedCatalogs) {
			await expect(
				discoverOmpModels(
					{ review: { agent: "omp" } },
					recordingRunner(commandResult(JSON.stringify(response)), []),
				),
			).rejects.toThrow("invalid shape");
		}
	});

	test("rejects nonzero command exits without changing configured settings", async () => {
		const config = {
			review: {
				agent: "omp" as const,
				binary: "omp-custom",
				model: "saved-model",
			},
		};
		const originalConfig = structuredClone(config);
		await expect(
			discoverOmpModels(
				config,
				recordingRunner(commandResult('{"models":[]}', 17), []),
			),
		).rejects.toThrow("exited with code 17");
		expect(config).toEqual(originalConfig);
	});

	test("passes the five-second deadline and preserves settings on timeout", async () => {
		const config = {
			review: {
				agent: "omp" as const,
				binary: "omp-custom",
				model: "saved-model",
			},
		};
		const originalConfig = structuredClone(config);
		const calls: Invocation[] = [];
		const runner: OmpModelCatalogProcessRunner = async (
			binary,
			args,
			options,
		) => {
			calls.push({ binary, args: [...args], options });
			throw new Error("OMP models --json timed out after 5000 ms");
		};

		await expect(discoverOmpModels(config, runner)).rejects.toThrow(
			"timed out after 5000 ms",
		);
		expect(calls[0]?.options.timeoutMs).toBe(5_000);
		expect(config).toEqual(originalConfig);
	});

	test("terminates an OMP process that exceeds the five-second deadline without changing settings", {
		timeout: 10_000,
	}, async () => {
		await withTemporaryExecutable("exec sleep 30", async (binary) => {
			const config = {
				review: { agent: "omp" as const, binary, model: "saved-model" },
			};
			const originalConfig = structuredClone(config);
			await expect(discoverOmpModels(config)).rejects.toThrow(
				"timed out after 5000 ms",
			);
			expect(config).toEqual(originalConfig);
		});
	});
	// Exercise real subprocess timeout and process-group cleanup; fake timers cannot drive OS pipes.
	test("times out when a descendant keeps stdout and stderr open", {
		timeout: 12_000,
	}, async () => {
		await withTemporaryExecutable(
			`(sleep 7; printf survived > "$0.descendant-survived") &\nexit 0`,
			async (binary) => {
				const marker = `${binary}.descendant-survived`;
				const config = {
					review: { agent: "omp" as const, binary, model: "saved-model" },
				};
				const originalConfig = structuredClone(config);
				await expect(discoverOmpModels(config)).rejects.toThrow(
					"timed out after 5000 ms",
				);

				await Bun.sleep(2_500);
				expect(existsSync(marker)).toBe(false);
				expect(config).toEqual(originalConfig);
			},
		);
	});

	test("terminates oversized OMP processes without changing settings", async () => {
		for (const [stream, script] of [
			["stdout", "exec yes x"],
			["stderr", "exec yes x 1>&2"],
		] as const) {
			await withTemporaryExecutable(script, async (binary) => {
				const config = {
					review: { agent: "omp" as const, binary, model: "saved-model" },
				};
				const originalConfig = structuredClone(config);
				await expect(discoverOmpModels(config)).rejects.toThrow(
					`${stream} exceeded 2 MiB`,
				);
				expect(config).toEqual(originalConfig);
			});
		}
	});

	test("rejects oversized runner output without changing configured settings", async () => {
		const config = {
			review: {
				agent: "omp" as const,
				binary: "omp-custom",
				model: "saved-model",
			},
		};
		const originalConfig = structuredClone(config);
		const oversized = {
			stdout: new Uint8Array(OMP_MODEL_CATALOG_MAX_OUTPUT_BYTES + 1),
			stderr: new Uint8Array(OMP_MODEL_CATALOG_MAX_OUTPUT_BYTES + 1),
			exitCode: 0,
		};
		await expect(
			discoverOmpModels(config, recordingRunner(oversized, [])),
		).rejects.toThrow("stdout exceeded 2 MiB");
		expect(config).toEqual(originalConfig);
		await expect(
			discoverOmpModels(
				config,
				recordingRunner(
					{
						stdout: new Uint8Array(0),
						stderr: new Uint8Array(OMP_MODEL_CATALOG_MAX_OUTPUT_BYTES + 1),
						exitCode: 0,
					},
					[],
				),
			),
		).rejects.toThrow("stderr exceeded 2 MiB");
		expect(config).toEqual(originalConfig);
	});
});

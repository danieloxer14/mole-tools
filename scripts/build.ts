import tailwind from "bun-plugin-tailwind";

const result = await Bun.build({
	entrypoints: ["./src/index.tsx"],
	target: "bun",
	plugins: [tailwind],
	compile: { target: "bun-darwin-arm64", outfile: "./mole-tools" },
});

if (!result.success) {
	for (const log of result.logs) console.error(String(log));
	process.exit(1);
}

import { z } from "zod";

export const costSourceSchema = z.enum(["actual", "estimated", "zero", "unavailable"]);
export type CostSource = z.infer<typeof costSourceSchema>;

export const usageSchema = z.object({
	inputTokens: z.number().int().nonnegative(),
	outputTokens: z.number().int().nonnegative(),
	cacheReadTokens: z.number().int().nonnegative(),
	cacheWriteTokens: z.number().int().nonnegative(),
	source: z.enum(["reported", "estimated"]),
}).strict();
export type Usage = z.infer<typeof usageSchema>;

const pricedUsdCostSchema = z.object({
	source: z.enum(["actual", "estimated", "zero"]),
	amount: z.number().finite().nonnegative(),
});
const unavailableUsdCostSchema = z.object({
	source: z.literal("unavailable"),
}).strict();
export const usdCostSchema = z.discriminatedUnion("source", [
	pricedUsdCostSchema.extend({ source: z.literal("actual") }).strict(),
	pricedUsdCostSchema.extend({ source: z.literal("estimated") }).strict(),
	pricedUsdCostSchema.extend({ source: z.literal("zero") }).strict(),
	unavailableUsdCostSchema,
]);
export type UsdCost = z.infer<typeof usdCostSchema>;

export const costEntrySchema = z.object({
	type: z.literal("llm"),
	task: z.string().min(1),
	provider: z.string().min(1),
	model: z.string().min(1),
	providerSessionId: z.string().min(1).optional(),
	usage: usageSchema.optional(),
	usdCost: usdCostSchema,
	accountingDiagnostic: z.string().min(1).optional(),
}).strict();
export type CostEntry = z.infer<typeof costEntrySchema>;

import type { z } from "zod";
import type { Context } from "./context";

export interface FeatureHelp {
	usage?: string;
	examples?: string[];
	notes?: string[];
}

export interface Feature<A extends z.ZodTypeAny = z.ZodTypeAny, R = unknown> {
	name: string;
	description: string;
	args: A;
	help?: FeatureHelp;
	run(ctx: Context, args: z.input<A>): Promise<R>;
}

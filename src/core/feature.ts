import type { z } from "zod";
import type { Context } from "./context";

export interface Feature<A extends z.ZodTypeAny = z.ZodTypeAny, R = unknown> {
	name: string;
	description: string;
	args: A;
	run(ctx: Context, args: z.infer<A>): Promise<R>;
}

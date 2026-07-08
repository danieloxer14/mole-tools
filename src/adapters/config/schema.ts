import { z } from "zod";

export const ConfigSchema = z.object({
	ollama: z.object({
		commitModel: z.string(),
		mrModel: z.string().optional(),
		baseUrl: z.string(),
	}),
	commitSystemPrompt: z.string(),
	mrSystemPrompt: z.string().optional(),
	jira: z.object({
		enabled: z.boolean(),
		url: z.string().optional(),
		apiKey: z.string().optional(),
		branchPattern: z.string(),
	}),
	diff: z.object({
		ignore: z.array(z.string()),
	}),
	dynamicEnvRepos: z.array(z.string()).optional(),
	autoReviewer: z
		.object({
			username: z.string(),
		})
		.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

import { z } from "zod";

export const FEATURE_FLAGS = [
	{
		id: "layer-importance",
		label: "File important",
		description:
			"Score each changed line span 1–5 with a concise reason and colour diff gutters, layer file pills, and changed files from cool blue (skip) to red (critical).",
		defaultEnabled: false,
	},
	{
		id: "one-pager",
		label: "One pager",
		description:
			"Switch Overview between the MR description and an agent-written one-page summary of the MR, with a chat agent that answers questions and, with Claude or Codex, can edit the summary in place.",
		defaultEnabled: false,
	},
] as const;

export type FeatureFlagId = (typeof FEATURE_FLAGS)[number]["id"];
const FEATURE_FLAG_IDS = FEATURE_FLAGS.map((flag) => flag.id) as [
	FeatureFlagId,
	...FeatureFlagId[],
];
export const FeatureFlagIdSchema = z.enum(FEATURE_FLAG_IDS);

export type FeatureFlagValues = Record<FeatureFlagId, boolean>;

export interface FeatureFlagView {
	id: FeatureFlagId;
	label: string;
	description: string;
	enabled: boolean;
}

export function defaultFeatureFlagValues(): FeatureFlagValues {
	return Object.fromEntries(
		FEATURE_FLAGS.map((flag) => [flag.id, flag.defaultEnabled]),
	) as FeatureFlagValues;
}

export function featureFlagViews(values: FeatureFlagValues): FeatureFlagView[] {
	return FEATURE_FLAGS.map(({ id, label, description }) => ({
		id,
		label,
		description,
		enabled: values[id],
	}));
}

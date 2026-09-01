import { commit } from "../features/commit";
import { init } from "../features/init";
import { mergeRequest } from "../features/merge-request";
import { reviewFeature } from "../features/review";
import { reviewBabysitter } from "../features/review-babysitter";
import { worktreePrune } from "../features/worktree-prune";
import type { Feature } from "./feature";

export const features: Feature[] = [
	commit,
	init,
	mergeRequest,
	worktreePrune,
	reviewFeature,
	reviewBabysitter,
];

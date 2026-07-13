import { commit } from "../features/commit";
import { costBreakdown } from "../features/cost-breakdown";
import { init } from "../features/init";
import { mergeRequest } from "../features/merge-request";
import { ralph } from "../features/ralph";
import type { Feature } from "./feature";

export const features: Feature[] = [commit, init, costBreakdown, mergeRequest, ralph];

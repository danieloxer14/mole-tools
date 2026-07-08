import { commit } from "../features/commit";
import { init } from "../features/init";
import type { Feature } from "./feature";

export const features: Feature[] = [commit, init];

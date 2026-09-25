import type { SkillSummary } from "../../../shared/skills";
import { requestJson } from "./api-json";

export async function fetchSkills(token: string): Promise<SkillSummary[]> {
	return (await requestJson<{ skills: SkillSummary[] }>(token, "/api/skills"))
		.skills;
}

import { useEffect, useRef, useState } from "react";
import type { SkillSummary } from "../../../shared/skills";
import { fetchSkills } from "./skills-api";

export function useSkills(token: string, refreshKey: number): SkillSummary[] {
	const [skills, setSkills] = useState<SkillSummary[]>([]);
	const requestId = useRef(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey intentionally refetches skills.
	useEffect(() => {
		const currentRequestId = ++requestId.current;
		void fetchSkills(token)
			.then((nextSkills) => {
				if (requestId.current === currentRequestId) setSkills(nextSkills);
			})
			.catch(() => undefined);

		return () => {
			if (requestId.current === currentRequestId) requestId.current += 1;
		};
	}, [token, refreshKey]);

	return skills;
}

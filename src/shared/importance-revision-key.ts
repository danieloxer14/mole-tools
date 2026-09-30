export function importanceRevisionKey(revision: {
	headSha: string;
	mergeBaseSha: string;
}): string {
	return `${revision.headSha}:${revision.mergeBaseSha}`;
}

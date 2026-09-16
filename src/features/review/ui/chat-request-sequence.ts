export interface RequestSequence {
	next(key: string): number;
	isCurrent(key: string, requestId: number): boolean;
}

export function createRequestSequence(): RequestSequence {
	const current = new Map<string, number>();
	return {
		next(key) {
			const requestId = (current.get(key) ?? 0) + 1;
			current.set(key, requestId);
			return requestId;
		},
		isCurrent(key, requestId) {
			return current.get(key) === requestId;
		},
	};
}

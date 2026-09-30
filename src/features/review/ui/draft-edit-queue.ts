export interface DraftEditQueue {
	enqueue(id: string, operation: () => Promise<void>): Promise<void>;
	pending(id: string): Promise<void> | undefined;
}

export function createDraftEditQueue(): DraftEditQueue {
	const queues = new Map<string, Promise<void>>();

	return {
		enqueue(id, operation) {
			const previous = queues.get(id) ?? Promise.resolve();
			const queued = previous.catch(() => undefined).then(operation);
			queues.set(id, queued);
			void queued.then(
				() => {
					if (queues.get(id) === queued) queues.delete(id);
				},
				() => {
					if (queues.get(id) === queued) queues.delete(id);
				},
			);
			return queued;
		},
		pending(id) {
			return queues.get(id);
		},
	};
}

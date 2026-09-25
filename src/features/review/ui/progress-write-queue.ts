export interface ProgressWriteQueue {
	enqueue<T>(write: () => Promise<T>): Promise<T>;
}

export function createProgressWriteQueue(): ProgressWriteQueue {
	let tail = Promise.resolve();

	return {
		enqueue<T>(write: () => Promise<T>): Promise<T> {
			const current = tail.then(write);
			tail = current.then(
				() => undefined,
				() => undefined,
			);
			return current;
		},
	};
}

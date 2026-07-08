import type { UiPort } from "../ports/ui";

export class AbortError extends Error {}

export class UserRejectedError extends AbortError {}

export class PortError extends Error {
	readonly stderr?: string;
	readonly code: number;

	constructor(msg: string, stderr?: string, code = 1) {
		super(msg);
		this.stderr = stderr;
		this.code = code;
	}
}

export async function handleError(e: unknown, ui: UiPort): Promise<number> {
	if (e instanceof UserRejectedError) return 1;
	if (e instanceof AbortError) {
		await ui.error(e.message);
		return 1;
	}
	if (e instanceof PortError) {
		await ui.error(e.stderr ?? e.message);
		return e.code;
	}
	await ui.error(String(e));
	return 1;
}

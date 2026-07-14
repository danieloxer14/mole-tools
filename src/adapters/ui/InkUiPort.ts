import type { Choice, UiPort } from "../../ports/ui";
import type { UiController } from "./controller";

export class InkUiPort implements UiPort {
	constructor(private readonly controller: UiController) {}

	async info(text: string, opts?: { spinner?: boolean; terminal?: boolean }): Promise<void> {
		this.controller.pushLog("info", text, opts);
	}

	async warn(text: string): Promise<void> {
		this.controller.pushLog("warn", text);
	}

	async error(text: string): Promise<void> {
		this.controller.pushLog("error", text);
	}

	confirm(q: string): Promise<boolean> {
		return this.controller.request<boolean>((resolve) => ({
			kind: "confirm",
			q,
			resolve,
		}));
	}

	select<T>(q: string, opts: Choice<T>[]): Promise<T> {
		return this.controller.request<T>((resolve) => ({
			kind: "select",
			q,
			opts: opts as Choice<unknown>[],
			resolve,
		}));
	}

	multiSelect<T>(q: string, opts: Choice<T>[]): Promise<T[]> {
		return this.controller.request<T[]>((resolve) => ({
			kind: "multiSelect",
			q,
			opts: opts as Choice<unknown>[],
			resolve,
		}));
	}

	editText(prompt: string, initial: string): Promise<string> {
		return this.controller.request<string>((resolve) => ({
			kind: "editText",
			prompt,
			initial,
			resolve,
		}));
	}

	editMultiline(prompt: string, initial: string): Promise<string> {
		return this.controller.request<string>((resolve) => ({
			kind: "editMultiline",
			prompt,
			initial,
			resolve,
		}));
	}

	stream(source: AsyncIterable<string>, label?: string): Promise<string> {
		return this.controller.request<string>((resolve, reject) => ({
			kind: "stream",
			source,
			label,
			resolve,
			reject,
		}));
	}

	pause(message: string): Promise<void> {
		return this.controller.request<void>((resolve) => ({
			kind: "pause",
			message,
			resolve,
		}));
	}
}

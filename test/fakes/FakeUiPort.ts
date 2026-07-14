import type { Choice, UiPort } from "../../src/ports/ui";

export type ScriptEntry =
	| { confirm: boolean }
	| { select: unknown }
	| { multiSelect: unknown[] }
	| { editText: string }
	| { editMultiline: string };

type ScriptKey =
	| "confirm"
	| "select"
	| "multiSelect"
	| "editText"
	| "editMultiline";

export interface TranscriptEntry {
	kind: string;
	[key: string]: unknown;
}

export class FakeUiPort implements UiPort {
	transcript: TranscriptEntry[] = [];
	private readonly queue: ScriptEntry[];

	constructor(script: ScriptEntry[] = []) {
		this.queue = [...script];
	}

	private next<T>(methodName: ScriptKey): T {
		const entry = this.queue.shift();
		if (!entry || !(methodName in entry)) {
			throw new Error(
				`FakeUiPort: expected scripted answer for "${methodName}" but got ${JSON.stringify(entry)}`,
			);
		}
		return (entry as Record<ScriptKey, unknown>)[methodName] as T;
	}

	async info(
		text: string,
		opts?: { spinner?: boolean; terminal?: boolean },
	): Promise<void> {
		this.transcript.push({
			kind: "info",
			text,
			spinner: opts?.spinner,
			...(opts?.terminal ? { terminal: true } : {}),
		});
	}

	async warn(text: string): Promise<void> {
		this.transcript.push({ kind: "warn", text });
	}

	async error(text: string): Promise<void> {
		this.transcript.push({ kind: "error", text });
	}

	async confirm(q: string): Promise<boolean> {
		this.transcript.push({ kind: "confirm", q });
		return this.next<boolean>("confirm");
	}

	async select<T>(q: string, opts: Choice<T>[]): Promise<T> {
		this.transcript.push({ kind: "select", q, opts });
		return this.next<T>("select");
	}

	async multiSelect<T>(q: string, opts: Choice<T>[]): Promise<T[]> {
		this.transcript.push({ kind: "multiSelect", q, opts });
		return this.next<T[]>("multiSelect");
	}

	async editText(prompt: string, initial: string): Promise<string> {
		this.transcript.push({ kind: "editText", prompt, initial });
		return this.next<string>("editText");
	}

	async editMultiline(prompt: string, initial: string): Promise<string> {
		this.transcript.push({ kind: "editMultiline", prompt, initial });
		return this.next<string>("editMultiline");
	}

	async stream(source: AsyncIterable<string>, label?: string): Promise<string> {
		let acc = "";
		for await (const chunk of source) acc += chunk;
		this.transcript.push({ kind: "stream", label, text: acc });
		return acc;
	}

	async pause(message: string): Promise<void> {
		this.transcript.push({ kind: "pause", message });
	}
}

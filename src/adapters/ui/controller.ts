import type { Choice } from "../../ports/ui";

export interface LogEntry {
	id: number;
	level: "info" | "warn" | "error";
	text: string;
}

// biome-ignore lint/suspicious/noExplicitAny: resolve is invoked with the value the request kind expects; call sites (InkUiPort) keep that contract.
type Resolve = (v: any) => void;

export type Request =
	| { kind: "confirm"; q: string; resolve: Resolve }
	| { kind: "select"; q: string; opts: Choice<unknown>[]; resolve: Resolve }
	| {
			kind: "multiSelect";
			q: string;
			opts: Choice<unknown>[];
			resolve: Resolve;
	  }
	| { kind: "editText"; prompt: string; initial: string; resolve: Resolve }
	| { kind: "editMultiline"; prompt: string; initial: string; resolve: Resolve }
	| {
			kind: "stream";
			source: AsyncIterable<string>;
			label?: string;
			resolve: Resolve;
	  };

export class UiController {
	current: Request | null = null;
	log: LogEntry[] = [];

	private listeners = new Set<() => void>();

	subscribe = (fn: () => void): (() => void) => {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	};

	getSnapshot = (): Request | null => this.current;
	getLogSnapshot = (): LogEntry[] => this.log;

	request<T>(make: (resolve: (v: T) => void) => Request): Promise<T> {
		return new Promise((resolve) => {
			this.current = make(resolve);
			this.emit();
		});
	}

	resolveCurrent<T>(value: T): void {
		if (!this.current) return;
		const { resolve } = this.current;
		this.current = null;
		resolve(value);
		this.emit();
	}

	private nextLogId = 0;

	pushLog(level: LogEntry["level"], text: string): void {
		this.log = [...this.log, { id: this.nextLogId++, level, text }];
		this.emit();
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}
}

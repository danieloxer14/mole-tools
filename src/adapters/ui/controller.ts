import type { Choice } from "../../ports/ui";

export interface LogEntry {
	id: number;
	level: "info" | "warn" | "error";
	text: string;
	spinner?: boolean;
	terminal?: boolean;
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
			reject: (e: unknown) => void;
	  }
	| { kind: "pause"; message: string; resolve: Resolve };

function completedRequestText(request: Request, value: unknown): string {
	const question =
		request.kind === "editText" || request.kind === "editMultiline"
			? request.prompt
			: request.kind === "stream"
				? request.label
				: request.kind === "pause"
					? request.message
					: request.q;

	if (request.kind === "stream") {
		return [question ?? "", String(value)].filter(Boolean).join("\n");
	}
	if (request.kind === "pause") return question ?? "";
	if (request.kind === "confirm") {
		return `${question} → ${value ? "Yes" : "No"}`;
	}
	if (request.kind === "editText" || request.kind === "editMultiline") {
		return `${question} → ${String(value)}`;
	}
	if (request.kind === "multiSelect") {
		const selected = new Set(value as unknown[]);
		return `${question} → ${
			request.opts
				.filter((option) => selected.has(option.value))
				.map((option) => option.label)
				.join(", ") || "none"
		}`;
	}
	const option = request.opts.find((candidate) => candidate.value === value);
	return `${question} → ${option?.label ?? String(value)}`;
}

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

	request<T>(
		make: (resolve: (v: T) => void, reject: (e: unknown) => void) => Request,
	): Promise<T> {
		return new Promise((resolve, reject) => {
			let request: Request;
			const wrappedResolve = (v: T) => {
				this.current = null;
				this.pushLog("info", completedRequestText(request, v));
				resolve(v);
			};
			const wrappedReject = (e: unknown) => {
				this.current = null;
				reject(e);
				this.emit();
			};
			request = make(wrappedResolve, wrappedReject);
			this.current = request;
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

	pushLog(
		level: LogEntry["level"],
		text: string,
		opts?: { spinner?: boolean; terminal?: boolean },
	): void {
		this.log = [
			...this.log,
			{
				id: this.nextLogId++,
				level,
				text,
				...(opts?.spinner ? { spinner: true } : {}),
				...(opts?.terminal ? { terminal: true } : {}),
			},
		];
		this.emit();
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}
}

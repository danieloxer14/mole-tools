export interface Choice<T> {
	label: string;
	value: T;
}

export interface UiPort {
	info(text: string): Promise<void>;
	warn(text: string): Promise<void>;
	error(text: string): Promise<void>;
	confirm(q: string): Promise<boolean>;
	select<T>(q: string, opts: Choice<T>[]): Promise<T>;
	multiSelect<T>(q: string, opts: Choice<T>[]): Promise<T[]>;
	editText(prompt: string, initial: string): Promise<string>;
	editMultiline(prompt: string, initial: string): Promise<string>;
	stream(source: AsyncIterable<string>, label?: string): Promise<string>;
}

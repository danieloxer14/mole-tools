import type { Notifier } from "../../src/ports/notifier";

export interface FakeNotifierOptions {
	sendError?: Error;
}

export class FakeNotifier implements Notifier {
	readonly messages: string[] = [];

	constructor(private readonly options: FakeNotifierOptions = {}) {}

	async sendText(text: string): Promise<void> {
		this.messages.push(text);
		if (this.options.sendError) throw this.options.sendError;
	}
}

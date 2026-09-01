export interface Notifier {
	sendText(text: string): Promise<void>;
}

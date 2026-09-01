import { PortError } from "../../core/errors";
import type { Notifier } from "../../ports/notifier";

export interface SlackWebhookNotifierOptions {
	webhookUrlEnv: string;
}

export class SlackWebhookNotifier implements Notifier {
	private readonly webhookUrlEnv: string;

	constructor(options: SlackWebhookNotifierOptions) {
		this.webhookUrlEnv = options.webhookUrlEnv;
	}

	async sendText(text: string): Promise<void> {
		const configuredUrl = process.env[this.webhookUrlEnv];
		const webhookUrl = configuredUrl?.trim();
		if (!webhookUrl) {
			throw new PortError(
				`Missing Slack webhook environment variable: ${this.webhookUrlEnv}`,
			);
		}

		let response: Response;
		try {
			response = await fetch(webhookUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text }),
			});
		} catch {
			throw new PortError(
				"Slack webhook request failed: unable to reach endpoint",
			);
		}

		if (!response.ok) {
			throw new PortError(
				`Slack webhook request failed (${response.status})`,
				undefined,
				response.status,
			);
		}
	}
}

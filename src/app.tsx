import { render } from "ink";
import { UiController } from "./adapters/ui/controller";
import { InkUiPort } from "./adapters/ui/InkUiPort";
import { UiHost } from "./adapters/ui/UiHost";
import type { UiPort } from "./ports/ui";

export async function runInInk<R>(fn: (ui: UiPort) => Promise<R>): Promise<R> {
	const controller = new UiController();
	const ui = new InkUiPort(controller);
	const instance = render(<UiHost controller={controller} />);
	try {
		return await fn(ui);
	} finally {
		instance.unmount();
	}
}

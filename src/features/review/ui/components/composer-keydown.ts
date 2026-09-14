export interface ComposerEnterKey {
	key: string;
	shift: boolean;
	meta: boolean;
	ctrl: boolean;
	composing: boolean;
}

export interface ComposerEnterAction {
	/** Whether to cancel the Enter key's default action. */
	prevent: boolean;
	/** Whether to send the composer draft. */
	send: boolean;
}

/**
 * Key decision for the chat composer's textarea.
 *
 * Plain Enter sends. Shift+Enter falls through to the textarea's native
 * newline. (Ctrl|⌘)+Enter cancels the key's default action without sending:
 * the browser otherwise implicitly submits the form on that combination in a
 * textarea, and the submit behavior was deliberately removed. Enter while an
 * IME composition is in progress only confirms the composition.
 */
export function composerEnterAction(
	key: ComposerEnterKey,
): ComposerEnterAction {
	if (key.key !== "Enter" || key.composing)
		return { prevent: false, send: false };
	const send = !key.shift && !key.meta && !key.ctrl;
	return { prevent: send || key.meta || key.ctrl, send };
}

const MAX_DIAGNOSTIC_LENGTH = 2000;

/** Reduce provider/process failures to bounded, non-sensitive diagnostics. */
export function sanitizeDiagnostic(input: unknown): string {
	let text = input instanceof Error ? input.message : String(input ?? "unknown accounting failure");
	text = text
		.replace(/(?:\/tmp\/|\/var\/folders\/|\/private\/var\/folders\/)[^\s"']+/gi, "[temp-path]")
		.replace(/^\s*(?:authorization|proxy-authorization|x-api-key|api[-_ ]?key|token|password|secret)\s*[:=].*$/gmi, "[credential redacted]")
		.replace(/(?:prompt|session(?:[-_ ]?(?:id|content))?)\s*[:=][^\n]*/gi, "[sensitive content redacted]")
		.replace(/^\s*at\s+.*$/gm, "[stack omitted]")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return text.slice(0, MAX_DIAGNOSTIC_LENGTH);
}

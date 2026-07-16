import { sanitizeDiagnostic } from "./sanitizer";

/** Safe, typed boundary for provider accounting defects. */
export class CostAccountingError extends Error {
	readonly diagnostic: string;
	override readonly cause?: unknown;

	constructor(message: string, cause?: unknown) {
		super(sanitizeDiagnostic(message));
		this.name = "CostAccountingError";
		this.diagnostic = sanitizeDiagnostic(message);
		this.cause = cause;
	}
}

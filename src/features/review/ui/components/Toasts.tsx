export type ToastKind = "info" | "error";

export interface Toast {
	id: string;
	kind: ToastKind;
	message: string;
}

export function Toasts({
	toasts,
	onDismiss,
}: {
	toasts: Toast[];
	onDismiss: (id: string) => void;
}) {
	if (toasts.length === 0) return null;
	return (
		<div className="toast-stack">
			{toasts.map((toast) => (
				<div
					className={`toast toast-${toast.kind}`}
					key={toast.id}
					role={toast.kind === "error" ? "alert" : "status"}
				>
					<span>{toast.message}</span>
					<button
						type="button"
						aria-label="Dismiss"
						onClick={() => onDismiss(toast.id)}
					>
						Dismiss
					</button>
				</div>
			))}
		</div>
	);
}

export function refreshResultToast(
	stale: boolean,
): { kind: ToastKind; message: string } | null {
	return stale ? null : { kind: "info", message: "Up to date" };
}

export function errorToastMessage(reason: unknown): string {
	return reason instanceof Error ? reason.message : String(reason);
}

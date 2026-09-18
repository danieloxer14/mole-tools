import { Info, TriangleAlert, X } from "lucide-react";
import { IconButton } from "./IconButton";
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
		<div className="pointer-events-none fixed right-4 top-16 z-50 flex w-80 flex-col gap-2">
			{toasts.map((toast) => (
				<div
					className="pointer-events-auto flex items-start gap-2 rounded-md border bg-popover p-3 text-sm shadow-lg animate-in fade-in slide-in-from-right-4 duration-300 ease-out data-[kind=error]:border-destructive/40"
					data-kind={toast.kind}
					key={toast.id}
					role={toast.kind === "error" ? "alert" : "status"}
				>
					{toast.kind === "error" ? (
						<TriangleAlert
							className="mt-0.5 size-4 shrink-0 text-destructive"
							aria-hidden="true"
						/>
					) : (
						<Info
							className="mt-0.5 size-4 shrink-0 text-primary"
							aria-hidden="true"
						/>
					)}
					<span className="min-w-0 flex-1">{toast.message}</span>
					<IconButton label="Dismiss" onClick={() => onDismiss(toast.id)}>
						<X aria-hidden="true" />
					</IconButton>
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

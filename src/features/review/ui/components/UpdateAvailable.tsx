import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "./ui/dialog";

export const INSTALL_COMMAND =
	"curl -fsSL https://raw.githubusercontent.com/danieloxer14/mole-tools/main/install.sh | bash";

export function UpdateAvailable({
	current,
	latest,
}: {
	current: string;
	latest: string;
}) {
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState(false);
	const copyTimer = useRef<Timer | undefined>(undefined);

	const copy = () => {
		void navigator.clipboard.writeText(INSTALL_COMMAND).then(
			() => {
				setCopied(true);
				clearTimeout(copyTimer.current);
				copyTimer.current = setTimeout(() => setCopied(false), 1500);
			},
			() => undefined,
		);
	};

	useEffect(() => {
		return () => {
			clearTimeout(copyTimer.current);
		};
	}, []);

	return (
		<>
			<Button
				type="button"
				size="sm"
				variant="outline"
				data-update-available=""
				onClick={() => setOpen(true)}
			>
				Update {latest} available
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Update mole-tools</DialogTitle>
						<DialogDescription>
							mole-tools {latest} is available (installed {current}). Run this
							command in a terminal, then restart mole-tools review:
						</DialogDescription>
					</DialogHeader>
					<div className="flex min-w-0 items-start gap-2">
						<pre className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs">
							<code data-install-command="">{INSTALL_COMMAND}</code>
						</pre>
						<Button
							type="button"
							variant="outline"
							size="icon-sm"
							aria-label="Copy install command"
							onClick={copy}
						>
							{copied ? <Check aria-hidden /> : <Copy aria-hidden />}
						</Button>
					</div>
					<span className="sr-only" role="status" aria-live="polite">
						{copied ? "Install command copied to clipboard" : ""}
					</span>
				</DialogContent>
			</Dialog>
		</>
	);
}

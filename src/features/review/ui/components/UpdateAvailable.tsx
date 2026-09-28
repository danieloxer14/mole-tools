import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReleaseNotes } from "../../release-notes";
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

const UPDATE_INSTRUCTION =
	"Run the above command in a terminal, then restart mole-tools review";

export function UpdateAvailable({
	latest,
	releases,
	autoOpen,
	onAutoOpened,
}: {
	latest: string;
	releases: ReleaseNotes[];
	autoOpen: boolean;
	onAutoOpened: (version: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState(false);
	const copyTimer = useRef<Timer | undefined>(undefined);
	const acknowledgedVersions = useRef(new Set<string>());

	useEffect(() => {
		if (!autoOpen || acknowledgedVersions.current.has(latest)) return;
		if (!open) {
			setOpen(true);
			return;
		}

		acknowledgedVersions.current.add(latest);
		onAutoOpened(latest);
	}, [autoOpen, latest, onAutoOpened, open]);

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
				<DialogContent className="flex max-h-[calc(100dvh-2rem)] min-h-0 max-w-[calc(100%-2rem)] flex-col gap-4 overflow-hidden sm:max-w-3xl">
					<DialogHeader className="shrink-0 pr-8">
						<DialogTitle>{latest} is available</DialogTitle>
					</DialogHeader>
					<section
						aria-label="Release notes"
						data-release-notes=""
						className="min-h-0 max-h-[60dvh] flex-1 space-y-5 overflow-y-auto overscroll-contain pr-2"
					>
						{releases.map((release) => (
							<article
								key={release.version}
								data-release-entry={release.version}
								className="space-y-3"
							>
								<h3 className="font-medium">{release.version}</h3>
								<p>{release.description}</p>
								{(
									[
										["Features", release.features],
										["Improvements", release.improvements],
										["Fixes", release.fixes],
									] as const
								).map(([category, items]) =>
									items.length > 0 ? (
										<section
											key={category}
											aria-label={category}
											className="space-y-1"
										>
											<h4 className="font-medium">{category}</h4>
											<ul className="list-disc space-y-1 pl-5">
												{items.map((item) => (
													<li key={item}>{item}</li>
												))}
											</ul>
										</section>
									) : null,
								)}
							</article>
						))}
					</section>
					<div className="flex min-w-0 shrink-0 items-center gap-2">
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
					<DialogDescription className="shrink-0">
						{UPDATE_INSTRUCTION}
					</DialogDescription>
					<span className="sr-only" role="status" aria-live="polite">
						{copied ? "Install command copied to clipboard" : ""}
					</span>
				</DialogContent>
			</Dialog>
		</>
	);
}

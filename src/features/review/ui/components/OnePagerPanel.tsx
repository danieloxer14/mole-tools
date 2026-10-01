import type { OnePagerView } from "../use-one-pager";
import { type MarkdownBlockRange, MarkdownDocument } from "./MarkdownDocument";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

export interface OnePagerPanelProps {
	view: OnePagerView;
	onCreate(): void;
	onTagBlock(range: MarkdownBlockRange): void;
}

const centeredWrapperClassName =
	"flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center";

export function OnePagerPanel({
	view,
	onCreate,
	onTagBlock,
}: OnePagerPanelProps) {
	if (view.status === "loading") {
		return (
			<div className={centeredWrapperClassName}>
				<Spinner />
				<p>Loading one pager</p>
			</div>
		);
	}

	if (view.status === "running") {
		return (
			<div
				className={centeredWrapperClassName}
				role="status"
				aria-live="polite"
			>
				<Spinner aria-hidden="true" />
				<p>Creating your one pager</p>
				{view.error && <Alert variant="destructive">{view.error}</Alert>}
			</div>
		);
	}

	if (view.status === "idle") {
		return (
			<div className={centeredWrapperClassName}>
				{view.error && <Alert variant="destructive">{view.error}</Alert>}
				<p>Click here to create a one-page summary of this MR</p>
				<Button type="button" onClick={onCreate}>
					Create
				</Button>
			</div>
		);
	}

	return (
		<div>
			{view.error && <Alert variant="destructive">{view.error}</Alert>}
			<MarkdownDocument
				source={view.markdown ?? ""}
				policy={{ kind: "file" }}
				commentable={false}
				onTagBlock={onTagBlock}
			/>
		</div>
	);
}

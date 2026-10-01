import { RefreshCw, Tag } from "lucide-react";
import { useCallback } from "react";
import type { HostDiscussion } from "../../../../ports/git-host";
import type { DescriptionChatTag, OnePagerChatTag } from "../../chat-tags";
import type { OnePagerView } from "../use-one-pager";
import { GeneralDiscussionList } from "./GeneralDiscussions";
import { type MarkdownBlockRange, MarkdownDocument } from "./MarkdownDocument";
import { OnePagerPanel } from "./OnePagerPanel";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

export interface OverviewPaneProps {
	description: string;
	projectWebUrl: string;
	mediaToken: string;
	discussions: readonly HostDiscussion[];
	onTagDescription: (tag: DescriptionChatTag) => void;
	onExplainDiscussion?: (discussionId: string) => void;
	explainDisabled?: boolean;
	onePager?: {
		tab: OverviewTab;
		onTabChange(tab: OverviewTab): void;
		view: OnePagerView;
		onCreate(): void;
		onRegenerate(): void;
		onTagOnePager(tag: OnePagerChatTag): void;
	};
}

export type OverviewTab = "description" | "one-pager";

function DescriptionTagButton({
	description,
	onTagDescription,
}: {
	description: string;
	onTagDescription: OverviewPaneProps["onTagDescription"];
}) {
	if (description.trim() === "") return null;

	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			aria-label="Tag whole description"
			onClick={() =>
				onTagDescription({ kind: "description", quote: description })
			}
		>
			<Tag aria-hidden />
			Tag file
		</Button>
	);
}

function DescriptionContent({
	description,
	projectWebUrl,
	mediaToken,
	onTagBlock,
}: {
	description: string;
	projectWebUrl: string;
	mediaToken: string;
	onTagBlock: (range: MarkdownBlockRange) => void;
}) {
	return description.trim() !== "" ? (
		<MarkdownDocument
			source={description}
			policy={{ kind: "description", projectWebUrl, mediaToken }}
			commentable={false}
			onTagBlock={onTagBlock}
		/>
	) : (
		<p className="text-sm text-muted-foreground">No description provided.</p>
	);
}

function GeneralDiscussions({
	discussions,
	onExplainDiscussion,
	explainDisabled,
}: {
	discussions: readonly HostDiscussion[];
	onExplainDiscussion?: (discussionId: string) => void;
	explainDisabled: boolean;
}) {
	return (
		<section
			aria-labelledby="general-discussion-heading"
			className="mt-8 space-y-4"
		>
			<div className="flex items-center gap-2">
				<h2 id="general-discussion-heading" className="text-xl font-semibold">
					General discussion
				</h2>
				<Badge variant="outline">{discussions.length}</Badge>
			</div>
			{discussions.length > 0 ? (
				<GeneralDiscussionList
					discussions={discussions}
					onExplainDiscussion={onExplainDiscussion}
					explainDisabled={explainDisabled}
				/>
			) : (
				<p className="text-sm text-muted-foreground">
					No general discussion yet.
				</p>
			)}
		</section>
	);
}

export function OverviewPane({
	description,
	projectWebUrl,
	mediaToken,
	discussions,
	onTagDescription,
	onExplainDiscussion,
	explainDisabled = false,
	onePager,
}: OverviewPaneProps) {
	const tagBlock = useCallback(
		(range: MarkdownBlockRange) =>
			onTagDescription({ kind: "description", ...range }),
		[onTagDescription],
	);
	const tagOnePagerBlock = useCallback(
		(range: MarkdownBlockRange) =>
			onePager?.onTagOnePager({
				kind: "one-pager",
				startLine: range.startLine,
				endLine: range.endLine,
				quote: range.quote,
			}),
		[onePager],
	);

	if (onePager) {
		return (
			<section
				aria-label="Overview"
				className="flex min-h-0 min-w-0 flex-col overflow-y-auto"
			>
				<div className="w-full min-w-0 px-6 py-6">
					<Tabs
						value={onePager.tab}
						onValueChange={(value) => {
							if (value === "description" || value === "one-pager") {
								onePager.onTabChange(value);
							}
						}}
					>
						<div className="flex items-center justify-between gap-4">
							<TabsList aria-label="Overview sections">
								<TabsTrigger value="description">MR Description</TabsTrigger>
								<TabsTrigger value="one-pager">One pager</TabsTrigger>
							</TabsList>
							{onePager.tab === "description" ? (
								<DescriptionTagButton
									description={description}
									onTagDescription={onTagDescription}
								/>
							) : onePager.view.status === "ready" ? (
								<Button
									type="button"
									variant="secondary"
									size="sm"
									aria-label="Regenerate one pager"
									onClick={onePager.onRegenerate}
								>
									<RefreshCw aria-hidden />
									Regenerate
								</Button>
							) : null}
						</div>
						<TabsContent value="description">
							<section aria-label="MR Description" className="space-y-4">
								<DescriptionContent
									description={description}
									projectWebUrl={projectWebUrl}
									mediaToken={mediaToken}
									onTagBlock={tagBlock}
								/>
							</section>
							<GeneralDiscussions
								discussions={discussions}
								onExplainDiscussion={onExplainDiscussion}
								explainDisabled={explainDisabled}
							/>
						</TabsContent>
						<TabsContent value="one-pager">
							<OnePagerPanel
								view={onePager.view}
								onCreate={onePager.onCreate}
								onTagBlock={tagOnePagerBlock}
							/>
						</TabsContent>
					</Tabs>
				</div>
			</section>
		);
	}

	return (
		<section
			aria-label="Overview"
			className="flex min-h-0 min-w-0 flex-col overflow-y-auto"
		>
			<div className="w-full min-w-0 px-6 py-6">
				<section aria-labelledby="description-heading" className="space-y-4">
					<div className="flex items-center justify-between gap-4">
						<h2 id="description-heading" className="text-xl font-semibold">
							Description
						</h2>
						<DescriptionTagButton
							description={description}
							onTagDescription={onTagDescription}
						/>
					</div>
					<DescriptionContent
						description={description}
						projectWebUrl={projectWebUrl}
						mediaToken={mediaToken}
						onTagBlock={tagBlock}
					/>
				</section>

				<GeneralDiscussions
					discussions={discussions}
					onExplainDiscussion={onExplainDiscussion}
					explainDisabled={explainDisabled}
				/>
			</div>
		</section>
	);
}

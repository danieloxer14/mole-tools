import { MessageSquarePlus, Tag } from "lucide-react";
import { useCallback } from "react";
import type { HostDiscussion } from "../../../../ports/git-host";
import type { DescriptionChatTag } from "../../chat-tags";
import { type Draft, isGeneralSelection } from "../../state";
import { draftFromChat, type FromChatContext } from "../from-chat";
import { CommentDraft, type CommentDraftProps } from "./CommentDraft";
import { GeneralDiscussionList } from "./GeneralDiscussions";
import { type MarkdownBlockRange, MarkdownDocument } from "./MarkdownDocument";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export interface OverviewPaneProps {
	description: string;
	projectWebUrl: string;
	mediaToken: string;
	discussions: readonly HostDiscussion[];
	onTagDescription: (tag: DescriptionChatTag) => void;
	onExplainDiscussion?: (discussionId: string) => void;
	explainDisabled?: boolean;
	drafts?: readonly Draft[];
	commentComposer?: {
		onCreateGeneralComment: () => void;
		onCancelDraft: CommentDraftProps["onCancel"];
		onEditDraft: CommentDraftProps["onEdit"];
		onSendDraft: CommentDraftProps["onSend"];
		onRetryDraft: CommentDraftProps["onRetry"];
	};
	fromChat?: FromChatContext;
}

export function OverviewPane({
	description,
	projectWebUrl,
	mediaToken,
	discussions,
	onTagDescription,
	onExplainDiscussion,
	explainDisabled = false,
	drafts,
	commentComposer,
	fromChat,
}: OverviewPaneProps) {
	const hasDescription = description.trim() !== "";
	const tagBlock = useCallback(
		(range: MarkdownBlockRange) =>
			onTagDescription({ kind: "description", ...range }),
		[onTagDescription],
	);
	const generalDrafts = (drafts ?? []).filter(
		(draft) => draft.status !== "posted" && isGeneralSelection(draft.selection),
	);

	return (
		<section aria-label="Overview" className="flex min-h-0 min-w-0 flex-col">
			<div data-overview-scroll className="min-h-0 flex-1 overflow-y-auto">
				<div className="w-full min-w-0 px-6 py-6">
					<section aria-labelledby="description-heading" className="space-y-4">
						<div className="flex items-center justify-between gap-4">
							<h2 id="description-heading" className="text-xl font-semibold">
								Description
							</h2>
							{hasDescription ? (
								<Button
									type="button"
									variant="outline"
									size="sm"
									aria-label="Tag whole description"
									onClick={() =>
										onTagDescription({
											kind: "description",
											quote: description,
										})
									}
								>
									<Tag aria-hidden />
									Tag file
								</Button>
							) : null}
						</div>
						{hasDescription ? (
							<MarkdownDocument
								source={description}
								policy={{ kind: "description", projectWebUrl, mediaToken }}
								commentable={false}
								onTagBlock={tagBlock}
							/>
						) : (
							<p className="text-sm text-muted-foreground">
								No description provided.
							</p>
						)}
					</section>

					<section
						aria-labelledby="general-discussion-heading"
						className="mt-8 space-y-4"
					>
						<div className="flex items-center gap-2">
							<h2
								id="general-discussion-heading"
								className="text-xl font-semibold"
							>
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
				</div>
			</div>
			{commentComposer ? (
				<section
					aria-label="Merge request comment"
					className="shrink-0 border-t bg-card px-6 py-3"
				>
					{generalDrafts.length > 0 ? (
						<div className="max-h-[50vh] overflow-y-auto">
							{generalDrafts.map((draft) => (
								<CommentDraft
									key={draft.id}
									draft={draft}
									onCancel={commentComposer.onCancelDraft}
									onEdit={commentComposer.onEditDraft}
									onSend={commentComposer.onSendDraft}
									onRetry={commentComposer.onRetryDraft}
									fromChat={draftFromChat(fromChat, draft.id)}
								/>
							))}
						</div>
					) : (
						<Button
							type="button"
							variant="outline"
							className="w-full justify-start"
							onClick={commentComposer.onCreateGeneralComment}
						>
							<MessageSquarePlus aria-hidden />
							Comment on this merge request…
						</Button>
					)}
				</section>
			) : null}
		</section>
	);
}

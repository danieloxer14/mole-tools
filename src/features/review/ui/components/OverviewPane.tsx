import { Tag } from "lucide-react";
import { useCallback } from "react";
import type { HostDiscussion } from "../../../../ports/git-host";
import type { DescriptionChatTag } from "../../chat-tags";
import { GeneralDiscussionList } from "./GeneralDiscussions";
import { IconButton } from "./IconButton";
import { type MarkdownBlockRange, MarkdownDocument } from "./MarkdownDocument";
import { Badge } from "./ui/badge";

export interface OverviewPaneProps {
	description: string;
	projectWebUrl: string;
	discussions: readonly HostDiscussion[];
	onTagDescription: (tag: DescriptionChatTag) => void;
	onExplainDiscussion?: (discussionId: string) => void;
	explainDisabled?: boolean;
}

export function OverviewPane({
	description,
	projectWebUrl,
	discussions,
	onTagDescription,
	onExplainDiscussion,
	explainDisabled = false,
}: OverviewPaneProps) {
	const hasDescription = description.trim() !== "";
	const tagBlock = useCallback(
		(range: MarkdownBlockRange) =>
			onTagDescription({ kind: "description", ...range }),
		[onTagDescription],
	);

	return (
		<section
			aria-label="Overview"
			className="flex min-h-0 min-w-0 flex-col overflow-y-auto"
		>
			<div className="mx-auto w-full max-w-4xl px-6 py-6">
				<section aria-labelledby="description-heading" className="space-y-4">
					<div className="flex items-center gap-2">
						<h2 id="description-heading" className="text-base font-semibold">
							Description
						</h2>
						{hasDescription ? (
							<IconButton
								label="Tag whole description"
								tooltip="Add the whole merge request description to the active chat context"
								onClick={() =>
									onTagDescription({ kind: "description", quote: description })
								}
							>
								<Tag aria-hidden />
							</IconButton>
						) : null}
					</div>
					{hasDescription ? (
						<MarkdownDocument
							source={description}
							policy={{ kind: "description", projectWebUrl }}
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
							className="text-base font-semibold"
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
		</section>
	);
}

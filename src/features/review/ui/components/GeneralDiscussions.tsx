import { CircleCheck, CircleDot, Loader2, Sparkles } from "lucide-react";
import type { HostDiscussion } from "../../../../ports/git-host";
import { CommentMarkdown } from "./CommentMarkdown";
import { Button } from "./ui/button";

export function GeneralDiscussionList({
	discussions,
	onExplainDiscussion,
	explainDisabled = false,
}: {
	discussions: readonly HostDiscussion[];
	onExplainDiscussion?: (id: string) => void;
	explainDisabled?: boolean;
}) {
	return (
		<div className="min-w-0 max-w-full space-y-2">
			{discussions.map((discussion) => (
				<article
					className="min-w-0 max-w-full overflow-hidden rounded-md border border-l-2 bg-card p-3 shadow-xs data-[resolved=true]:border-l-success data-[resolved=false]:border-l-warning"
					key={discussion.id}
					data-discussion-id={discussion.id}
					data-resolved={discussion.resolved ? "true" : "false"}
				>
					<div className="flex min-w-0 flex-wrap items-start gap-2">
						{discussion.resolved ? (
							<CircleCheck
								className="mt-0.5 size-4 shrink-0 text-success"
								aria-hidden
							/>
						) : (
							<CircleDot
								className="mt-0.5 size-4 shrink-0 text-warning"
								aria-hidden
							/>
						)}
						<strong className="min-w-0 flex-1 break-words whitespace-normal text-sm font-medium [overflow-wrap:anywhere]">
							{discussion.resolved ? "Resolved" : "Unresolved"} discussion
						</strong>
						{onExplainDiscussion ? (
							<div
								className="flex min-w-0 shrink-0 items-center gap-1"
								data-action-group="discussion-actions"
							>
								<Button
									type="button"
									variant="default"
									size="xs"
									data-action="explain"
									disabled={explainDisabled}
									aria-busy={explainDisabled ? "true" : undefined}
									onClick={() => onExplainDiscussion(discussion.id)}
								>
									{explainDisabled ? (
										<Loader2 className="animate-spin" aria-hidden />
									) : (
										<Sparkles aria-hidden />
									)}
									Explain
								</Button>
							</div>
						) : null}
					</div>
					<div className="min-w-0 max-w-full divide-y divide-border">
						{discussion.notes.map((note) => (
							<div
								key={note.id}
								className="min-w-0 max-w-full overflow-hidden py-2 text-sm"
							>
								<div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-xs text-muted-foreground">
									<span className="min-w-0 break-words [overflow-wrap:anywhere]">
										{note.author}
									</span>
									<span className="break-words [overflow-wrap:anywhere]">
										· {new Date(note.createdAt).toLocaleTimeString()}
									</span>
								</div>
								<CommentMarkdown body={note.body} />
							</div>
						))}
					</div>
				</article>
			))}
		</div>
	);
}

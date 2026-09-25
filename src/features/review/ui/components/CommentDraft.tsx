import {
	Diff,
	Loader2,
	Pilcrow,
	RefreshCw,
	SendHorizontal,
	Sparkles,
	Square,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { type Draft, isMarkdownSelection } from "../../state";
import type { DraftGeneration, FromChatAvailability } from "../from-chat";
import { CommentMarkdown } from "./CommentMarkdown";
import { composerEnterAction } from "./composer-keydown";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import {
	SegmentedToggleGroup,
	SegmentedToggleGroupItem,
} from "./ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export interface CommentDraftProps {
	draft: Draft;
	onCancel: (id: string) => void;
	onEdit: (id: string, body: string) => void;
	onSend: (id: string) => void;
	onRetry: (id: string) => void;
	fromChat?: {
		availability: FromChatAvailability;
		generation: DraftGeneration | undefined;
		onGenerate: (id: string) => void;
		onStop: (id: string) => void;
	};
}

function statusLabel(status: Draft["status"]): string {
	if (status === "sending") return "Sending…";
	if (status === "failed") return "Failed";
	return "Draft";
}

function draftPositionLabel(draft: Draft): string {
	return isMarkdownSelection(draft.selection)
		? `${draft.filePath}:${draft.selection.startLine}-${draft.selection.endLine}`
		: `${draft.filePath}:${draft.selection.side}:${draft.selection.startLine}-${draft.selection.endLine}`;
}

export function CommentDraft({
	draft,
	onCancel,
	onEdit,
	onSend,
	onRetry,
	fromChat,
}: CommentDraftProps) {
	const [editing, setEditing] = useState(draft.body.trim().length === 0);
	const [body, setBody] = useState(draft.body);
	const hasBody = body.trim().length > 0;
	const canEdit = draft.status === "draft" || draft.status === "failed";
	const status =
		draft.status === "sending"
			? "sending"
			: draft.status === "failed"
				? "failed"
				: "draft";
	const generation = fromChat?.generation;
	const generationRunning = generation?.status === "running";
	const editorRef = useRef<HTMLTextAreaElement>(null);
	const previousDraftBody = useRef(draft.body);

	useEffect(() => {
		if (draft.body !== previousDraftBody.current) {
			previousDraftBody.current = draft.body;
			setBody(draft.body);
		} else if (!editing) {
			setBody(draft.body);
		}
	}, [draft.body, editing]);

	useEffect(() => {
		if (editing && canEdit && draft.body.trim().length === 0)
			editorRef.current?.focus();
	}, [canEdit, draft.body, editing]);

	useEffect(() => {
		if (!editing) setBody(draft.body);
	}, [draft.body, editing]);

	const updateBody = (value: string) => {
		setBody(value);
		onEdit(draft.id, value);
	};

	const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		const action = composerEnterAction({
			key: event.key,
			shift: event.shiftKey,
			meta: event.metaKey,
			ctrl: event.ctrlKey,
			composing: event.nativeEvent.isComposing,
		});
		if (action.prevent) event.preventDefault();
		if (action.send && hasBody && !generationRunning) onSend(draft.id);
	};

	return (
		<article
			className="min-w-0 max-w-full overflow-hidden rounded-md border border-primary/40 bg-card p-3 shadow-xs animate-in fade-in slide-in-from-top-1 duration-200 ease-out"
			data-draft-id={draft.id}
			data-status={status}
		>
			<header className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs">
				<strong className="shrink-0 font-medium">Draft comment</strong>
				<span className="min-w-0 flex-1 break-words whitespace-normal font-mono text-muted-foreground [overflow-wrap:anywhere]">
					{draftPositionLabel(draft)}
				</span>
				<div className="flex shrink-0 items-center gap-1">
					{status === "sending" ? (
						<Badge variant="outline">
							<Loader2 className="size-3.5 animate-spin" aria-hidden />
							{statusLabel(status)}
						</Badge>
					) : status === "failed" ? (
						<Badge variant="destructive">{statusLabel(status)}</Badge>
					) : (
						<Badge variant="secondary">{statusLabel(status)}</Badge>
					)}
					{canEdit ? (
						<SegmentedToggleGroup
							aria-label="Draft editor mode"
							multiple={false}
							value={[editing ? "write" : "preview"]}
							onValueChange={(values) => {
								const next = values[0];
								if (next === "preview") setEditing(false);
								if (next === "write") setEditing(true);
							}}
						>
							<Tooltip>
								<TooltipTrigger
									render={
										<SegmentedToggleGroupItem
											value="preview"
											aria-label="Preview"
											aria-pressed={!editing}
											data-state={!editing ? "on" : "off"}
										>
											<Pilcrow aria-hidden />
											<span className="sr-only">Preview</span>
										</SegmentedToggleGroupItem>
									}
								/>
								<TooltipContent>Preview</TooltipContent>
							</Tooltip>
							<Tooltip>
								<TooltipTrigger
									render={
										<SegmentedToggleGroupItem
											value="write"
											aria-label="Write"
											aria-pressed={editing}
											data-state={editing ? "on" : "off"}
										>
											<Diff aria-hidden />
											<span className="sr-only">Write</span>
										</SegmentedToggleGroupItem>
									}
								/>
								<TooltipContent>Write</TooltipContent>
							</Tooltip>
						</SegmentedToggleGroup>
					) : null}
				</div>
			</header>
			{editing && canEdit ? (
				<Textarea
					aria-label="Comment draft"
					className="mt-2 min-h-24 min-w-0 max-w-full font-mono text-sm"
					ref={editorRef}
					value={body}
					onChange={(event) => updateBody(event.target.value)}
					onKeyDown={handleEditorKeyDown}
					rows={4}
					disabled={generationRunning}
				/>
			) : (
				<div className="mt-2 min-w-0 max-w-full">
					<CommentMarkdown body={body} />
				</div>
			)}
			{draft.error ? (
				<Alert className="mt-2 min-w-0 max-w-full" variant="destructive">
					{draft.error}
				</Alert>
			) : null}
			{generation?.status === "failed" ? (
				<Alert className="mt-2 min-w-0 max-w-full" variant="destructive">
					Couldn't generate comment: {generation.error}
				</Alert>
			) : null}
			<div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
				<div className="min-w-0">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => onCancel(draft.id)}
					>
						Cancel
					</Button>
				</div>
				<div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
					{canEdit && fromChat ? (
						<Tooltip>
							<TooltipTrigger
								render={
									<Button
										type="button"
										variant="outline"
										size="sm"
										className={generationRunning ? "group w-36" : undefined}
										aria-label={
											generationRunning
												? "Stop generating comment"
												: "From chat"
										}
										aria-busy={generationRunning}
										onClick={() =>
											generationRunning
												? fromChat.onStop(draft.id)
												: fromChat.onGenerate(draft.id)
										}
										disabled={
											!generationRunning &&
											fromChat.availability.kind === "disabled"
										}
									>
										{generationRunning ? (
											<>
												<Loader2
													className="animate-spin group-hover:hidden group-focus-visible:hidden"
													aria-hidden
												/>
												<Square
													className="hidden group-hover:inline group-focus-visible:inline"
													aria-hidden
												/>
												<span className="group-hover:hidden group-focus-visible:hidden">
													Generating…
												</span>
												<span className="hidden group-hover:inline group-focus-visible:inline">
													Stop
												</span>
											</>
										) : (
											<>
												<Sparkles aria-hidden />
												From chat
											</>
										)}
									</Button>
								}
							/>
							<TooltipContent>
								{generationRunning
									? "Stop generating comment"
									: fromChat.availability.kind === "disabled"
										? fromChat.availability.reason
										: `Generate comment from ${fromChat.availability.chatLabel}`}
							</TooltipContent>
						</Tooltip>
					) : null}
					{status === "draft" ? (
						<Button
							type="button"
							size="sm"
							onClick={() => onSend(draft.id)}
							disabled={!hasBody || generationRunning}
						>
							<SendHorizontal aria-hidden />
							Send
						</Button>
					) : null}
					{status === "failed" ? (
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={() => onRetry(draft.id)}
						>
							<RefreshCw aria-hidden />
							Retry
						</Button>
					) : null}
				</div>
			</div>
		</article>
	);
}

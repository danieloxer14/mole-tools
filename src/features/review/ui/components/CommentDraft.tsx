import { Loader2, RefreshCw, SendHorizontal } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { type Draft, isMarkdownSelection } from "../../state";
import { CommentMarkdown } from "./CommentMarkdown";
import { composerEnterAction } from "./composer-keydown";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

export interface CommentDraftProps {
	draft: Draft;
	onCancel: (id: string) => void;
	onEdit: (id: string, body: string) => void;
	onSend: (id: string) => void;
	onRetry: (id: string) => void;
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
	const editorRef = useRef<HTMLTextAreaElement>(null);

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
		if (action.send && hasBody) onSend(draft.id);
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
			<div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => onCancel(draft.id)}
				>
					Cancel
				</Button>
				{canEdit ? (
					<ToggleGroup
						aria-label="Draft editor mode"
						multiple={false}
						value={[editing ? "write" : "preview"]}
						onValueChange={(values) => {
							const next = values[0];
							if (next === "preview") setEditing(false);
							if (next === "write") setEditing(true);
						}}
					>
						<ToggleGroupItem
							value="preview"
							aria-pressed={!editing}
							data-state={!editing ? "on" : "off"}
						>
							Preview
						</ToggleGroupItem>
						<ToggleGroupItem
							value="write"
							aria-pressed={editing}
							data-state={editing ? "on" : "off"}
						>
							Write
						</ToggleGroupItem>
					</ToggleGroup>
				) : null}
				{status === "draft" ? (
					<Button
						type="button"
						size="sm"
						onClick={() => onSend(draft.id)}
						disabled={!hasBody}
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
		</article>
	);
}

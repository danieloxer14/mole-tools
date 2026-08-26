import { useEffect, useRef, useState } from "react";
import { type Draft, isMarkdownSelection } from "../../state";

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

	return (
		<article
			className={`comment-draft comment-draft-${draft.status}`}
			data-draft-id={draft.id}
		>
			<header className="comment-draft-header">
				<strong>Draft comment</strong>
				<span>{statusLabel(draft.status)}</span>
			</header>
			<p className="comment-position">
				{isMarkdownSelection(draft.selection)
					? `${draft.filePath}:${draft.selection.startLine}-${draft.selection.endLine}`
					: `${draft.filePath}:${draft.selection.side}:${draft.selection.startLine}-${draft.selection.endLine}`}
			</p>
			{editing && canEdit ? (
				<textarea
					aria-label="Comment draft"
					className="comment-draft-editor"
					ref={editorRef}
					value={body}
					onChange={(event) => updateBody(event.target.value)}
					rows={4}
				/>
			) : (
				<p className="comment-draft-body">{body}</p>
			)}
			{draft.error ? (
				<p className="comment-draft-error" role="alert">
					{draft.error}
				</p>
			) : null}
			<div className="comment-draft-actions">
				<button type="button" onClick={() => onCancel(draft.id)}>
					Cancel
				</button>
				{canEdit ? (
					<button type="button" onClick={() => setEditing((value) => !value)}>
						{editing ? "Done editing" : "Edit"}
					</button>
				) : null}
				{draft.status === "draft" ? (
					<button
						type="button"
						onClick={() => onSend(draft.id)}
						disabled={!hasBody}
					>
						Send
					</button>
				) : null}
				{draft.status === "failed" ? (
					<button type="button" onClick={() => onRetry(draft.id)}>
						Retry
					</button>
				) : null}
			</div>
		</article>
	);
}

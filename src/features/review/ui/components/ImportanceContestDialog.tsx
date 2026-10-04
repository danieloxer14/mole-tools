import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ImportanceSpan } from "../../importance";
import { errorMessage } from "../api-json";
import { type ImportanceScore, importanceTitle } from "../importance";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Textarea } from "./ui/textarea";

export const IMPORTANCE_CONTEST_ISSUE_URL =
	"https://github.com/danieloxer14/mole-tools/issues/new?title=Importance%20contest";

type ImportanceContestTarget = { path: string; span: ImportanceSpan } | null;
type Stage = "form" | "report";
type CopyState = "idle" | "copied" | "failed";

export function ImportanceContestDialog({
	target,
	onClose,
	onSubmit,
	finalFocusTarget,
}: {
	target: ImportanceContestTarget;
	onClose: () => void;
	onSubmit: (score: ImportanceScore, reason: string) => Promise<string>;
	finalFocusTarget: () => HTMLElement | null;
}) {
	const [stage, setStage] = useState<Stage>("form");
	const [score, setScore] = useState<ImportanceScore>(target?.span.score ?? 1);
	const [submittedScore, setSubmittedScore] = useState<ImportanceScore | null>(
		null,
	);
	const [reason, setReason] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [report, setReport] = useState("");
	const [copyState, setCopyState] = useState<CopyState>("idle");
	const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	const submissionGeneration = useRef(0);
	const activeTarget = useRef(target);

	useLayoutEffect(() => {
		activeTarget.current = target;
		submissionGeneration.current++;
		return () => {
			submissionGeneration.current++;
		};
	}, [target]);

	useEffect(() => {
		setStage("form");
		if (target !== null) setScore(target.span.score);
		setSubmittedScore(null);
		setReason("");
		setPending(false);
		setError(null);
		setReport("");
		setCopyState("idle");
	}, [target]);

	useEffect(() => () => clearTimeout(copyTimer.current), []);

	const clearCopyTimer = () => {
		clearTimeout(copyTimer.current);
		copyTimer.current = undefined;
	};

	const submit = async () => {
		if (target === null) return;
		const submittedTarget = target;
		const generation = ++submissionGeneration.current;
		const trimmedReason = reason.trim();
		const nextScore = score;
		setSubmittedScore(nextScore);
		setPending(true);
		setError(null);
		try {
			const nextReport = await onSubmit(nextScore, trimmedReason);
			if (
				generation !== submissionGeneration.current ||
				activeTarget.current !== submittedTarget
			)
				return;
			setReport(nextReport);
			setCopyState("idle");
			setStage("report");
		} catch (submitError) {
			if (
				generation !== submissionGeneration.current ||
				activeTarget.current !== submittedTarget
			)
				return;
			setError(errorMessage(submitError));
		} finally {
			if (
				generation === submissionGeneration.current &&
				activeTarget.current === submittedTarget
			)
				setPending(false);
		}
	};

	const close = () => {
		if (pending) return;
		submissionGeneration.current++;
		onClose();
	};

	const copyReport = async () => {
		clearCopyTimer();
		try {
			await navigator.clipboard.writeText(report);
			setCopyState("copied");
			copyTimer.current = setTimeout(() => {
				copyTimer.current = undefined;
				setCopyState("idle");
			}, 1500);
		} catch {
			setCopyState("failed");
		}
	};

	const lines =
		target === null
			? ""
			: target.span.startLine === target.span.endLine
				? `${target.span.side} line ${target.span.startLine}`
				: `${target.span.side} lines ${target.span.startLine}–${target.span.endLine}`;
	const trimmedReason = reason.trim();
	const noChanges =
		target !== null &&
		score === target.span.score &&
		trimmedReason === target.span.reason;
	const submitDisabled = pending || trimmedReason.length === 0 || noChanges;

	return (
		<Dialog
			open={target !== null}
			onOpenChange={(open) => {
				if (!open && !pending) close();
			}}
		>
			<DialogContent
				className="sm:max-w-lg"
				showCloseButton={!pending}
				finalFocus={finalFocusTarget}
			>
				{target !== null && stage === "form" ? (
					<>
						<DialogHeader>
							<DialogTitle>Contest importance</DialogTitle>
							<DialogDescription>
								<span className="font-mono">{target.path}</span> · {lines}
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-1">
							<p className="font-medium">Current score</p>
							<p>{importanceTitle(target.span.score)}</p>
							<p>{target.span.reason}</p>
						</div>
						<div className="space-y-2">
							<label htmlFor="importance-contest-level">New level</label>
							<NativeSelect
								id="importance-contest-level"
								value={score}
								onChange={(event) =>
									setScore(Number(event.currentTarget.value) as ImportanceScore)
								}
							>
								{([1, 2, 3, 4, 5] as const).map((level) => (
									<NativeSelectOption key={level} value={level}>
										{importanceTitle(level)}
									</NativeSelectOption>
								))}
							</NativeSelect>
						</div>
						<div className="space-y-2">
							<label htmlFor="importance-contest-reason">New reason</label>
							<Input
								id="importance-contest-reason"
								maxLength={144}
								placeholder="One sentence, up to 144 characters"
								value={reason}
								onChange={(event) => setReason(event.currentTarget.value)}
							/>
						</div>
						{error !== null && <Alert variant="destructive">{error}</Alert>}
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={close}
								disabled={pending}
							>
								Cancel
							</Button>
							<Button
								type="button"
								disabled={submitDisabled}
								onClick={() => void submit()}
							>
								{pending ? "Submitting…" : "Submit"}
							</Button>
						</DialogFooter>
					</>
				) : target !== null ? (
					<>
						<DialogHeader>
							<DialogTitle>Contest report</DialogTitle>
						</DialogHeader>
						<p>
							Importance updated to {importanceTitle(submittedScore ?? score)}.
						</p>
						<Textarea
							readOnly
							aria-label="Contest report"
							rows={12}
							className="font-mono text-xs"
							value={report}
						/>
						<p>
							To submit this contest, copy the report and paste it into a new
							GitHub issue:{" "}
							<a
								href={IMPORTANCE_CONTEST_ISSUE_URL}
								target="_blank"
								rel="noreferrer"
							>
								open a mole-tools issue
							</a>
							. GitHub issues are public — remove confidential code, file paths,
							and names before posting.
						</p>
						<DialogFooter>
							<Button type="button" variant="outline" onClick={close}>
								Close
							</Button>
							<Button type="button" onClick={() => void copyReport()}>
								{copyState === "copied"
									? "Copied"
									: copyState === "failed"
										? "Copy failed"
										: "Copy report"}
							</Button>
						</DialogFooter>
					</>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

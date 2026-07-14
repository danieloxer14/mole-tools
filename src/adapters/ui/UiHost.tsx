import { Box, Static, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Choice } from "../../ports/ui";
import type { LogEntry, Request, UiController } from "./controller";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const requestIds = new WeakMap<object, number>();
let nextRequestId = 0;

function requestId(request: Request): number {
	let id = requestIds.get(request);
	if (id === undefined) {
		id = nextRequestId++;
		requestIds.set(request, id);
	}
	return id;
}

function useSpinnerFrame(active: boolean): string {
	const [frame, setFrame] = useState(0);
	useEffect(() => {
		if (!active) return;
		const interval = setInterval(() => {
			setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
		}, 80);
		return () => clearInterval(interval);
	}, [active]);
	return SPINNER_FRAMES[active ? frame : 0] as string;
}

function LogLine({ entry, active }: { entry: LogEntry; active: boolean }) {
	const color =
		entry.level === "error"
			? "red"
			: entry.level === "warn"
				? "yellow"
				: entry.terminal
					? "gray"
					: "white";
	const spinnerFrame = useSpinnerFrame(active);
	const [tool, ...details] = entry.text.split(" — ");
	return (
		<Text color={color}>
			{active ? `${spinnerFrame} ` : ""}
			{entry.terminal ? (
				<>
					<Text color="cyanBright">{tool}</Text>
					{details.length > 0 ? ` — ${details.join(" — ")}` : ""}
				</>
			) : (
				entry.text
			)}
		</Text>
	);
}

const CONFIRM_OPTIONS: Choice<boolean>[] = [
	{ label: "Yes", value: true },
	{ label: "No", value: false },
];

function SingleSelectList<T>({
	question,
	opts,
	onSelect,
}: {
	question: string;
	opts: Choice<T>[];
	onSelect: (value: T) => void;
}) {
	const [index, setIndex] = useState(0);
	useInput((_input, key) => {
		if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
		else if (key.downArrow) setIndex((i) => Math.min(opts.length - 1, i + 1));
		else if (key.return) {
			const opt = opts[index];
			if (opt) onSelect(opt.value);
		}
	});
	return (
		<Box flexDirection="column">
			<Text>{question}</Text>
			{opts.map((opt, i) => (
				<Text key={opt.label} color={i === index ? "cyan" : undefined}>
					{i === index ? "› " : "  "}
					{opt.label}
				</Text>
			))}
		</Box>
	);
}

function ConfirmView({ req }: { req: Extract<Request, { kind: "confirm" }> }) {
	return (
		<SingleSelectList
			question={req.q}
			opts={CONFIRM_OPTIONS}
			onSelect={req.resolve}
		/>
	);
}

function SelectView({ req }: { req: Extract<Request, { kind: "select" }> }) {
	return (
		<SingleSelectList question={req.q} opts={req.opts} onSelect={req.resolve} />
	);
}

function MultiSelectView({
	req,
}: {
	req: Extract<Request, { kind: "multiSelect" }>;
}) {
	const [index, setIndex] = useState(0);
	const [checked, setChecked] = useState<Set<number>>(new Set());
	useInput((input, key) => {
		if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
		else if (key.downArrow)
			setIndex((i) => Math.min(req.opts.length - 1, i + 1));
		else if (input === " ") {
			setChecked((prev) => {
				const next = new Set(prev);
				if (next.has(index)) next.delete(index);
				else next.add(index);
				return next;
			});
		} else if (key.return) {
			req.resolve([...checked].map((i) => req.opts[i]?.value));
		}
	});
	return (
		<Box flexDirection="column">
			<Text>{req.q}</Text>
			{req.opts.map((opt: Choice<unknown>, i: number) => (
				<Text key={opt.label} color={i === index ? "cyan" : undefined}>
					{checked.has(i) ? "[x] " : "[ ] "}
					{opt.label}
				</Text>
			))}
		</Box>
	);
}

function EditView({
	req,
	multiline,
}: {
	req: Extract<Request, { kind: "editText" | "editMultiline" }>;
	multiline: boolean;
}) {
	const [value, setValue] = useState(req.initial);
	return (
		<Box flexDirection="column">
			<Text>{req.prompt}</Text>
			<TextInput
				value={value}
				onChange={setValue}
				onSubmit={() => req.resolve(value)}
			/>
			{multiline ? (
				<Text color="gray">(single-line editor; press enter to submit)</Text>
			) : null}
		</Box>
	);
}

function StreamView({ req }: { req: Extract<Request, { kind: "stream" }> }) {
	const [text, setText] = useState("");
	const spinnerFrame = useSpinnerFrame(text.length === 0);
	useEffect(() => {
		let acc = "";
		let cancelled = false;
		(async () => {
			try {
				for await (const chunk of req.source) {
					if (cancelled) return;
					acc += chunk;
					setText(acc);
				}
				if (!cancelled) req.resolve(acc);
			} catch (e) {
				if (!cancelled) req.reject(e);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [req]);
	return (
		<Box flexDirection="column">
			{req.label ? (
				<Text color="gray">
					{text.length === 0 ? `${spinnerFrame} ` : ""}
					{req.label}
				</Text>
			) : null}
			<Text>{text}</Text>
		</Box>
	);
}

function PauseView({ req }: { req: Extract<Request, { kind: "pause" }> }) {
	useInput((_input, key) => {
		if (key.return) req.resolve(undefined);
	});
	return <Text color="gray">{req.message}</Text>;
}

function RequestView({ req }: { req: Request }) {
	switch (req.kind) {
		case "confirm":
			return <ConfirmView req={req} />;
		case "select":
			return <SelectView req={req} />;
		case "multiSelect":
			return <MultiSelectView req={req} />;
		case "editText":
			return <EditView req={req} multiline={false} />;
		case "editMultiline":
			return <EditView req={req} multiline={true} />;
		case "stream":
			return <StreamView req={req} />;
		case "pause":
			return <PauseView req={req} />;
	}
}

export function UiHost({ controller }: { controller: UiController }) {
	const request = useSyncExternalStore(
		controller.subscribe,
		controller.getSnapshot,
	);
	const log = useSyncExternalStore(
		controller.subscribe,
		controller.getLogSnapshot,
	);

	// Ink normally redraws the complete tree in place. Static keeps completed
	// output out of that redraw, so the terminal can retain it in scrollback.
	const activeSpinner =
		log.length > 0 && log[log.length - 1]?.spinner ? log.length - 1 : -1;
	const historicalLog = activeSpinner === -1 ? log : log.slice(0, -1);

	return (
		<Box flexDirection="column">
			<Static items={historicalLog}>
				{(entry) => <LogLine key={entry.id} entry={entry} active={false} />}
			</Static>
			{activeSpinner >= 0 ? (
				<LogLine entry={log[activeSpinner] as LogEntry} active />
			) : null}
			{request ? <RequestView key={requestId(request)} req={request} /> : null}
		</Box>
	);
}

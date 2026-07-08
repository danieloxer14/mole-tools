import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Choice } from "../../ports/ui";
import type { LogEntry, Request, UiController } from "./controller";

function LogLine({ entry }: { entry: LogEntry }) {
	const color =
		entry.level === "error"
			? "red"
			: entry.level === "warn"
				? "yellow"
				: "gray";
	return <Text color={color}>{entry.text}</Text>;
}

function ConfirmView({ req }: { req: Extract<Request, { kind: "confirm" }> }) {
	useInput((input, key) => {
		if (input.toLowerCase() === "y" || key.return) req.resolve(true);
		else if (input.toLowerCase() === "n") req.resolve(false);
	});
	return <Text>{req.q} (y/n)</Text>;
}

function SelectView({ req }: { req: Extract<Request, { kind: "select" }> }) {
	const [index, setIndex] = useState(0);
	useInput((_input, key) => {
		if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
		else if (key.downArrow)
			setIndex((i) => Math.min(req.opts.length - 1, i + 1));
		else if (key.return) req.resolve(req.opts[index]?.value);
	});
	return (
		<Box flexDirection="column">
			<Text>{req.q}</Text>
			{req.opts.map((opt: Choice<unknown>, i: number) => (
				<Text key={opt.label} color={i === index ? "cyan" : undefined}>
					{i === index ? "› " : "  "}
					{opt.label}
				</Text>
			))}
		</Box>
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
	useEffect(() => {
		let acc = "";
		let cancelled = false;
		(async () => {
			for await (const chunk of req.source) {
				if (cancelled) return;
				acc += chunk;
				setText(acc);
			}
			if (!cancelled) req.resolve(acc);
		})();
		return () => {
			cancelled = true;
		};
	}, [req]);
	return (
		<Box flexDirection="column">
			{req.label ? <Text color="gray">{req.label}</Text> : null}
			<Text>{text}</Text>
		</Box>
	);
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

	return (
		<Box flexDirection="column">
			{log.map((entry) => (
				<LogLine key={entry.id} entry={entry} />
			))}
			{request ? <RequestView req={request} /> : null}
		</Box>
	);
}

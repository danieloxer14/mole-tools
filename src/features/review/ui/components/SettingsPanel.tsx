import { useCallback, useEffect, useRef, useState } from "react";
import type { PromptName } from "../../../../adapters/prompts/defaults";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/native-select";
import { Separator } from "./ui/separator";
import { Textarea } from "./ui/textarea";
export const VISIBLE_SLOTS: readonly PromptName[] = [
	"review-layers-code",
	"review-layers-plan",
	"review-chat",
	"review-explain-comment",
];
export const MODEL_QUICK_PICKS: readonly string[] = ["sonnet", "opus", "fable"];

export const SLOT_LABELS: Record<PromptName, string> = {
	"commit-system": "Commit message",
	"mr-code": "Merge request (code)",
	"mr-plan": "Merge request (plan)",
	"review-layers-code": "Review layers (code)",
	"review-layers-plan": "Review layers (plan)",
	"review-chat": "Review chat",
	"review-explain-comment": "Explain review comment",
};
export const SLOT_DESCRIPTIONS: Record<PromptName, string> = {
	"commit-system":
		"System prompt for generating commit messages (`mole-tools commit`).",
	"mr-code":
		"Prompt for the merge request description in code mode (`mole-tools merge-request`).",
	"mr-plan":
		"Prompt for the merge request description in plan mode (`mole-tools merge-request --mode plan`).",
	"review-layers-code":
		"System prompt the review agent uses to build layered review guides from the code diff.",
	"review-layers-plan":
		"System prompt the review agent uses to build layered review guides when reviewing the MR's proposed change plan.",
	"review-chat":
		"Base system prompt for the review chat agent's replies to questions about the MR.",
	"review-explain-comment":
		"Prompt used by the review UI to explain a GitLab discussion in a new chat.",
};

type ReviewAgent = "omp" | "claude";

export interface SettingsSnapshot {
	slots: Array<{
		slot: PromptName;
		activePreset: string;
		presets: Array<{ name: string; latest: number }>;
	}>;
	review: {
		agent: ReviewAgent;
		model?: string;
		agents: string[];
	};
}

export interface PromptSnapshot {
	text: string;
	preset: string;
	version: number;
	versions: number[];
}

export interface SettingsPanelProps {
	token: string;
	onClose: () => void;
	initialSettings?: SettingsSnapshot;
	initialPrompt?: PromptSnapshot;
}

export function isSaveDisabled(
	loadedText: string,
	text: string,
	pending: boolean,
): boolean {
	return pending || text === loadedText;
}

function apiUrl(path: string, token: string): string {
	const separator = path.includes("?") ? "&" : "?";
	return `${path}${separator}t=${encodeURIComponent(token)}`;
}

function responseError(value: unknown): string | null {
	if (typeof value !== "object" || value === null || !("error" in value))
		return null;
	const error = value.error;
	return typeof error === "string" && error.length > 0 ? error : null;
}
function controlValue(event: unknown): string {
	if (
		typeof event !== "object" ||
		event === null ||
		!("currentTarget" in event)
	)
		return "";
	const target = event.currentTarget;
	if (
		typeof target !== "object" ||
		target === null ||
		!("value" in target) ||
		typeof target.value !== "string"
	)
		return "";
	return target.value;
}

function errorMessage(reason: unknown): string {
	return reason instanceof Error ? reason.message : String(reason);
}

async function requestJson<T>(
	token: string,
	path: string,
	init: RequestInit = {},
): Promise<T> {
	const headers = new Headers(init.headers);
	headers.set("X-Mole-Token", token);
	const response = await fetch(apiUrl(path, token), {
		...init,
		headers,
	});

	let value: unknown;
	try {
		value = await response.json();
	} catch {
		throw new Error(
			response.ok
				? "Response was not valid JSON"
				: `Request failed (${response.status})`,
		);
	}

	const payloadError = responseError(value);
	if (payloadError) throw new Error(payloadError);
	if (!response.ok) throw new Error(`Request failed (${response.status})`);
	return value as T;
}

function postJson<T>(token: string, path: string, body: unknown): Promise<T> {
	return requestJson<T>(token, path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

function slotLatest(slot: SettingsSnapshot["slots"][number]): number {
	return (
		slot.presets.find((preset) => preset.name === slot.activePreset)?.latest ??
		slot.presets.reduce((latest, preset) => Math.max(latest, preset.latest), 1)
	);
}

function clearPromptState(
	setPrompt: (value: PromptSnapshot | null) => void,
	setText: (value: string) => void,
	setLoadedText: (value: string) => void,
	setSelectedVersion: (value: number) => void,
): void {
	setPrompt(null);
	setText("");
	setLoadedText("");
	setSelectedVersion(0);
}

export function SettingsPanel({
	token,
	initialSettings,
	initialPrompt,
}: SettingsPanelProps) {
	const firstSlot: PromptName =
		initialSettings?.slots.find((slot) => VISIBLE_SLOTS.includes(slot.slot))
			?.slot ??
		VISIBLE_SLOTS[0] ??
		"review-layers-code";
	const initialSlotSettings = initialSettings?.slots.find(
		(slot) => slot.slot === firstSlot,
	);
	const [settings, setSettings] = useState<SettingsSnapshot | null>(
		initialSettings ?? null,
	);
	const [selectedSlot, setSelectedSlot] = useState<PromptName>(firstSlot);
	const [selectedPreset, setSelectedPreset] = useState(
		initialPrompt?.preset ?? initialSlotSettings?.activePreset ?? "default",
	);
	const [prompt, setPrompt] = useState<PromptSnapshot | null>(
		initialPrompt ?? null,
	);
	const [selectedVersion, setSelectedVersion] = useState(
		initialPrompt?.version ?? 0,
	);
	const [text, setText] = useState(initialPrompt?.text ?? "");
	const [loadedText, setLoadedText] = useState(initialPrompt?.text ?? "");
	const [newPreset, setNewPreset] = useState("");
	const [reviewAgent, setReviewAgent] = useState<ReviewAgent>(
		initialSettings?.review.agent ?? "claude",
	);
	const [reviewModel, setReviewModel] = useState(
		initialSettings?.review.model ?? "",
	);
	const [pending, setPending] = useState(false);
	const [status, setStatus] = useState<string | null>(null);
	const [settingsLoadFailed, setSettingsLoadFailed] = useState(false);
	const initialPromptConsumed = useRef(initialPrompt !== undefined);

	const loadPrompt = useCallback(
		async (
			slot: PromptName,
			preset: string,
			version?: number,
		): Promise<PromptSnapshot> => {
			const query = new URLSearchParams({ preset });
			if (version !== undefined) query.set("rev", String(version));
			const snapshot = await requestJson<PromptSnapshot>(
				token,
				`/api/prompts/${encodeURIComponent(slot)}?${query.toString()}`,
			);
			setPrompt(snapshot);
			setSelectedPreset(snapshot.preset);
			setSelectedVersion(snapshot.version);
			setText(snapshot.text);
			setLoadedText(snapshot.text);
			return snapshot;
		},
		[token],
	);

	const loadPromptWithPending = useCallback(
		async (
			slot: PromptName,
			preset: string,
			version?: number,
		): Promise<PromptSnapshot | null> => {
			setPending(true);
			setStatus(null);
			try {
				return await loadPrompt(slot, preset, version);
			} catch (reason: unknown) {
				setStatus(errorMessage(reason));
				return null;
			} finally {
				setPending(false);
			}
		},
		[loadPrompt],
	);

	const refreshSettings = useCallback(async (): Promise<SettingsSnapshot> => {
		const snapshot = await requestJson<SettingsSnapshot>(
			token,
			"/api/settings",
		);
		setSettings(snapshot);
		setReviewAgent(snapshot.review.agent);
		setReviewModel(snapshot.review.model ?? "");
		return snapshot;
	}, [token]);

	useEffect(() => {
		if (settings) return;
		let cancelled = false;
		setPending(true);
		setStatus(null);
		void refreshSettings()
			.then(() => {
				if (!cancelled) setSettingsLoadFailed(false);
			})
			.catch((reason: unknown) => {
				if (!cancelled) {
					setSettingsLoadFailed(true);
					setStatus(errorMessage(reason));
				}
			})
			.finally(() => {
				if (!cancelled) setPending(false);
			});
		return () => {
			cancelled = true;
		};
	}, [refreshSettings, settings]);

	useEffect(() => {
		if (!settings || initialPromptConsumed.current) return;
		initialPromptConsumed.current = true;
		const slotSettings = settings.slots.find(
			(slot) => slot.slot === selectedSlot,
		);
		const preset = slotSettings?.activePreset ?? "default";
		setSelectedPreset(preset);
		void loadPromptWithPending(selectedSlot, preset);
	}, [loadPromptWithPending, selectedSlot, settings]);

	const selectedSlotSettings = settings?.slots.find(
		(slot) => slot.slot === selectedSlot,
	);
	const latestVersion = prompt ? (prompt.versions.at(-1) ?? prompt.version) : 0;

	const handleSlotSelect = (slot: PromptName) => {
		if (!settings) return;
		const slotSettings = settings.slots.find((item) => item.slot === slot);
		const preset = slotSettings?.activePreset ?? "default";
		setSelectedSlot(slot);
		setSelectedPreset(preset);
		clearPromptState(setPrompt, setText, setLoadedText, setSelectedVersion);
		void loadPromptWithPending(slot, preset);
	};

	const handlePresetChange = (value: string) => {
		setSelectedPreset(value);
		clearPromptState(setPrompt, setText, setLoadedText, setSelectedVersion);
		void loadPromptWithPending(selectedSlot, value);
	};

	const handleVersionChange = (value: string) => {
		const version = Number(value);
		if (!Number.isSafeInteger(version) || version <= 0) return;
		setSelectedVersion(version);
		void loadPromptWithPending(selectedSlot, selectedPreset, version);
	};

	const handleSave = async () => {
		if (!prompt || isSaveDisabled(loadedText, text, pending)) return;
		setPending(true);
		setStatus(null);
		try {
			const result = await postJson<{ version: number; saved: boolean }>(
				token,
				`/api/prompts/${encodeURIComponent(selectedSlot)}`,
				{ preset: selectedPreset, text },
			);
			await refreshSettings();
			await loadPrompt(selectedSlot, selectedPreset);
			setStatus(`Saved v${result.version}`);
		} catch (reason: unknown) {
			setStatus(errorMessage(reason));
		} finally {
			setPending(false);
		}
	};

	const handleActivate = async () => {
		if (
			!selectedSlotSettings ||
			selectedPreset === selectedSlotSettings.activePreset
		)
			return;
		setPending(true);
		setStatus(null);
		try {
			await postJson<{ activePreset: string }>(
				token,
				`/api/prompts/${encodeURIComponent(selectedSlot)}/active`,
				{ preset: selectedPreset },
			);
			await refreshSettings();
			setStatus(`Activated ${selectedPreset}`);
		} catch (reason: unknown) {
			setStatus(errorMessage(reason));
		} finally {
			setPending(false);
		}
	};

	const handleCreatePreset = async () => {
		const name = newPreset.trim();
		if (!name) {
			setStatus("Preset name is required");
			return;
		}
		setPending(true);
		setStatus(null);
		try {
			await postJson<{ presets: string[] }>(
				token,
				`/api/prompts/${encodeURIComponent(selectedSlot)}/presets`,
				{ name, from: selectedPreset },
			);
			await refreshSettings();
			await loadPrompt(selectedSlot, name);
			setNewPreset("");
			setStatus(`Created ${name}`);
		} catch (reason: unknown) {
			setStatus(errorMessage(reason));
		} finally {
			setPending(false);
		}
	};

	const handleRollback = async () => {
		if (!prompt || selectedVersion === latestVersion) return;
		setPending(true);
		setStatus(null);
		try {
			const result = await postJson<{ version: number }>(
				token,
				`/api/prompts/${encodeURIComponent(selectedSlot)}/rollback`,
				{ preset: selectedPreset, rev: selectedVersion },
			);
			await refreshSettings();
			await loadPrompt(selectedSlot, selectedPreset);
			setStatus(`Rolled back to v${result.version}`);
		} catch (reason: unknown) {
			setStatus(errorMessage(reason));
		} finally {
			setPending(false);
		}
	};

	const handleReset = async () => {
		setPending(true);
		setStatus(null);
		try {
			const result = await postJson<{ version: number }>(
				token,
				`/api/prompts/${encodeURIComponent(selectedSlot)}/reset`,
				{ preset: selectedPreset },
			);
			await refreshSettings();
			await loadPrompt(selectedSlot, selectedPreset);
			setStatus(`Reset to shipped default v${result.version}`);
		} catch (reason: unknown) {
			setStatus(errorMessage(reason));
		} finally {
			setPending(false);
		}
	};

	const handleSaveReview = async () => {
		setPending(true);
		setStatus(null);
		try {
			const model = reviewModel.trim();
			const result = await postJson<{ agent: ReviewAgent; model?: string }>(
				token,
				"/api/settings/review",
				{ agent: reviewAgent, ...(model ? { model } : {}) },
			);
			await refreshSettings();
			setReviewAgent(result.agent);
			setReviewModel(result.model ?? "");
			setStatus("Saved review agent");
		} catch (reason: unknown) {
			setStatus(errorMessage(reason));
		} finally {
			setPending(false);
		}
	};

	return (
		<section className="flex h-full min-h-0 flex-col" aria-busy={pending}>
			<header className="flex items-start justify-between border-b px-6 py-4">
				<div>
					<p className="text-xs uppercase tracking-wider text-muted-foreground">
						Review settings
					</p>
					<h2 className="text-lg font-semibold">Settings</h2>
				</div>
			</header>
			{status ? (
				<Alert role="status" aria-live="polite" className="mx-6 mt-4">
					{status}
				</Alert>
			) : null}
			{!settings ? (
				<div className="flex-1 overflow-auto p-6">
					<Alert variant={settingsLoadFailed ? "destructive" : undefined}>
						{settingsLoadFailed ? "Settings unavailable." : "Loading settings…"}
					</Alert>
				</div>
			) : (
				<div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-4 overflow-auto p-6 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-6">
					<nav className="space-y-1" aria-label="Prompt slots">
						{settings.slots
							.filter((slot) => VISIBLE_SLOTS.includes(slot.slot))
							.map((slot) => (
								<button
									key={slot.slot}
									type="button"
									className="w-full rounded-md px-3 py-2 text-left transition-colors duration-150 ease-out hover:bg-muted/60 data-[active=true]:bg-accent"
									data-active={selectedSlot === slot.slot ? "true" : "false"}
									aria-current={selectedSlot === slot.slot ? "true" : undefined}
									disabled={pending}
									onClick={() => handleSlotSelect(slot.slot)}
								>
									<span className="block text-sm font-medium">
										{SLOT_LABELS[slot.slot]}
									</span>
									<span className="block text-xs text-muted-foreground">
										{slot.activePreset} · v{slotLatest(slot)}
									</span>
								</button>
							))}
					</nav>
					<section
						className="min-w-0 space-y-4"
						aria-label={SLOT_LABELS[selectedSlot]}
					>
						<p className="text-sm text-muted-foreground">
							{SLOT_DESCRIPTIONS[selectedSlot]}
						</p>
						{!prompt ? (
							<Alert>Loading prompt…</Alert>
						) : (
							<>
								<div className="flex flex-wrap items-center gap-2">
									<label
										className="w-24 shrink-0 text-xs font-medium"
										htmlFor="settings-preset"
									>
										Preset
									</label>
									<NativeSelect
										className="min-w-0 flex-1"
										id="settings-preset"
										size="sm"
										value={selectedPreset}
										disabled={pending}
										onChange={(event) =>
											handlePresetChange(controlValue(event))
										}
									>
										{(selectedSlotSettings?.presets ?? []).map((preset) => (
											<option key={preset.name} value={preset.name}>
												{preset.name}
												{preset.name === selectedSlotSettings?.activePreset
													? " (active)"
													: ""}
											</option>
										))}
									</NativeSelect>
									<Button
										size="sm"
										variant="secondary"
										disabled={
											pending ||
											selectedPreset === selectedSlotSettings?.activePreset
										}
										onClick={handleActivate}
									>
										Activate
									</Button>
								</div>

								<div className="flex flex-wrap items-center gap-2">
									<label
										className="w-24 shrink-0 text-xs font-medium"
										htmlFor="settings-new-preset"
									>
										New preset…
									</label>
									<Input
										id="settings-new-preset"
										className="h-8 min-w-0 flex-1"
										value={newPreset}
										disabled={pending}
										onChange={(event) => setNewPreset(controlValue(event))}
									/>
									<Button
										size="sm"
										variant="secondary"
										disabled={pending || newPreset.trim().length === 0}
										onClick={handleCreatePreset}
									>
										Create preset
									</Button>
								</div>

								<div className="flex flex-wrap items-center gap-2">
									<label
										className="w-24 shrink-0 text-xs font-medium"
										htmlFor="settings-version"
									>
										Version
									</label>
									<NativeSelect
										className="min-w-0 flex-1"
										id="settings-version"
										size="sm"
										value={String(selectedVersion)}
										disabled={pending}
										onChange={(event) =>
											handleVersionChange(controlValue(event))
										}
									>
										{[...prompt.versions]
											.sort((left, right) => right - left)
											.map((version) => (
												<option key={version} value={String(version)}>
													v{version}
												</option>
											))}
									</NativeSelect>
									{selectedVersion !== latestVersion ? (
										<Button
											size="sm"
											variant="outline"
											disabled={pending}
											onClick={handleRollback}
										>
											Roll back to this version
										</Button>
									) : null}
									<Button
										size="sm"
										variant="outline"
										disabled={pending}
										onClick={handleReset}
									>
										Reset to shipped default
									</Button>
								</div>

								<div className="space-y-2">
									<label
										className="text-sm font-medium"
										htmlFor="settings-prompt"
									>
										Prompt text
									</label>
									<Textarea
										id="settings-prompt"
										className="min-h-64 font-mono text-sm"
										value={text}
										disabled={pending}
										onChange={(event) => setText(controlValue(event))}
										rows={15}
									/>
								</div>
								<Button
									size="sm"
									disabled={isSaveDisabled(loadedText, text, pending)}
									onClick={handleSave}
								>
									Save as new version
								</Button>

								<section
									className="space-y-3"
									aria-labelledby="settings-review-agent-heading"
								>
									<Separator />
									<h3
										id="settings-review-agent-heading"
										className="text-sm font-medium"
									>
										Review agent
									</h3>
									<div className="flex flex-wrap items-center gap-2">
										<label
											className="w-24 shrink-0 text-xs font-medium"
											htmlFor="settings-agent"
										>
											Agent
										</label>
										<NativeSelect
											className="min-w-0 flex-1"
											id="settings-agent"
											size="sm"
											value={reviewAgent}
											disabled={pending}
											onChange={(event) =>
												setReviewAgent(
													controlValue(event) === "claude" ? "claude" : "omp",
												)
											}
										>
											{settings.review.agents.map((agent) => (
												<option key={agent} value={agent}>
													{agent}
												</option>
											))}
										</NativeSelect>
									</div>
									<div className="flex flex-wrap items-center gap-2">
										<label
											className="w-24 shrink-0 text-xs font-medium"
											htmlFor="settings-model"
										>
											Model
										</label>
										<Input
											id="settings-model"
											type="text"
											className="h-8 min-w-0 flex-1"
											value={reviewModel}
											disabled={pending}
											onChange={(event) => setReviewModel(controlValue(event))}
										/>
										<NativeSelect
											className="max-w-full shrink-0"
											id="settings-model-quickpick"
											aria-label="Model quick pick"
											size="sm"
											value={
												MODEL_QUICK_PICKS.includes(reviewModel)
													? reviewModel
													: ""
											}
											disabled={pending}
											onChange={(event) => {
												const value = controlValue(event);
												if (value !== "") setReviewModel(value);
											}}
										>
											<option value="">Custom…</option>
											{MODEL_QUICK_PICKS.map((model) => (
												<option key={model} value={model}>
													{model}
												</option>
											))}
										</NativeSelect>
									</div>
									<Button
										size="sm"
										disabled={pending}
										onClick={handleSaveReview}
									>
										Save review agent
									</Button>
									<p className="text-xs text-muted-foreground">
										Applies to the next layer run or chat turn. Use Regenerate
										to rebuild cached layers.
									</p>
									<p className="text-xs text-muted-foreground">
										Switching agents may restart existing chat sessions.
									</p>
								</section>
							</>
						)}
					</section>
				</div>
			)}
		</section>
	);
}

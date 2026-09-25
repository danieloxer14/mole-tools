import { useCallback, useEffect, useRef, useState } from "react";
import type { CodexModelChoice } from "../../../../adapters/agent/codex-models";
import type { PromptName } from "../../../../adapters/prompts/defaults";
import {
	PROMPT_AGENT_NAMES,
	type PromptAgentName,
} from "../../../../adapters/prompts/frontmatter";
import { controlValue, errorMessage, postJson, requestJson } from "../api-json";
import { AppearanceSettings } from "./AppearanceSettings";
import { SkillsSettings } from "./SkillsSettings";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/native-select";
import { Separator } from "./ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Textarea } from "./ui/textarea";
export const VISIBLE_SLOTS: readonly PromptName[] = [
	"review-layers-code",
	"review-layers-plan",
	"review-chat",
	"review-explain-comment",
	"review-comment-from-chat",
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
	"review-comment-from-chat": "Comment from chat",
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
	"review-comment-from-chat":
		"Turns the selected agent chat into a review comment when you click From chat in a comment draft.",
};

type ReviewAgent = PromptAgentName;
type PromptAgent = "default" | ReviewAgent;
function isReviewAgent(value: string): value is ReviewAgent {
	return (PROMPT_AGENT_NAMES as readonly string[]).includes(value);
}

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
	agent: ReviewAgent | null;
	model: string | null;
}

export interface SettingsPanelProps {
	token: string;
	onClose: () => void;
	initialSettings?: SettingsSnapshot;
	initialPrompt?: PromptSnapshot;
	initialTab?: "prompts" | "skills" | "appearance";
}

export interface PromptEditorValue {
	text: string;
	agent: PromptAgent;
	model: string;
}

export function isSaveDisabled(
	loaded: PromptEditorValue,
	current: PromptEditorValue,
	pending: boolean,
): boolean {
	return (
		pending ||
		(current.text === loaded.text &&
			current.agent === loaded.agent &&
			current.model.trim() === loaded.model.trim())
	);
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
	setPromptAgent: (value: PromptAgent) => void,
	setLoadedAgent: (value: PromptAgent) => void,
	setPromptModel: (value: string) => void,
	setLoadedModel: (value: string) => void,
): void {
	setPrompt(null);
	setText("");
	setLoadedText("");
	setSelectedVersion(0);
	setPromptAgent("default");
	setLoadedAgent("default");
	setPromptModel("");
	setLoadedModel("");
}

export function SettingsPanel({
	token,
	initialSettings,
	initialPrompt,
	initialTab,
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
	const [promptAgent, setPromptAgent] = useState<PromptAgent>(
		initialPrompt?.agent ?? "default",
	);
	const [promptModel, setPromptModel] = useState(initialPrompt?.model ?? "");
	const [loadedAgent, setLoadedAgent] = useState<PromptAgent>(
		initialPrompt?.agent ?? "default",
	);
	const [loadedModel, setLoadedModel] = useState(initialPrompt?.model ?? "");
	const [newPreset, setNewPreset] = useState("");
	const initialReviewAgent = initialSettings?.review.agent ?? "claude";
	const [reviewAgent, setReviewAgent] =
		useState<ReviewAgent>(initialReviewAgent);
	const [reviewModels, setReviewModels] = useState<
		Partial<Record<ReviewAgent, string>>
	>(() => ({
		[initialReviewAgent]: initialSettings?.review.model ?? "",
	}));
	const [codexModels, setCodexModels] = useState<CodexModelChoice[]>([]);
	const reviewModel = reviewModels[reviewAgent] ?? "";
	const [pending, setPending] = useState(false);
	const [status, setStatus] = useState<string | null>(null);
	const [settingsLoadFailed, setSettingsLoadFailed] = useState(false);
	const initialPromptConsumed = useRef(initialPrompt !== undefined);
	const reviewSettingsInitialized = useRef(initialSettings !== undefined);

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
			setPromptAgent(snapshot.agent ?? "default");
			setLoadedAgent(snapshot.agent ?? "default");
			setPromptModel(snapshot.model ?? "");
			setLoadedModel(snapshot.model ?? "");
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
		if (!reviewSettingsInitialized.current) {
			reviewSettingsInitialized.current = true;
			setReviewAgent(snapshot.review.agent);
			setReviewModels({
				[snapshot.review.agent]: snapshot.review.model ?? "",
			});
		}
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
		if (reviewAgent !== "codex") return;
		let active = true;
		void requestJson<{ models?: unknown }>(token, "/api/settings/codex-models")
			.then((snapshot) => {
				if (!active) return;
				setCodexModels(
					Array.isArray(snapshot.models)
						? snapshot.models.filter(
								(model): model is CodexModelChoice =>
									typeof model === "object" &&
									model !== null &&
									"id" in model &&
									typeof model.id === "string" &&
									"label" in model &&
									typeof model.label === "string",
							)
						: [],
				);
			})
			.catch(() => {
				if (active) setCodexModels([]);
			});
		return () => {
			active = false;
		};
	}, [reviewAgent, token]);

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
		clearPromptState(
			setPrompt,
			setText,
			setLoadedText,
			setSelectedVersion,
			setPromptAgent,
			setLoadedAgent,
			setPromptModel,
			setLoadedModel,
		);
		void loadPromptWithPending(slot, preset);
	};

	const handlePresetChange = (value: string) => {
		setSelectedPreset(value);
		clearPromptState(
			setPrompt,
			setText,
			setLoadedText,
			setSelectedVersion,
			setPromptAgent,
			setLoadedAgent,
			setPromptModel,
			setLoadedModel,
		);
		void loadPromptWithPending(selectedSlot, value);
	};

	const handleVersionChange = (value: string) => {
		const version = Number(value);
		if (!Number.isSafeInteger(version) || version <= 0) return;
		setSelectedVersion(version);
		void loadPromptWithPending(selectedSlot, selectedPreset, version);
	};

	const handleSave = async () => {
		if (
			!prompt ||
			isSaveDisabled(
				{ text: loadedText, agent: loadedAgent, model: loadedModel },
				{ text, agent: promptAgent, model: promptModel },
				pending,
			)
		)
			return;
		setPending(true);
		setStatus(null);
		try {
			const result = await postJson<{ version: number; saved: boolean }>(
				token,
				`/api/prompts/${encodeURIComponent(selectedSlot)}`,
				{
					preset: selectedPreset,
					text,
					agent: promptAgent === "default" ? null : promptAgent,
					model: promptModel.trim() || null,
				},
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
			setReviewModels((models) => ({
				...models,
				[result.agent]: result.model ?? "",
			}));
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
					<h2 className="text-2xl font-semibold">Settings</h2>
				</div>
			</header>
			<Tabs
				defaultValue={initialTab ?? "prompts"}
				className="min-h-0 flex-1 gap-0"
			>
				<TabsList aria-label="Settings sections" className="mx-6 mt-4">
					<TabsTrigger value="prompts">Prompts</TabsTrigger>
					<TabsTrigger value="skills">Skills</TabsTrigger>
					<TabsTrigger value="appearance">Appearance</TabsTrigger>
				</TabsList>
				<TabsContent value="prompts" className="flex flex-col">
					{status ? (
						<Alert role="status" aria-live="polite" className="mx-6 mt-4">
							{status}
						</Alert>
					) : null}
					{!settings ? (
						<div className="flex-1 overflow-auto p-6">
							<Alert variant={settingsLoadFailed ? "destructive" : undefined}>
								{settingsLoadFailed
									? "Settings unavailable."
									: "Loading settings…"}
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
											data-active={
												selectedSlot === slot.slot ? "true" : "false"
											}
											aria-current={
												selectedSlot === slot.slot ? "true" : undefined
											}
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

										<div className="flex flex-wrap items-center gap-2">
											<label
												className="w-24 shrink-0 text-xs font-medium"
												htmlFor="settings-prompt-agent"
											>
												Agent
											</label>
											<NativeSelect
												className="min-w-0 flex-1"
												id="settings-prompt-agent"
												size="sm"
												value={promptAgent}
												disabled={pending}
												onChange={(event) => {
													const value = controlValue(event);
													setPromptAgent(
														isReviewAgent(value) ? value : "default",
													);
												}}
											>
												<option value="default">
													Default ({settings.review.agent})
												</option>
												{PROMPT_AGENT_NAMES.map((agent) => (
													<option key={agent} value={agent}>
														{agent}
													</option>
												))}
											</NativeSelect>
										</div>

										<div className="flex flex-wrap items-center gap-2">
											<label
												className="w-24 shrink-0 text-xs font-medium"
												htmlFor="settings-prompt-model"
											>
												Model
											</label>
											<Input
												id="settings-prompt-model"
												type="text"
												className="h-8 min-w-0 flex-1"
												value={promptModel}
												placeholder={
													promptAgent === "default"
														? `Default (${settings.review.model ?? "agent default"})`
														: "Agent default"
												}
												disabled={pending}
												onChange={(event) =>
													setPromptModel(controlValue(event))
												}
											/>
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
											disabled={isSaveDisabled(
												{
													text: loadedText,
													agent: loadedAgent,
													model: loadedModel,
												},
												{ text, agent: promptAgent, model: promptModel },
												pending,
											)}
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
											<p className="text-xs text-muted-foreground">
												Default for prompt versions whose agent is Default.
											</p>
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
													onChange={(event) => {
														const value = controlValue(event);
														if (isReviewAgent(value)) setReviewAgent(value);
													}}
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
													placeholder={
														reviewAgent === "codex"
															? "Codex CLI default"
															: undefined
													}
													disabled={pending}
													onChange={(event) => {
														const value = controlValue(event);
														setReviewModels((models) => ({
															...models,
															[reviewAgent]: value,
														}));
													}}
												/>
												<NativeSelect
													className="max-w-full shrink-0"
													id="settings-model-quickpick"
													aria-label="Model quick pick"
													size="sm"
													value={
														reviewAgent === "codex"
															? reviewModel.trim()
																? reviewModel
																: ""
															: reviewAgent === "claude" &&
																	MODEL_QUICK_PICKS.includes(reviewModel)
																? reviewModel
																: ""
													}
													disabled={pending}
													onChange={(event) => {
														const value = controlValue(event);
														if (reviewAgent === "codex") {
															setReviewModels((models) => ({
																...models,
																[reviewAgent]: value,
															}));
														} else if (value !== "") {
															setReviewModels((models) => ({
																...models,
																[reviewAgent]: value,
															}));
														}
													}}
												>
													{reviewAgent === "codex" ? (
														<>
															<option value="">Codex CLI default</option>
															{codexModels.map((model) => (
																<option key={model.id} value={model.id}>
																	{model.label}
																</option>
															))}
															{reviewModel.trim() !== "" &&
																!codexModels.some(
																	(model) => model.id === reviewModel,
																) && (
																	<option value={reviewModel}>Custom…</option>
																)}
														</>
													) : (
														<>
															<option value="">Custom…</option>
															{reviewAgent === "claude" &&
																MODEL_QUICK_PICKS.map((model) => (
																	<option key={model} value={model}>
																		{model}
																	</option>
																))}
														</>
													)}
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
												Applies to the next layer run or chat turn. Use
												Regenerate to rebuild cached layers.
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
				</TabsContent>
				<TabsContent value="skills" className="flex min-h-0 flex-col">
					<SkillsSettings token={token} />
				</TabsContent>
				<TabsContent value="appearance" className="overflow-auto p-6">
					<AppearanceSettings token={token} />
				</TabsContent>
			</Tabs>
		</section>
	);
}

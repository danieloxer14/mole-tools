import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEffort } from "../../../../adapters/agent/effort";
import type { PromptName } from "../../../../adapters/prompts/defaults";
import { controlValue, errorMessage, postJson, requestJson } from "../api-json";
import { AppearanceSettings } from "./AppearanceSettings";
import { SkillsSettings } from "./SkillsSettings";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Textarea } from "./ui/textarea";
export const VISIBLE_SLOTS: readonly PromptName[] = [
	"review-layers-code",
	"review-layers-plan",
	"review-chat",
	"review-explain-comment",
	"review-comment-from-chat",
];

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

type ReviewAgent = "omp" | "claude";
type PromptAgent = "default" | ReviewAgent;
type SettingsTab = "general" | "prompts" | "skills" | "appearance";

interface ModelCatalogModel {
	id: string;
	label: string;
	efforts: string[];
}

interface ModelCatalog {
	models: ModelCatalogModel[];
	source: "omp" | "anthropic-api" | "claude-aliases";
	warning?: string;
}

interface LoadedModelCatalog extends ModelCatalog {
	agent: ReviewAgent;
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
		effort?: AgentEffort;
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
	effort: AgentEffort | null;
}

export interface SettingsPanelProps {
	token: string;
	onClose: () => void;
	initialSettings?: SettingsSnapshot;
	initialPrompt?: PromptSnapshot;
	initialTab?: SettingsTab;
}

export interface PromptEditorValue {
	text: string;
	agent: PromptAgent;
	model: string;
	effort: AgentEffort | "";
}

function compatibleEfforts(
	catalog: ModelCatalog | null,
	modelId: string,
): string[] {
	if (!catalog) return [];
	if (modelId)
		return catalog.models.find((model) => model.id === modelId)?.efforts ?? [];
	const firstModel = catalog.models[0];
	if (!firstModel) return [];
	return firstModel.efforts.filter((effort) =>
		catalog.models.every((model) => model.efforts.includes(effort)),
	);
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
			current.model.trim() === loaded.model.trim() &&
			current.effort === loaded.effort)
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
	setPromptEffort: (value: AgentEffort | "") => void,
	setLoadedEffort: (value: AgentEffort | "") => void,
): void {
	setPrompt(null);
	setText("");
	setLoadedText("");
	setSelectedVersion(0);
	setPromptAgent("default");
	setLoadedAgent("default");
	setPromptModel("");
	setLoadedModel("");
	setPromptEffort("");
	setLoadedEffort("");
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
	const [promptEffort, setPromptEffort] = useState<AgentEffort | "">(
		initialPrompt?.effort ?? "",
	);
	const [loadedAgent, setLoadedAgent] = useState<PromptAgent>(
		initialPrompt?.agent ?? "default",
	);
	const [loadedModel, setLoadedModel] = useState(initialPrompt?.model ?? "");
	const [loadedEffort, setLoadedEffort] = useState<AgentEffort | "">(
		initialPrompt?.effort ?? "",
	);
	const [newPreset, setNewPreset] = useState("");
	const [reviewAgent, setReviewAgent] = useState<ReviewAgent>(
		initialSettings?.review.agent ?? "claude",
	);
	const [reviewModel, setReviewModel] = useState(
		initialSettings?.review.model ?? "",
	);
	const [reviewEffort, setReviewEffort] = useState<AgentEffort | "">(
		initialSettings?.review.effort ?? "",
	);
	const [selectedTab, setSelectedTab] = useState<SettingsTab>(
		initialTab ?? "prompts",
	);
	const [modelCatalog, setModelCatalog] = useState<LoadedModelCatalog | null>(
		null,
	);
	const [catalogLoading, setCatalogLoading] = useState(false);
	const [catalogError, setCatalogError] = useState<string | null>(null);
	const [generalStatus, setGeneralStatus] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [status, setStatus] = useState<string | null>(null);
	const [settingsLoadFailed, setSettingsLoadFailed] = useState(false);
	const promptRequestId = useRef(0);
	const catalogRequestId = useRef(0);
	const initialPromptConsumed = useRef(initialPrompt !== undefined);
	const promptCatalogAgent: ReviewAgent =
		promptAgent === "default"
			? (settings?.review.agent ?? reviewAgent)
			: promptAgent;

	const loadPrompt = useCallback(
		async (
			slot: PromptName,
			preset: string,
			version?: number,
		): Promise<PromptSnapshot> => {
			const requestId = ++promptRequestId.current;
			const query = new URLSearchParams({ preset });
			if (version !== undefined) query.set("rev", String(version));
			const snapshot = await requestJson<PromptSnapshot>(
				token,
				`/api/prompts/${encodeURIComponent(slot)}?${query.toString()}`,
			);
			if (requestId !== promptRequestId.current) return snapshot;
			setPrompt(snapshot);
			setSelectedPreset(snapshot.preset);
			setSelectedVersion(snapshot.version);
			setText(snapshot.text);
			setLoadedText(snapshot.text);
			setPromptAgent(snapshot.agent ?? "default");
			setLoadedAgent(snapshot.agent ?? "default");
			setPromptModel(snapshot.model ?? "");
			setLoadedModel(snapshot.model ?? "");
			setPromptEffort(snapshot.effort ?? "");
			setLoadedEffort(snapshot.effort ?? "");
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
		setReviewEffort(snapshot.review.effort ?? "");
		return snapshot;
	}, [token]);

	const loadModelCatalog = useCallback(
		async (agent: ReviewAgent): Promise<void> => {
			const requestId = ++catalogRequestId.current;
			setCatalogLoading(true);
			setCatalogError(null);
			try {
				const snapshot = await requestJson<ModelCatalog>(
					token,
					`/api/settings/models?agent=${agent}`,
				);
				if (requestId !== catalogRequestId.current) return;
				setModelCatalog({ ...snapshot, agent });
			} catch (reason: unknown) {
				if (requestId === catalogRequestId.current)
					setCatalogError(errorMessage(reason));
			} finally {
				if (requestId === catalogRequestId.current) setCatalogLoading(false);
			}
		},
		[token],
	);

	const catalogAgent =
		selectedTab === "general"
			? reviewAgent
			: selectedTab === "prompts" && settings
				? promptCatalogAgent
				: null;
	useEffect(() => {
		if (!catalogAgent) return;
		void loadModelCatalog(catalogAgent);
		return () => {
			catalogRequestId.current += 1;
		};
	}, [catalogAgent, loadModelCatalog]);

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
		clearPromptState(
			setPrompt,
			setText,
			setLoadedText,
			setSelectedVersion,
			setPromptAgent,
			setLoadedAgent,
			setPromptModel,
			setLoadedModel,
			setPromptEffort,
			setLoadedEffort,
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
			setPromptEffort,
			setLoadedEffort,
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
			!promptEffortCompatible ||
			isSaveDisabled(
				{
					text: loadedText,
					agent: loadedAgent,
					model: loadedModel,
					effort: loadedEffort,
				},
				{ text, agent: promptAgent, model: promptModel, effort: promptEffort },
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
					effort: promptEffort || null,
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

	const selectedModelCatalog =
		modelCatalog?.agent === reviewAgent ? modelCatalog : null;
	const modelEfforts = compatibleEfforts(selectedModelCatalog, reviewModel);
	const visibleEfforts =
		reviewEffort && !modelEfforts.includes(reviewEffort)
			? [reviewEffort, ...modelEfforts]
			: modelEfforts;
	const promptModelCatalog =
		modelCatalog?.agent === promptCatalogAgent ? modelCatalog : null;
	const inheritedPromptModel =
		promptAgent === "default" ? (settings?.review.model ?? "") : "";
	const inheritedPromptEffort =
		promptAgent === "default" ? (settings?.review.effort ?? "") : "";
	const effectivePromptModel = promptModel || inheritedPromptModel;
	const promptModelEfforts = compatibleEfforts(
		promptModelCatalog,
		effectivePromptModel,
	);
	const inheritedPromptEffortCompatible =
		!inheritedPromptEffort ||
		!promptModel ||
		promptModelEfforts.includes(inheritedPromptEffort);
	const promptEffortCompatible =
		!promptEffort || promptModelEfforts.includes(promptEffort);
	const promptEffortNotice = !promptEffortCompatible
		? "The saved effort is not listed as compatible with this model. Choose Default or a supported effort before saving."
		: !promptEffort && inheritedPromptEffort && !inheritedPromptEffortCompatible
			? promptModelCatalog
				? "The selected model does not list the inherited effort as compatible; the agent default will be used."
				: catalogLoading
					? null
					: "Effort compatibility could not be confirmed; the inherited effort will not be sent."
			: null;

	const handlePromptAgentChange = (value: string) => {
		const agent: PromptAgent =
			value === "omp" || value === "claude" ? value : "default";
		if (agent === promptAgent) return;
		catalogRequestId.current += 1;
		setPromptAgent(agent);
		setPromptModel("");
		setPromptEffort("");
		setCatalogError(null);
	};

	const handlePromptModelChange = (value: string) => {
		setPromptModel(value);
	};

	const handlePromptEffortChange = (value: string) => {
		setPromptEffort(value as AgentEffort | "");
	};

	const handleReviewAgentChange = (value: string) => {
		const agent: ReviewAgent = value === "claude" ? "claude" : "omp";
		if (agent === reviewAgent) return;
		catalogRequestId.current += 1;
		setReviewAgent(agent);
		setReviewModel("");
		setReviewEffort("");
		setCatalogError(null);
		setGeneralStatus(null);
	};

	const handleReviewModelChange = (value: string) => {
		setReviewModel(value);
		setGeneralStatus(null);
		if (
			selectedModelCatalog &&
			reviewEffort &&
			!compatibleEfforts(selectedModelCatalog, value).includes(reviewEffort)
		) {
			setReviewEffort("");
		}
	};

	const handleSaveReview = async () => {
		setPending(true);
		setGeneralStatus(null);
		try {
			await postJson<{
				agent: ReviewAgent;
				model?: string;
				effort?: AgentEffort;
			}>(token, "/api/settings/review", {
				agent: reviewAgent,
				model: reviewModel.trim() || null,
				effort: reviewEffort || null,
			});
			await refreshSettings();
			setGeneralStatus("Saved review defaults");
		} catch (reason: unknown) {
			setGeneralStatus(errorMessage(reason));
		} finally {
			setPending(false);
		}
	};

	return (
		<section
			className="flex h-full min-h-0 min-w-0 flex-col"
			aria-busy={pending}
		>
			<header className="flex items-start justify-between border-b px-6 py-4">
				<div>
					<h2 className="text-2xl font-semibold">Settings</h2>
				</div>
			</header>
			<Tabs
				value={selectedTab}
				onValueChange={(value) => {
					if (
						value === "general" ||
						value === "prompts" ||
						value === "skills" ||
						value === "appearance"
					) {
						setSelectedTab(value);
					}
				}}
				className="min-h-0 flex-1 gap-0"
			>
				<TabsList
					aria-label="Settings sections"
					className="mx-6 mt-4 max-w-[calc(100%-3rem)] flex-wrap"
				>
					<TabsTrigger value="general">General</TabsTrigger>
					<TabsTrigger value="prompts">Prompts</TabsTrigger>
					<TabsTrigger value="skills">Skills</TabsTrigger>
					<TabsTrigger value="appearance">Appearance</TabsTrigger>
				</TabsList>
				<TabsContent value="general" className="min-h-0 overflow-auto p-6">
					{!settings ? (
						<Alert variant={settingsLoadFailed ? "destructive" : undefined}>
							{settingsLoadFailed
								? (status ?? "Settings unavailable.")
								: "Loading settings…"}
						</Alert>
					) : (
						<div className="space-y-4">
							<fieldset className="min-w-0 flex flex-wrap items-end gap-3">
								<legend className="sr-only">Review defaults</legend>
								<div className="min-w-[9rem] flex-1 space-y-2">
									<label
										className="text-xs font-medium"
										htmlFor="settings-default-agent"
									>
										Default Agent
									</label>
									<NativeSelect
										className="w-full"
										id="settings-default-agent"
										size="sm"
										value={reviewAgent}
										disabled={pending}
										onChange={(event) =>
											handleReviewAgentChange(controlValue(event))
										}
									>
										{settings.review.agents.map((agent) => (
											<option key={agent} value={agent}>
												{agent}
											</option>
										))}
									</NativeSelect>
								</div>
								<div className="min-w-[9rem] flex-1 space-y-2">
									<label
										className="text-xs font-medium"
										htmlFor="settings-default-model"
									>
										Default model
									</label>
									<NativeSelect
										className="w-full"
										id="settings-default-model"
										size="sm"
										value={reviewModel}
										disabled={pending}
										onChange={(event) =>
											handleReviewModelChange(controlValue(event))
										}
									>
										<option value="">Default (agent default)</option>
										{reviewModel &&
										!selectedModelCatalog?.models.some(
											(model) => model.id === reviewModel,
										) ? (
											<option value={reviewModel}>
												{reviewModel} (current custom model)
											</option>
										) : null}
										{selectedModelCatalog?.models.map((model) => (
											<option key={model.id} value={model.id}>
												{model.label === model.id
													? model.id
													: `${model.label} (${model.id})`}
											</option>
										))}
									</NativeSelect>
								</div>
								<div className="min-w-[9rem] flex-1 space-y-2">
									<label
										className="text-xs font-medium"
										htmlFor="settings-default-effort"
									>
										Default effort
									</label>
									<NativeSelect
										className="w-full"
										id="settings-default-effort"
										size="sm"
										value={reviewEffort}
										disabled={pending}
										onChange={(event) => {
											setReviewEffort(controlValue(event) as AgentEffort | "");
											setGeneralStatus(null);
										}}
									>
										<option value="">Default (agent default)</option>
										{visibleEfforts.map((effort) => (
											<option key={effort} value={effort}>
												{effort}
												{modelEfforts.includes(effort)
													? ""
													: " (current selection)"}
											</option>
										))}
									</NativeSelect>
								</div>
							</fieldset>
							{catalogLoading ? (
								<Alert role="status" aria-live="polite">
									Loading {reviewAgent} models…
								</Alert>
							) : null}
							{catalogError ? (
								<Alert variant="destructive">
									<div className="flex flex-wrap items-center justify-between gap-3">
										<span>{catalogError}</span>
										<Button
											size="sm"
											variant="outline"
											disabled={catalogLoading}
											onClick={() => void loadModelCatalog(reviewAgent)}
										>
											Retry
										</Button>
									</div>
								</Alert>
							) : null}
							{selectedModelCatalog ? (
								<div className="space-y-1">
									<p className="text-xs text-muted-foreground">
										Model catalog source:{" "}
										{selectedModelCatalog.source === "omp"
											? "configured OMP executable"
											: selectedModelCatalog.source === "anthropic-api"
												? "Anthropic API"
												: "Claude CLI aliases"}
										.
									</p>
									{selectedModelCatalog.warning ? (
										<Alert>{selectedModelCatalog.warning}</Alert>
									) : null}
								</div>
							) : null}
							<Button size="sm" disabled={pending} onClick={handleSaveReview}>
								Save
							</Button>
							{generalStatus ? (
								<Alert
									role="status"
									aria-live="polite"
									variant={
										generalStatus === "Saved review defaults"
											? undefined
											: "destructive"
									}
								>
									{generalStatus}
								</Alert>
							) : null}
						</div>
					)}
				</TabsContent>
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

										<fieldset className="min-w-0 flex flex-wrap items-end gap-3">
											<legend className="sr-only">
												Prompt agent, model, and effort
											</legend>
											<div className="min-w-[9rem] flex-1 space-y-2">
												<label
													className="text-xs font-medium"
													htmlFor="settings-prompt-agent"
												>
													Agent
												</label>
												<NativeSelect
													className="w-full"
													id="settings-prompt-agent"
													size="sm"
													value={promptAgent}
													disabled={pending}
													onChange={(event) =>
														handlePromptAgentChange(controlValue(event))
													}
												>
													<option value="default">
														Default ({settings.review.agent})
													</option>
													<option value="omp">omp</option>
													<option value="claude">claude</option>
												</NativeSelect>
											</div>
											<div className="min-w-[9rem] flex-1 space-y-2">
												<label
													className="text-xs font-medium"
													htmlFor="settings-prompt-model"
												>
													Model
												</label>
												<NativeSelect
													className="w-full"
													id="settings-prompt-model"
													size="sm"
													value={promptModel}
													disabled={pending}
													onChange={(event) =>
														handlePromptModelChange(controlValue(event))
													}
												>
													<option value="">
														Default ({inheritedPromptModel || "agent default"})
													</option>
													{promptModel &&
													!promptModelCatalog?.models.some(
														(model) => model.id === promptModel,
													) ? (
														<option value={promptModel}>
															{promptModel} (current custom model)
														</option>
													) : null}
													{promptModelCatalog?.models.map((model) => (
														<option key={model.id} value={model.id}>
															{model.label === model.id
																? model.id
																: `${model.label} (${model.id})`}
														</option>
													))}
												</NativeSelect>
											</div>
											<div className="min-w-[9rem] flex-1 space-y-2">
												<label
													className="text-xs font-medium"
													htmlFor="settings-prompt-effort"
												>
													Effort
												</label>
												<NativeSelect
													className="w-full"
													id="settings-prompt-effort"
													size="sm"
													value={promptEffortCompatible ? promptEffort : ""}
													disabled={pending}
													onChange={(event) =>
														handlePromptEffortChange(controlValue(event))
													}
												>
													<option value="">
														{promptEffortCompatible
															? `Default (${inheritedPromptEffortCompatible && inheritedPromptEffort ? inheritedPromptEffort : "agent default"})`
															: "Choose a compatible effort"}
													</option>
													{promptModelEfforts.map((effort) => (
														<option key={effort} value={effort}>
															{effort}
														</option>
													))}
												</NativeSelect>
											</div>
										</fieldset>
										{promptEffortNotice ? (
											<Alert role="status">{promptEffortNotice}</Alert>
										) : null}
										{catalogLoading ? (
											<Alert role="status" aria-live="polite">
												Loading {promptCatalogAgent} models…
											</Alert>
										) : null}
										{catalogError ? (
											<Alert variant="destructive">
												<div className="flex flex-wrap items-center justify-between gap-3">
													<span>{catalogError}</span>
													<Button
														size="sm"
														variant="outline"
														disabled={catalogLoading}
														onClick={() =>
															void loadModelCatalog(promptCatalogAgent)
														}
													>
														Retry
													</Button>
												</div>
											</Alert>
										) : null}
										{promptModelCatalog?.warning ? (
											<Alert>{promptModelCatalog.warning}</Alert>
										) : null}

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
											disabled={
												!promptEffortCompatible ||
												isSaveDisabled(
													{
														text: loadedText,
														agent: loadedAgent,
														model: loadedModel,
														effort: loadedEffort,
													},
													{
														text,
														agent: promptAgent,
														model: promptModel,
														effort: promptEffort,
													},
													pending,
												)
											}
											onClick={handleSave}
										>
											Save as new version
										</Button>
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

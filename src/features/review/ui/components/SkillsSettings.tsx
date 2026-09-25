import { Plus, Trash } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
	type SkillDetail,
	type SkillSummary,
	skillNameError,
} from "../../../../shared/skills";
import { controlValue, errorMessage, postJson, requestJson } from "../api-json";
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
import { NativeSelect } from "./ui/native-select";
import { Textarea } from "./ui/textarea";

export interface SkillsSettingsProps {
	token: string;
	initialSkills?: SkillSummary[];
	initialSkill?: SkillDetail;
}

function skillPath(name: string): string {
	return `/api/skills/${encodeURIComponent(name)}`;
}

export function SkillsSettings({
	token,
	initialSkills,
	initialSkill,
}: SkillsSettingsProps) {
	const [skills, setSkills] = useState<SkillSummary[] | null>(
		initialSkills ?? null,
	);
	const [selectedName, setSelectedName] = useState<string | null>(
		initialSkill?.name ?? initialSkills?.[0]?.name ?? null,
	);
	const [selected, setSelected] = useState<SkillDetail | null>(
		initialSkill ?? null,
	);
	const [selectedVersion, setSelectedVersion] = useState(
		initialSkill?.version ?? initialSkill?.activeVersion ?? 0,
	);
	const [editorText, setEditorText] = useState(initialSkill?.text ?? "");
	const [loadedText, setLoadedText] = useState(initialSkill?.text ?? "");
	const [pending, setPending] = useState(false);
	const [loadFailed, setLoadFailed] = useState(false);
	const [status, setStatus] = useState<string | null>(null);
	const [newSkillOpen, setNewSkillOpen] = useState(false);
	const [newSkillName, setNewSkillName] = useState("");
	const [newSkillTouched, setNewSkillTouched] = useState(false);
	const [newSkillError, setNewSkillError] = useState<string | null>(null);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const detailRequest = useRef(0);

	useEffect(() => {
		if (initialSkills !== undefined && initialSkill !== undefined) return;

		let cancelled = false;
		const request = ++detailRequest.current;
		const load = async () => {
			setPending(true);
			try {
				const loadedSkills =
					initialSkills ??
					(await requestJson<{ skills: SkillSummary[] }>(token, "/api/skills"))
						.skills;
				if (cancelled || request !== detailRequest.current) return;
				setSkills(loadedSkills);
				setLoadFailed(false);

				if (initialSkill) {
					setSelectedName(initialSkill.name);
					setSelected(initialSkill);
					setSelectedVersion(initialSkill.version);
					setEditorText(initialSkill.text);
					setLoadedText(initialSkill.text);
					return;
				}

				const firstSkill = loadedSkills[0];
				if (!firstSkill) {
					setSelectedName(null);
					setSelected(null);
					setSelectedVersion(0);
					setEditorText("");
					setLoadedText("");
					return;
				}

				setSelectedName(firstSkill.name);
				const detail = await requestJson<SkillDetail>(
					token,
					`/api/skills/${encodeURIComponent(firstSkill.name)}`,
				);
				if (cancelled || request !== detailRequest.current) return;
				setSelected(detail);
				setSelectedVersion(detail.version);
				setEditorText(detail.text);
				setLoadedText(detail.text);
			} catch (reason: unknown) {
				if (!cancelled && request === detailRequest.current) {
					if (initialSkills === undefined) setLoadFailed(true);
					setStatus(errorMessage(reason));
				}
			} finally {
				if (!cancelled && request === detailRequest.current) {
					setPending(false);
				}
			}
		};
		void load();

		return () => {
			cancelled = true;
			if (detailRequest.current === request) detailRequest.current += 1;
		};
	}, [initialSkill, initialSkills, token]);

	const loadDetail = async (name: string, version?: number) => {
		const request = ++detailRequest.current;
		setPending(true);
		setStatus(null);
		setSelectedName(name);
		setSelected(null);
		try {
			const detail = await requestJson<SkillDetail>(
				token,
				`${skillPath(name)}${version === undefined ? "" : `?version=${version}`}`,
			);
			if (request !== detailRequest.current) return;
			setSelected(detail);
			setSelectedVersion(detail.version);
			setEditorText(detail.text);
			setLoadedText(detail.text);
		} catch (reason: unknown) {
			if (request === detailRequest.current) setStatus(errorMessage(reason));
		} finally {
			if (request === detailRequest.current) setPending(false);
		}
	};

	const updateSummary = (
		name: string,
		update: (summary: SkillSummary) => SkillSummary,
	) => {
		setSkills(
			(current) =>
				current?.map((skill) =>
					skill.name === name ? update(skill) : skill,
				) ?? null,
		);
	};

	const closeNewSkillDialog = () => {
		setNewSkillOpen(false);
		setNewSkillName("");
		setNewSkillTouched(false);
		setNewSkillError(null);
	};

	const existingNames = skills?.map((skill) => skill.name) ?? [];
	const currentNameError = skillNameError(newSkillName, existingNames);
	const visibleNameError =
		newSkillError ?? (newSkillTouched ? currentNameError : null);
	const inactiveVersion =
		selected !== null && selectedVersion !== selected.activeVersion;
	const saveDisabled = pending || inactiveVersion || editorText === loadedText;

	const handleCreateSkill = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setNewSkillTouched(true);
		const validationError = skillNameError(newSkillName, existingNames);
		if (pending || validationError) return;

		setPending(true);
		setStatus(null);
		setNewSkillError(null);
		try {
			const { skill } = await postJson<{ skill: SkillSummary }>(
				token,
				"/api/skills",
				{ name: newSkillName },
			);
			const detail: SkillDetail = {
				name: skill.name,
				version: skill.activeVersion,
				text: "",
				activeVersion: skill.activeVersion,
				versions: skill.versions,
			};
			setSkills((current) => [...(current ?? []), skill]);
			setSelectedName(detail.name);
			setSelected(detail);
			setSelectedVersion(detail.version);
			setEditorText("");
			setLoadedText("");
			closeNewSkillDialog();
		} catch (reason: unknown) {
			setNewSkillError(errorMessage(reason));
		} finally {
			setPending(false);
		}
	};

	const handleActivate = async () => {
		if (!selected || pending || !inactiveVersion) return;
		setPending(true);
		setStatus(null);
		try {
			const result = await postJson<{ activeVersion: number }>(
				token,
				`${skillPath(selected.name)}/active`,
				{ version: selectedVersion },
			);
			setSelected({ ...selected, activeVersion: result.activeVersion });
			updateSummary(selected.name, (skill) => ({
				...skill,
				activeVersion: result.activeVersion,
			}));
		} catch (reason: unknown) {
			setStatus(errorMessage(reason));
		} finally {
			setPending(false);
		}
	};

	const handleNewVersion = async () => {
		if (!selected || pending) return;
		setPending(true);
		setStatus(null);
		try {
			const result = await postJson<{ version: number }>(
				token,
				`${skillPath(selected.name)}/versions`,
				{ text: editorText },
			);
			const versions = [
				...new Set([...selected.versions, result.version]),
			].sort((left, right) => right - left);
			setSelected({
				...selected,
				version: result.version,
				activeVersion: result.version,
				versions,
				text: editorText,
			});
			setSelectedVersion(result.version);
			setLoadedText(editorText);
			updateSummary(selected.name, (skill) => ({
				...skill,
				activeVersion: result.version,
				versions,
			}));
		} catch (reason: unknown) {
			setStatus(errorMessage(reason));
		} finally {
			setPending(false);
		}
	};

	const handleSave = async () => {
		if (!selected || saveDisabled) return;
		setPending(true);
		setStatus(null);
		try {
			const result = await postJson<{ version: number }>(
				token,
				skillPath(selected.name),
				{ text: editorText },
			);
			setSelected({ ...selected, version: result.version, text: editorText });
			setSelectedVersion(result.version);
			setLoadedText(editorText);
		} catch (reason: unknown) {
			setStatus(errorMessage(reason));
		} finally {
			setPending(false);
		}
	};

	const handleDelete = async () => {
		if (!selectedName || pending) return;
		setPending(true);
		setStatus(null);
		try {
			await requestJson<{ deleted: boolean }>(token, skillPath(selectedName), {
				method: "DELETE",
			});
			const remaining = (skills ?? []).filter(
				(skill) => skill.name !== selectedName,
			);
			setSkills(remaining);
			setDeleteOpen(false);
			const next = remaining[0];
			if (next) {
				await loadDetail(next.name);
			} else {
				setSelectedName(null);
				setSelected(null);
				setSelectedVersion(0);
				setEditorText("");
				setLoadedText("");
			}
		} catch (reason: unknown) {
			setStatus(errorMessage(reason));
		} finally {
			setPending(false);
		}
	};

	return (
		<section className="flex h-full min-h-0 flex-col" aria-busy={pending}>
			{status ? (
				<Alert role="status" aria-live="polite" className="mx-6 mt-4">
					{status}
				</Alert>
			) : null}
			{skills === null ? (
				<div className="flex-1 overflow-auto p-6">
					<Alert variant={loadFailed ? "destructive" : undefined}>
						{loadFailed ? "Skills unavailable." : "Loading skills…"}
					</Alert>
				</div>
			) : (
				<div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] gap-4 overflow-auto p-6 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-6">
					<nav className="min-h-0 space-y-1 overflow-auto" aria-label="Skills">
						<Button
							type="button"
							variant="secondary"
							size="sm"
							className="sticky top-0 z-10 w-full justify-start bg-background"
							disabled={pending}
							onClick={() => {
								setNewSkillName("");
								setNewSkillTouched(false);
								setNewSkillError(null);
								setNewSkillOpen(true);
							}}
						>
							<Plus aria-hidden="true" />
							New skill
						</Button>
						{skills.map((skill) => (
							<button
								key={skill.name}
								type="button"
								className="w-full rounded-md px-3 py-2 text-left transition-colors duration-150 ease-out hover:bg-muted/60 data-[active=true]:bg-accent"
								data-active={selectedName === skill.name ? "true" : "false"}
								aria-current={selectedName === skill.name ? "true" : undefined}
								disabled={pending}
								onClick={() => {
									if (selectedName === skill.name) return;
									setSelectedVersion(0);
									setEditorText("");
									setLoadedText("");
									void loadDetail(skill.name);
								}}
							>
								<span className="block text-sm font-medium">{skill.name}</span>
								<span className="block text-xs text-muted-foreground">
									v{skill.activeVersion}
								</span>
							</button>
						))}
					</nav>

					<div className="min-h-0 min-w-0 md:border-l md:pl-6">
						{skills.length === 0 ? (
							<p className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
								No skills yet. Create one with New skill.
							</p>
						) : selected ? (
							<section className="min-h-0 min-w-0 space-y-4 overflow-auto">
								<div className="flex flex-wrap items-start justify-between gap-2">
									<h3 className="text-sm font-semibold">{selected.name}</h3>
									<Button
										type="button"
										variant="destructive"
										size="sm"
										disabled={pending}
										onClick={() => setDeleteOpen(true)}
									>
										<Trash aria-hidden="true" />
										Delete skill
									</Button>
								</div>
								<div className="flex flex-wrap items-center gap-2">
									<label
										className="w-24 shrink-0 text-xs font-medium"
										htmlFor="skill-version"
									>
										Version
									</label>
									<NativeSelect
										className="min-w-0 flex-1"
										id="skill-version"
										size="sm"
										value={String(selectedVersion)}
										disabled={pending}
										onChange={(event) => {
											const version = Number(controlValue(event));
											if (!Number.isSafeInteger(version) || version <= 0)
												return;
											setEditorText("");
											setLoadedText("");
											void loadDetail(selected.name, version);
										}}
									>
										{[...selected.versions]
											.sort((left, right) => right - left)
											.map((version) => (
												<option key={version} value={String(version)}>
													v{version}
													{version === selected.activeVersion
														? " (active)"
														: ""}
												</option>
											))}
									</NativeSelect>
									{inactiveVersion ? (
										<Button
											type="button"
											size="sm"
											variant="outline"
											disabled={pending}
											onClick={() => void handleActivate()}
										>
											Activate
										</Button>
									) : null}
									<Button
										type="button"
										variant="outline"
										disabled={pending}
										onClick={() => void handleNewVersion()}
									>
										New version
									</Button>
								</div>

								<div className="space-y-2">
									<label
										className="block text-sm font-medium"
										htmlFor="skill-text"
									>
										Skill prompt
									</label>
									<Textarea
										id="skill-text"
										className="min-h-64 font-mono text-sm"
										value={editorText}
										readOnly={inactiveVersion}
										disabled={pending}
										rows={15}
										onChange={(event) => setEditorText(controlValue(event))}
									/>
									{inactiveVersion ? (
										<p className="text-xs text-muted-foreground">
											Activate this version to edit it.
										</p>
									) : null}
								</div>
								<Button
									type="button"
									disabled={saveDisabled}
									onClick={() => void handleSave()}
								>
									Save
								</Button>
							</section>
						) : pending ? (
							<Alert>Loading skill…</Alert>
						) : (
							<Alert variant="destructive">Skill unavailable.</Alert>
						)}
					</div>
				</div>
			)}

			<Dialog
				open={newSkillOpen}
				onOpenChange={(open) => {
					if (open) setNewSkillOpen(true);
					else closeNewSkillDialog();
				}}
			>
				<DialogContent
					className="w-[min(calc(100vw-2rem),28rem)]"
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.preventDefault();
							event.stopPropagation();
							closeNewSkillDialog();
						}
					}}
				>
					<DialogHeader>
						<DialogTitle>New skill</DialogTitle>
					</DialogHeader>
					<form className="space-y-4" onSubmit={handleCreateSkill}>
						<div className="space-y-2">
							<label
								className="block text-sm font-medium"
								htmlFor="new-skill-name"
							>
								Skill name
							</label>
							<Input
								id="new-skill-name"
								value={newSkillName}
								disabled={pending}
								aria-invalid={visibleNameError ? true : undefined}
								aria-describedby={
									visibleNameError ? "new-skill-name-error" : undefined
								}
								onChange={(event) => {
									setNewSkillName(controlValue(event));
									setNewSkillTouched(true);
									setNewSkillError(null);
								}}
							/>
							<p
								id="new-skill-name-error"
								role={visibleNameError ? "alert" : undefined}
								className="h-12 text-sm leading-5 text-destructive"
							>
								{visibleNameError}
							</p>
						</div>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={closeNewSkillDialog}
							>
								Cancel
							</Button>
							<Button
								type="submit"
								disabled={pending || currentNameError !== null}
							>
								Create
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<DialogContent className="w-[min(calc(100vw-2rem),28rem)]">
					<DialogHeader>
						<DialogTitle>Delete skill {selectedName}?</DialogTitle>
						<DialogDescription>
							This removes the skill and all of its versions.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => setDeleteOpen(false)}
						>
							Cancel
						</Button>
						<Button
							type="button"
							variant="destructive"
							disabled={pending}
							onClick={() => void handleDelete()}
						>
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}

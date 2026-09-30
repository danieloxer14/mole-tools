import { useSyncExternalStore } from "react";
import type {
	FeatureFlagId,
	FeatureFlagView,
} from "../../../shared/feature-flags";
import { errorMessage, postJson, requestJson } from "./api-json";

export interface FeatureFlagsSnapshot {
	flags: FeatureFlagView[] | null;
	error: string | null;
}

let snapshot: FeatureFlagsSnapshot = { flags: null, error: null };
let confirmedFlags: FeatureFlagView[] | null = null;
const flagMutationVersions = new Map<FeatureFlagId, number>();
const flagMutationQueues = new Map<FeatureFlagId, Promise<void>>();
let nextMutationVersion = 0;
let nextLoadVersion = 0;
let flagMutationEpoch = 0;
let stateGeneration = 0;
const listeners = new Set<() => void>();

function emit(): void {
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function getSnapshot(): FeatureFlagsSnapshot {
	return snapshot;
}

function mergeFlag(
	flags: FeatureFlagView[] | null,
	flag: FeatureFlagView,
): FeatureFlagView[] {
	if (!flags) return [flag];
	return flags.some((current) => current.id === flag.id)
		? flags.map((current) => (current.id === flag.id ? flag : current))
		: [...flags, flag];
}

export async function loadFeatureFlags(token: string): Promise<void> {
	const loadVersion = ++nextLoadVersion;
	const loadGeneration = stateGeneration;
	const mutationEpoch = flagMutationEpoch;
	const isCurrent = () =>
		loadGeneration === stateGeneration &&
		loadVersion === nextLoadVersion &&
		mutationEpoch === flagMutationEpoch &&
		flagMutationQueues.size === 0;

	try {
		const response = await requestJson<{ flags: FeatureFlagView[] }>(
			token,
			"/api/features",
		);
		if (!isCurrent()) return;
		confirmedFlags = response.flags;
		snapshot = { flags: response.flags, error: null };
	} catch (reason) {
		if (!isCurrent()) return;
		snapshot = { flags: snapshot.flags, error: errorMessage(reason) };
	}
	emit();
}

export async function setFeatureFlag(
	token: string,
	id: FeatureFlagId,
	enabled: boolean,
): Promise<void> {
	const generation = stateGeneration;
	const version = ++nextMutationVersion;
	flagMutationVersions.set(id, version);
	const previousMutation = flagMutationQueues.get(id) ?? Promise.resolve();
	const mutation = previousMutation.then(async () => {
		if (generation !== stateGeneration) return;
		try {
			const response = await postJson<{ flags: FeatureFlagView[] }>(
				token,
				"/api/features",
				{ id, enabled },
			);
			if (generation !== stateGeneration) return;
			const confirmed = response.flags.find((flag) => flag.id === id);
			const hasOtherMutations = [...flagMutationQueues.keys()].some(
				(otherId) => otherId !== id,
			);
			const mergeOnlyFlag =
				hasOtherMutations && snapshot.flags !== null && confirmedFlags !== null;
			if (mergeOnlyFlag) {
				if (confirmed) confirmedFlags = mergeFlag(confirmedFlags, confirmed);
			} else confirmedFlags = response.flags;
			if (flagMutationVersions.get(id) === version) {
				snapshot = {
					flags:
						mergeOnlyFlag && confirmed
							? mergeFlag(snapshot.flags, confirmed)
							: response.flags,
					error: null,
				};
			}
		} catch (reason) {
			if (
				generation === stateGeneration &&
				flagMutationVersions.get(id) === version
			) {
				const confirmedEnabled = confirmedFlags?.find(
					(flag) => flag.id === id,
				)?.enabled;
				snapshot = {
					flags:
						confirmedEnabled === undefined || !snapshot.flags
							? snapshot.flags
							: snapshot.flags.map((flag) =>
									flag.id === id
										? { ...flag, enabled: confirmedEnabled }
										: flag,
								),
					error: errorMessage(reason),
				};
			}
			throw reason;
		}
	});
	const queueTail = mutation.then(
		() => undefined,
		() => undefined,
	);
	flagMutationQueues.set(id, queueTail);
	flagMutationEpoch++;
	if (snapshot.flags) {
		snapshot = {
			...snapshot,
			flags: snapshot.flags.map((flag) =>
				flag.id === id ? { ...flag, enabled } : flag,
			),
		};
		emit();
	}

	try {
		await mutation;
	} finally {
		if (generation === stateGeneration) {
			flagMutationEpoch++;
			if (flagMutationQueues.get(id) === queueTail)
				flagMutationQueues.delete(id);
			emit();
		}
	}
}

function getConfirmedFlags(): FeatureFlagView[] | null {
	return confirmedFlags;
}

export function useConfirmedFeatureFlags(): FeatureFlagView[] | null {
	return useSyncExternalStore(subscribe, getConfirmedFlags, getConfirmedFlags);
}

export function useConfirmedFeatureFlag(id: FeatureFlagId): boolean {
	const flags = useConfirmedFeatureFlags();
	return flags?.find((flag) => flag.id === id)?.enabled ?? false;
}

export function useFeatureFlags(): FeatureFlagsSnapshot {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function resetFeatureFlagsForTests(): void {
	snapshot = { flags: null, error: null };
	confirmedFlags = null;
	flagMutationVersions.clear();
	flagMutationQueues.clear();
	nextLoadVersion++;
	flagMutationEpoch++;
	stateGeneration++;
	emit();
}

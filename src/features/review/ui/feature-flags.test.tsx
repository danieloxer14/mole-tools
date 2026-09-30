import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FeatureFlagView } from "../../../shared/feature-flags";
import type { FeatureFlagsSnapshot } from "./feature-flags";
import {
	loadFeatureFlags,
	resetFeatureFlagsForTests,
	setFeatureFlag,
	useConfirmedFeatureFlag,
	useFeatureFlags,
} from "./feature-flags";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const originalFetch = globalThis.fetch;
const roots: Root[] = [];
const disabledFlag: FeatureFlagView = {
	id: "layer-importance",
	label: "Layer importance",
	description: "Score changed lines.",
	enabled: false,
};
const enabledFlag: FeatureFlagView = { ...disabledFlag, enabled: true };
function unregisteredFlag(id: string): FeatureFlagView {
	return {
		id,
		label: "Review chat",
		description: "Enable chat.",
		enabled: false,
	} as unknown as FeatureFlagView;
}

function response(value: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => value,
	} as Response;
}

function Consumers() {
	const enabled = useFeatureFlags().flags?.find(
		(flag) => flag.id === "layer-importance",
	)?.enabled;
	return <output>{String(enabled ?? false)}</output>;
}

function mountConsumers(): HTMLElement {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() =>
		root.render(
			<>
				<Consumers />
				<Consumers />
			</>,
		),
	);
	return container;
}

beforeEach(() => resetFeatureFlagsForTests());

afterEach(() => {
	for (const root of roots.splice(0)) act(() => root.unmount());
	document.body.replaceChildren();
	globalThis.fetch = originalFetch;
	resetFeatureFlagsForTests();
});
test("keeps optimistic checkbox state but exposes enabled only after POST confirms", async () => {
	let finishPost!: (value: Response) => void;
	const post = new Promise<Response>((resolve) => {
		finishPost = resolve;
	});
	const confirmedValues: boolean[] = [];
	function ConfirmedReader() {
		confirmedValues.push(useConfirmedFeatureFlag("layer-importance"));
		return null;
	}
	globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) =>
		init?.method === "POST"
			? post
			: response({ flags: [disabledFlag] })) as typeof fetch;
	const container = mountConsumers();
	const readerRoot = createRoot(document.createElement("div"));
	roots.push(readerRoot);
	act(() => readerRoot.render(<ConfirmedReader />));

	await act(async () => loadFeatureFlags("secret"));
	let toggle!: Promise<void>;
	act(() => {
		toggle = setFeatureFlag("secret", "layer-importance", true);
	});
	expect(container.querySelector("output")?.textContent).toBe("true");
	expect(confirmedValues.at(-1)).toBe(false);
	await act(async () => {
		finishPost(response({ flags: [enabledFlag] }));
		await toggle;
	});
	expect(confirmedValues.at(-1)).toBe(true);
});

test("serializes same-flag mutations and commits the last server response", async () => {
	let finishFirst!: (value: Response) => void;
	let finishSecond!: (value: Response) => void;
	let postCount = 0;
	const secondStarted = Promise.withResolvers<void>();
	const values = { confirmed: false, optimistic: false };
	function Reader() {
		const flags = useFeatureFlags().flags;
		values.confirmed = useConfirmedFeatureFlag("layer-importance");
		values.optimistic =
			flags?.find((flag) => flag.id === "layer-importance")?.enabled ?? false;
		return null;
	}
	globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
		if (init?.method !== "POST") return response({ flags: [disabledFlag] });
		postCount++;
		return new Promise<Response>((resolve) => {
			if (postCount === 1) finishFirst = resolve;
			else {
				finishSecond = resolve;
				secondStarted.resolve();
			}
		});
	}) as typeof fetch;
	const root = createRoot(document.createElement("div"));
	roots.push(root);
	act(() => root.render(<Reader />));
	await act(async () => loadFeatureFlags("secret"));

	let first!: Promise<void>;
	let second!: Promise<void>;
	act(() => {
		first = setFeatureFlag("secret", "layer-importance", true);
		second = setFeatureFlag("secret", "layer-importance", false);
	});
	await Promise.resolve();
	expect(postCount).toBe(1);
	expect(values.optimistic).toBe(false);

	await act(async () => {
		finishFirst(response({ flags: [enabledFlag] }));
		await first;
		await secondStarted.promise;
		finishSecond(response({ flags: [disabledFlag] }));
		await second;
	});

	expect(values).toEqual({ confirmed: false, optimistic: false });
});

test("uses full mutation response when toggling before flags finish loading", async () => {
	const otherFlag = unregisteredFlag("review-chat");
	const pendingLoad = Promise.withResolvers<Response>();
	const currentFlags: { value: FeatureFlagsSnapshot["flags"] } = {
		value: null,
	};
	function Reader() {
		currentFlags.value = useFeatureFlags().flags;
		return null;
	}
	globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) =>
		init?.method === "POST"
			? response({ flags: [enabledFlag, otherFlag] })
			: pendingLoad.promise) as typeof fetch;
	const root = createRoot(document.createElement("div"));
	roots.push(root);
	act(() => root.render(<Reader />));

	let loading!: Promise<void>;
	act(() => {
		loading = loadFeatureFlags("secret");
	});
	await Promise.resolve();
	await act(async () => setFeatureFlag("secret", "layer-importance", true));
	expect(currentFlags.value).toEqual([enabledFlag, otherFlag]);

	await act(async () => {
		pendingLoad.resolve(response({ flags: [disabledFlag] }));
		await loading;
	});
	expect(currentFlags.value).toEqual([enabledFlag, otherFlag]);
});

test("failed toggle rollback preserves successful change to another flag", async () => {
	const anotherFlag = unregisteredFlag("review-chat");
	let rejectFirst!: (value: Response) => void;
	let calls = 0;
	const currentFlags: { value: FeatureFlagsSnapshot["flags"] } = {
		value: null,
	};
	function StateReader() {
		currentFlags.value = useFeatureFlags().flags;
		return null;
	}
	globalThis.fetch = (async (_input: RequestInfo | URL) => {
		calls++;
		if (calls === 1) return response({ flags: [disabledFlag, anotherFlag] });
		if (calls === 2)
			return new Promise<Response>((resolve) => {
				rejectFirst = resolve;
			});
		return response({
			flags: [disabledFlag, { ...anotherFlag, enabled: true }],
		});
	}) as typeof fetch;
	const root = createRoot(document.createElement("div"));
	roots.push(root);
	act(() => root.render(<StateReader />));
	await act(async () => loadFeatureFlags("secret"));
	let failed!: Promise<void>;
	act(() => {
		failed = setFeatureFlag("secret", "layer-importance", true);
	});
	await act(async () => setFeatureFlag("secret", anotherFlag.id, true));
	await act(async () => {
		rejectFirst(response({ error: "failed" }, 500));
		await failed.catch(() => undefined);
	});
	expect(
		currentFlags.value?.find((flag) => flag.id === "layer-importance")?.enabled,
	).toBe(false);
	expect(
		currentFlags.value?.find((flag) => flag.id === anotherFlag.id)?.enabled,
	).toBe(true);
});
test("updates every mounted flag consumer after a successful toggle", async () => {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({ url: String(input), init });
		return calls.length === 1
			? response({ flags: [disabledFlag] })
			: response({ flags: [enabledFlag] });
	}) as typeof fetch;
	const container = mountConsumers();

	await act(async () => loadFeatureFlags("secret"));
	expect(
		Array.from(container.querySelectorAll("output")).map(
			(item) => item.textContent,
		),
	).toEqual(["false", "false"]);
	await act(async () => setFeatureFlag("secret", "layer-importance", true));

	expect(calls).toHaveLength(2);
	expect(calls[1]?.url).toBe("/api/features?t=secret");
	expect(calls[1]?.init?.method).toBe("POST");
	expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
		id: "layer-importance",
		enabled: true,
	});
	expect(
		Array.from(container.querySelectorAll("output")).map(
			(item) => item.textContent,
		),
	).toEqual(["true", "true"]);
});

test("rolls back failed toggles and exposes the server error", async () => {
	let finishPost!: (value: Response) => void;
	globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) =>
		init?.method === "POST"
			? new Promise<Response>((resolve) => {
					finishPost = resolve;
				})
			: response({ flags: [disabledFlag] })) as typeof fetch;
	const container = mountConsumers();
	await act(async () => loadFeatureFlags("secret"));

	let failure: unknown;
	let toggle!: Promise<void>;
	act(() => {
		toggle = setFeatureFlag("secret", "layer-importance", true);
	});
	await Promise.resolve();
	expect(
		Array.from(container.querySelectorAll("output")).map(
			(item) => item.textContent,
		),
	).toEqual(["true", "true"]);
	await act(async () => {
		finishPost(response({ error: "disk full" }, 500));
		await toggle.catch((reason: unknown) => {
			failure = reason;
		});
	});
	expect(failure).toBeInstanceOf(Error);
	expect((failure as Error).message).toBe("disk full");
	expect(
		Array.from(container.querySelectorAll("output")).map(
			(item) => item.textContent,
		),
	).toEqual(["false", "false"]);
	let state: FeatureFlagsSnapshot | undefined;
	function StateReader() {
		state = useFeatureFlags();
		return null;
	}
	const readerRoot = createRoot(document.createElement("div"));
	roots.push(readerRoot);
	act(() => readerRoot.render(<StateReader />));
	expect(state?.error).toBe("disk full");
});

test("ignores stale GET responses that resolve after a successful toggle", async () => {
	let finishStaleGet!: (value: Response) => void;
	let getCalls = 0;
	globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
		if (init?.method === "POST") return response({ flags: [enabledFlag] });
		getCalls++;
		if (getCalls === 1) return response({ flags: [disabledFlag] });
		return new Promise<Response>((resolve) => {
			finishStaleGet = resolve;
		});
	}) as typeof fetch;
	const container = mountConsumers();
	await act(async () => loadFeatureFlags("secret"));

	let staleLoad!: Promise<void>;
	act(() => {
		staleLoad = loadFeatureFlags("secret");
	});
	await act(async () => setFeatureFlag("secret", "layer-importance", true));
	expect(
		Array.from(container.querySelectorAll("output")).map(
			(item) => item.textContent,
		),
	).toEqual(["true", "true"]);

	await act(async () => {
		finishStaleGet(response({ flags: [disabledFlag] }));
		await staleLoad;
	});
	expect(
		Array.from(container.querySelectorAll("output")).map(
			(item) => item.textContent,
		),
	).toEqual(["true", "true"]);
});

test("only latest concurrent flag load can update the shared snapshot", async () => {
	let finishOlderGet!: (value: Response) => void;
	let getCalls = 0;
	globalThis.fetch = (async () => {
		getCalls++;
		if (getCalls === 1) {
			return new Promise<Response>((resolve) => {
				finishOlderGet = resolve;
			});
		}
		return response({ flags: [enabledFlag] });
	}) as typeof fetch;
	const container = mountConsumers();

	let olderLoad!: Promise<void>;
	act(() => {
		olderLoad = loadFeatureFlags("secret");
	});
	await act(async () => loadFeatureFlags("secret"));
	expect(
		Array.from(container.querySelectorAll("output")).map(
			(item) => item.textContent,
		),
	).toEqual(["true", "true"]);

	await act(async () => {
		finishOlderGet(response({ flags: [disabledFlag] }));
		await olderLoad;
	});
	expect(
		Array.from(container.querySelectorAll("output")).map(
			(item) => item.textContent,
		),
	).toEqual(["true", "true"]);
});

test("keeps current flags and latest error when older flag loads finish later", async () => {
	let finishOlderGet!: (value: Response) => void;
	let getCalls = 0;
	globalThis.fetch = (async () => {
		getCalls++;
		if (getCalls === 1) return response({ flags: [disabledFlag] });
		if (getCalls === 2) {
			return new Promise<Response>((resolve) => {
				finishOlderGet = resolve;
			});
		}
		return response({ error: "feature service unavailable" }, 503);
	}) as typeof fetch;
	const container = mountConsumers();
	let state: FeatureFlagsSnapshot | undefined;
	function StateReader() {
		state = useFeatureFlags();
		return null;
	}
	const readerRoot = createRoot(document.createElement("div"));
	roots.push(readerRoot);
	act(() => readerRoot.render(<StateReader />));
	await act(async () => loadFeatureFlags("secret"));

	let olderLoad!: Promise<void>;
	act(() => {
		olderLoad = loadFeatureFlags("secret");
	});
	await act(async () => loadFeatureFlags("secret"));
	expect(state?.flags?.[0]?.enabled).toBe(false);
	expect(state?.error).toBe("feature service unavailable");

	await act(async () => {
		finishOlderGet(response({ flags: [enabledFlag] }));
		await olderLoad;
	});
	expect(
		Array.from(container.querySelectorAll("output")).map(
			(item) => item.textContent,
		),
	).toEqual(["false", "false"]);
	expect(state?.flags?.[0]?.enabled).toBe(false);
	expect(state?.error).toBe("feature service unavailable");
});

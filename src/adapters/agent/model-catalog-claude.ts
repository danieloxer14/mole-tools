import { CLAUDE_EFFORTS } from "./effort";

export interface ClaudeModelChoice {
	id: string;
	label: string;
	efforts: string[];
}

export type ClaudeModelCatalogSource = "anthropic-api" | "claude-aliases";

export interface ClaudeModelCatalog {
	models: ClaudeModelChoice[];
	source: ClaudeModelCatalogSource;
	warning?: string;
}

export interface ClaudeModelCatalogOptions {
	apiKey?: string | null;
	fetcher?: typeof fetch;
	/** Lower values are useful for deterministic timeout tests; values are capped at 10 seconds. */
	timeoutMs?: number;
}

const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_PAGES = 20;
const MAX_MODELS_PER_PAGE = 1000;
const MAX_TIMEOUT_MS = 10_000;
const CLI_ALIASES = [
	{ id: "sonnet", label: "Sonnet (Claude CLI alias)" },
	{ id: "opus", label: "Opus (Claude CLI alias)" },
	{ id: "haiku", label: "Haiku (Claude CLI alias)" },
] as const;
const API_CATALOG_WARNING =
	"Anthropic API model availability reflects the API key's entitlement; it does not establish which models the Claude CLI account can access.";
const API_FAILURE_WARNING =
	"Anthropic API model discovery failed or exceeded its limits. Showing Claude CLI aliases only; aliases do not enumerate all Claude CLI model entitlements.";

interface ModelPage {
	data: Array<{ id: string; label: string }>;
	hasMore: boolean;
	lastId: string | null;
}

function isValidModelId(value: unknown): value is string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > 256 ||
		value.trim() !== value ||
		/\s/u.test(value)
	)
		return false;

	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) return false;
	}
	return true;
}

function aliasCatalog(warning?: string): ClaudeModelCatalog {
	return {
		models: CLI_ALIASES.map(({ id, label }) => ({
			id,
			label,
			efforts: [...CLAUDE_EFFORTS],
		})),
		source: "claude-aliases",
		...(warning ? { warning } : {}),
	};
}

function parseModelPage(value: unknown): ModelPage {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Malformed models response");
	}
	const pageValue = value as {
		data?: unknown;
		has_more?: unknown;
		last_id?: unknown;
	};
	if (!Array.isArray(pageValue.data)) {
		throw new Error("Malformed models response");
	}
	if (typeof pageValue.has_more !== "boolean") {
		throw new Error("Malformed pagination response");
	}
	if (pageValue.data.length > MAX_MODELS_PER_PAGE) {
		throw new Error("Models page exceeds item limit");
	}

	const data = pageValue.data.map((item: unknown) => {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			throw new Error("Malformed model identifier");
		}
		const model = item as { id?: unknown; display_name?: unknown };
		if (!isValidModelId(model.id)) {
			throw new Error("Malformed model identifier");
		}
		const displayName = model.display_name;
		const label =
			typeof displayName === "string" &&
			displayName.trim().length > 0 &&
			displayName.length <= 256 &&
			!/\p{Cc}/u.test(displayName)
				? displayName
				: model.id;
		return { id: model.id, label };
	});

	const lastId = pageValue.last_id;
	if (lastId !== undefined && lastId !== null && !isValidModelId(lastId)) {
		throw new Error("Malformed pagination cursor");
	}
	if (pageValue.has_more) {
		if (
			data.length === 0 ||
			!isValidModelId(lastId) ||
			lastId !== data[data.length - 1]?.id
		) {
			throw new Error("Malformed pagination cursor");
		}
		return { data, hasMore: true, lastId };
	}

	return {
		data,
		hasMore: false,
		lastId: isValidModelId(lastId) ? lastId : null,
	};
}

async function readJsonResponse(
	response: Response,
	remainingBytes: number,
): Promise<{ value: unknown; bytes: number }> {
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Missing models response body");

	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > remainingBytes) {
				void reader.cancel().catch(() => {});
				throw new Error("Models response exceeds byte limit");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const content = new Uint8Array(bytes);
	let offset = 0;
	for (const chunk of chunks) {
		content.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return {
		value: JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(content),
		),
		bytes,
	};
}

async function requestCatalog(
	apiKey: string,
	fetcher: typeof fetch,
	signal: AbortSignal,
): Promise<ClaudeModelCatalog> {
	const models = new Map<string, string>();
	const seenCursors = new Set<string>();
	let afterId: string | undefined;
	let totalBytes = 0;

	for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
		const url = new URL(ANTHROPIC_MODELS_URL);
		url.searchParams.set("limit", String(MAX_MODELS_PER_PAGE));
		if (afterId) url.searchParams.set("after_id", afterId);

		const response = await fetcher(url, {
			method: "GET",
			headers: {
				"x-api-key": apiKey,
				"anthropic-version": ANTHROPIC_VERSION,
			},
			redirect: "error",
			signal,
		});
		if (!response.ok) {
			void response.body?.cancel().catch(() => {});
			throw new Error("Anthropic models request failed");
		}

		const parsed = await readJsonResponse(
			response,
			MAX_TOTAL_BYTES - totalBytes,
		);
		totalBytes += parsed.bytes;
		const page = parseModelPage(parsed.value);
		for (const model of page.data) {
			if (!models.has(model.id)) models.set(model.id, model.label);
		}
		if (!page.hasMore) {
			return {
				models: [...models].map(([id, label]) => ({
					id,
					label,
					efforts: [...CLAUDE_EFFORTS],
				})),
				source: "anthropic-api",
				warning: API_CATALOG_WARNING,
			};
		}

		const cursor = page.lastId;
		if (!cursor || seenCursors.has(cursor)) {
			throw new Error("Cyclic models pagination");
		}
		seenCursors.add(cursor);
		afterId = cursor;
	}

	throw new Error("Models catalog exceeds page limit");
}

/** Fetches the API-key-visible model catalog; CLI aliases are fallback, not a full catalog. */
export async function discoverClaudeModels(
	options: ClaudeModelCatalogOptions = {},
): Promise<ClaudeModelCatalog> {
	const apiKey =
		options.apiKey === undefined
			? process.env.ANTHROPIC_API_KEY
			: options.apiKey;
	if (!apiKey) return aliasCatalog();

	const fetcher = options.fetcher ?? globalThis.fetch;
	const timeoutMs =
		typeof options.timeoutMs === "number" &&
		Number.isFinite(options.timeoutMs) &&
		options.timeoutMs > 0
			? Math.min(options.timeoutMs, MAX_TIMEOUT_MS)
			: MAX_TIMEOUT_MS;
	const controller = new AbortController();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_resolve, reject) => {
		timeout = setTimeout(() => {
			controller.abort();
			reject(new Error("Models catalog deadline exceeded"));
		}, timeoutMs);
	});

	try {
		const catalog = await Promise.race([
			requestCatalog(apiKey, fetcher, controller.signal),
			deadline,
		]);
		if (JSON.stringify(catalog).includes(apiKey)) {
			return aliasCatalog(API_FAILURE_WARNING);
		}
		return catalog;
	} catch {
		return aliasCatalog(API_FAILURE_WARNING);
	} finally {
		clearTimeout(timeout);
		controller.abort();
	}
}

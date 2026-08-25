import { appendFile, mkdir, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { logger } from "../../core/logger";
import type { ReviewPaths } from "./paths";
import {
	CHAT_ID_PATTERN,
	deriveChatTitle,
	ensureChats,
	LEGACY_CHAT_ID,
	LegacyChatSessionSchema,
	type ReviewState,
	ReviewStateSchema,
} from "./state";

export const ChatTagSchema = z
	.object({
		path: z.string().min(1),
		side: z.enum(["new", "old"]),
		startLine: z.number().int().positive(),
		endLine: z.number().int().positive(),
		hunk: z.string().min(1),
	})
	.strict()
	.refine((tag) => tag.endLine >= tag.startLine, {
		message: "endLine must be greater than or equal to startLine",
		path: ["endLine"],
	});
export type ChatTag = z.infer<typeof ChatTagSchema>;

export const ChatEntrySchema = z
	.object({
		role: z.string().min(1),
		text: z.string(),
		tags: z.array(ChatTagSchema),
		at: z.string().min(1),
		sessionId: z.string().min(1).nullable(),
	})
	.strict();
export type ChatEntry = z.infer<typeof ChatEntrySchema>;

export interface ReviewStorePaths {
	statePath: string;
	/** Legacy single-transcript path. Adoption source only. */
	chatPath: string;
	chatsDir: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export type ReviewStateMutation = (
	current: ReviewState | null,
) => ReviewState | Promise<ReviewState>;

export class ReviewStore {
	private stateWrites: Promise<void> = Promise.resolve();
	private readonly chatWrites = new Map<string, Promise<void>>();
	private readonly statePath: string;
	private readonly chatPath: string;
	private readonly chatsDir: string;

	constructor(paths: ReviewStorePaths | ReviewPaths) {
		this.statePath = paths.statePath;
		this.chatPath = paths.chatPath;
		this.chatsDir = paths.chatsDir;
	}

	private transcriptPath(chatId: string): string {
		if (!CHAT_ID_PATTERN.test(chatId))
			throw new Error(`Invalid chat id: ${chatId}`);
		return join(this.chatsDir, `${chatId}.ndjson`);
	}

	/** Serialize writes per chat so parallel turns in different chats do not queue. */
	private async queueChatWrite(
		chatId: string,
		work: () => Promise<void>,
	): Promise<void> {
		const previous = this.chatWrites.get(chatId) ?? Promise.resolve();
		const operation = previous.then(work);
		this.chatWrites.set(
			chatId,
			operation.catch(() => undefined),
		);
		await operation;
	}

	async read(): Promise<ReviewState | null> {
		return this.readStateFile();
	}

	async write(state: ReviewState): Promise<void> {
		const validated = ReviewStateSchema.parse(state);
		const operation = this.stateWrites.then(() =>
			this.writeStateFile(validated),
		);
		this.stateWrites = operation.catch(() => undefined);
		await operation;
	}

	/**
	 * Serialize a read-modify-write against the latest state on disk.
	 * Callers can safely update one field while another operation writes a
	 * concurrently computed snapshot.
	 */
	async mutate(mutator: ReviewStateMutation): Promise<ReviewState> {
		const operation = this.stateWrites.then(async () => {
			const current = await this.readStateFile();
			const next = ReviewStateSchema.parse(await mutator(current));
			await this.writeStateFile(next);
			return next;
		});
		this.stateWrites = operation.then(
			() => undefined,
			() => undefined,
		);
		return operation;
	}

	async appendChat(
		chatId: string,
		entry: Omit<ChatEntry, "tags" | "at" | "sessionId"> &
			Partial<Pick<ChatEntry, "tags" | "at" | "sessionId">>,
	): Promise<void> {
		const transcriptPath = this.transcriptPath(chatId);
		const normalized = ChatEntrySchema.parse({
			role: entry.role,
			text: entry.text,
			tags: entry.tags ?? [],
			at: entry.at ?? new Date().toISOString(),
			sessionId: entry.sessionId ?? null,
		});
		await this.queueChatWrite(chatId, async () => {
			await mkdir(dirname(transcriptPath), { recursive: true });
			await appendFile(
				transcriptPath,
				`${JSON.stringify(normalized)}\n`,
				"utf8",
			);
		});
	}

	async readChat(chatId: string): Promise<ChatEntry[]> {
		const transcriptPath = this.transcriptPath(chatId);
		try {
			const raw = await readFile(transcriptPath, "utf8");
			return raw
				.split("\n")
				.filter((line) => line.trim().length > 0)
				.map((line) => ChatEntrySchema.parse(JSON.parse(line)));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
	}

	/**
	 * Move a pre-multi-chat transcript into the per-chat directory exactly once.
	 * Returns a title derived from its first user entry, or null when there is
	 * nothing to adopt.
	 */
	async adoptLegacyChat(): Promise<string | null> {
		const target = this.transcriptPath(LEGACY_CHAT_ID);
		if (await Bun.file(target).exists()) return null;
		if (!(await Bun.file(this.chatPath).exists())) return null;
		await mkdir(this.chatsDir, { recursive: true });
		await rename(this.chatPath, target);
		const entries = await this.readChat(LEGACY_CHAT_ID);
		const first = entries.find((entry) => entry.role === "user");
		return first ? deriveChatTitle(first.text) : "";
	}

	private async readStateFile(): Promise<ReviewState | null> {
		const file = Bun.file(this.statePath);
		if (!(await file.exists())) return null;

		const raw = await file.text();
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			throw new Error(`Invalid review state at ${this.statePath}`, {
				cause: error,
			});
		}

		if (!isRecord(parsed) || parsed.version !== 1) {
			await this.discardVersionMismatch();
			return null;
		}
		const parsedState = ReviewStateSchema.parse(parsed);
		const legacySessionKey = Object.entries(ReviewStateSchema.shape).find(
			([, schema]) => schema === LegacyChatSessionSchema,
		)?.[0];
		if (!legacySessionKey) {
			throw new Error("Review state schema missing legacy session field");
		}
		const legacySession = (parsedState as Record<string, unknown>)[
			legacySessionKey
		];
		const normalizedState = ReviewStateSchema.parse({
			...parsedState,
			[legacySessionKey]: null,
		});
		return ensureChats(
			normalizedState,
			typeof legacySession === "string" ? legacySession : null,
		);
	}

	private async writeStateFile(state: ReviewState): Promise<void> {
		await mkdir(dirname(this.statePath), { recursive: true });
		const tempPath = `${this.statePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
		try {
			await Bun.write(tempPath, `${JSON.stringify(state, null, "\t")}\n`);
			await rename(tempPath, this.statePath);
		} finally {
			if (await Bun.file(tempPath).exists()) await unlink(tempPath);
		}
	}

	private async discardVersionMismatch(): Promise<void> {
		logger.warn("review.state.version-mismatch", { path: this.statePath });
		try {
			await unlink(this.statePath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
}

export function createReviewStore(
	paths: ReviewStorePaths | ReviewPaths,
): ReviewStore {
	return new ReviewStore(paths);
}

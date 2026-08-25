import {
	createReviewRoutes,
	type ReviewRouteHandler,
	type ReviewRoutesOptions,
} from "./routes";
import page from "./ui/index.html";

export interface ReviewServerOptions
	extends Omit<ReviewRoutesOptions, "token"> {
	hostname?: string;
	port?: number;
	token?: string;
}

export interface ReviewServerAddress {
	hostname: string;
	port: number;
	token: string;
	url: string;
}

export class ReviewServer {
	readonly hostname: string;
	readonly token: string;
	private readonly requestedPort: number;
	private readonly routes: ReviewRouteHandler;
	private server: ReturnType<typeof Bun.serve> | null = null;

	constructor(options: ReviewServerOptions = {}) {
		this.hostname = options.hostname ?? "127.0.0.1";
		this.requestedPort = options.port ?? 0;
		this.token = options.token ?? crypto.randomUUID();
		this.routes = createReviewRoutes({ ...options, token: this.token });
	}

	start(): ReviewServerAddress {
		if (this.server) return this.address;
		this.server = Bun.serve({
			hostname: this.hostname,
			port: this.requestedPort,
			// Chat and layer streams stay open while an agent thinks. The 10s
			// default closes them mid-run, so allow Bun's maximum and rely on the
			// SSE heartbeat to keep traffic flowing.
			idleTimeout: 255,
			routes: {
				"/": page,
			},
			fetch: this.routes,
		});
		return this.address;
	}

	get port(): number {
		if (!this.server) throw new Error("Review server is not started");
		return this.server.port;
	}

	get url(): string {
		return `http://${this.hostname}:${this.port}/?t=${encodeURIComponent(this.token)}`;
	}

	get address(): ReviewServerAddress {
		return {
			hostname: this.hostname,
			port: this.port,
			token: this.token,
			url: this.url,
		};
	}

	async stop(): Promise<void> {
		if (!this.server) return;
		const server = this.server;
		this.server = null;
		await server.stop(true);
	}
}

export function createReviewServer(
	options: ReviewServerOptions = {},
): ReviewServer {
	return new ReviewServer(options);
}

export const startReviewServer = createReviewServer;

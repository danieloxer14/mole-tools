type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];
type FetchHandler = (input: FetchInput, init: FetchInit) => Promise<Response>;

type PreconnectOptions = Parameters<typeof fetch.preconnect>[1];

export function withMockFetch(handler: FetchHandler): typeof fetch {
	return Object.assign(handler, {
		preconnect(_url: string | URL, _options?: PreconnectOptions): void {},
	});
}

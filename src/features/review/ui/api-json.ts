export function apiUrl(path: string, token: string): string {
	const separator = path.includes("?") ? "&" : "?";
	return `${path}${separator}t=${encodeURIComponent(token)}`;
}

export function responseError(value: unknown): string | null {
	if (typeof value !== "object" || value === null || !("error" in value))
		return null;
	const error = value.error;
	return typeof error === "string" && error.length > 0 ? error : null;
}

export function controlValue(event: unknown): string {
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

export function errorMessage(reason: unknown): string {
	return reason instanceof Error ? reason.message : String(reason);
}

export async function requestJson<T>(
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

export function postJson<T>(
	token: string,
	path: string,
	body: unknown,
): Promise<T> {
	return requestJson<T>(token, path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

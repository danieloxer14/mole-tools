/** Strips line and block comments from JSON text, ignoring both inside string literals. */
export function stripJsonComments(text: string): string {
	let result = "";
	let inString = false;
	let inLineComment = false;
	let inBlockComment = false;

	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		const next = text[i + 1];

		if (inLineComment) {
			if (char === "\n") {
				inLineComment = false;
				result += char;
			}
			continue;
		}

		if (inBlockComment) {
			if (char === "*" && next === "/") {
				inBlockComment = false;
				i++;
			}
			continue;
		}

		if (inString) {
			result += char;
			if (char === "\\") {
				result += next;
				i++;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}

		if (char === '"') {
			inString = true;
			result += char;
		} else if (char === "/" && next === "/") {
			inLineComment = true;
			i++;
		} else if (char === "/" && next === "*") {
			inBlockComment = true;
			i++;
		} else {
			result += char;
		}
	}

	return result;
}

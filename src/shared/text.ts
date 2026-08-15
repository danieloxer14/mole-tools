export function truncateWords(text: string, maxWords: number): string {
	const words = text.trim().split(/\s+/).filter(Boolean);
	if (words.length <= maxWords) return text;
	return `${words.slice(0, maxWords).join(" ")} ...`;
}

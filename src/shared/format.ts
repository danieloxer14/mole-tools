const CONVENTIONAL_TYPES = [
	"feat",
	"fix",
	"chore",
	"docs",
	"style",
	"refactor",
	"perf",
	"test",
	"build",
	"ci",
	"revert",
];

const SUBJECT_MAX_LENGTH = 72;

const SUBJECT_PATTERN = new RegExp(
	`^(${CONVENTIONAL_TYPES.join("|")})(\\([^)]+\\))?!?: .+$`,
);

export type FormatCheck = { ok: true } | { ok: false; violations: string[] };

export function checkFormat(message: string): FormatCheck {
	const violations: string[] = [];
	const lines = message.split("\n");
	const subject = lines[0] ?? "";

	if (!SUBJECT_PATTERN.test(subject)) {
		violations.push(
			`Subject must match Conventional Commits format: type(scope)?: description (allowed types: ${CONVENTIONAL_TYPES.join(", ")})`,
		);
	}

	if (subject.length > SUBJECT_MAX_LENGTH) {
		violations.push(
			`Subject must be ${SUBJECT_MAX_LENGTH} characters or fewer (got ${subject.length})`,
		);
	}

	const hasBody = lines.slice(1).some((line) => line.trim().length > 0);
	if (hasBody && lines[1] !== "") {
		violations.push("Blank line required between subject and body");
	}

	return violations.length > 0 ? { ok: false, violations } : { ok: true };
}

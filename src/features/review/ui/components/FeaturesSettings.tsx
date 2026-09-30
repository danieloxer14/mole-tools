import { useEffect, useState } from "react";
import { errorMessage } from "../api-json";
import {
	loadFeatureFlags,
	setFeatureFlag,
	useFeatureFlags,
} from "../feature-flags";
import { Alert } from "./ui/alert";
import { Checkbox } from "./ui/checkbox";

export interface FeaturesSettingsProps {
	token: string;
}

export function FeaturesSettings({ token }: FeaturesSettingsProps) {
	const { flags, error } = useFeatureFlags();
	const [pending, setPending] = useState<Set<string>>(() => new Set());
	const [toggleErrors, setToggleErrors] = useState<Record<string, string>>({});

	useEffect(() => {
		void loadFeatureFlags(token);
	}, [token]);

	if (flags === null) {
		return error === null ? (
			<p className="text-sm text-muted-foreground">Loading features…</p>
		) : (
			<Alert variant="destructive">{error}</Alert>
		);
	}

	return (
		<div className="space-y-4">
			{flags.map(({ id, label, description, enabled }) => (
				<div key={id} className="space-y-2">
					<label
						htmlFor={`feature-flag-${id}`}
						className="flex items-center gap-3 font-medium"
					>
						<Checkbox
							id={`feature-flag-${id}`}
							aria-label={label}
							checked={enabled}
							disabled={pending.has(id)}
							onCheckedChange={(checked) => {
								setPending((current) => new Set(current).add(id));
								setToggleErrors((current) => {
									const next = { ...current };
									delete next[id];
									return next;
								});
								void setFeatureFlag(token, id, checked === true)
									.catch((reason: unknown) => {
										setToggleErrors((current) => ({
											...current,
											[id]: errorMessage(reason),
										}));
									})
									.finally(() => {
										setPending((current) => {
											const next = new Set(current);
											next.delete(id);
											return next;
										});
									});
							}}
						/>
						{label}
					</label>
					<p className="pl-7 text-sm text-muted-foreground">{description}</p>
					{toggleErrors[id] ? (
						<Alert variant="destructive">{toggleErrors[id]}</Alert>
					) : null}
				</div>
			))}
		</div>
	);
}

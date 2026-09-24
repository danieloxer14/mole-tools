import {
	COLOR_THEME_OPTIONS,
	changeColorTheme,
	isColorTheme,
	useColorThemeSaveState,
} from "../color-theme";
import { Alert } from "./ui/alert";
import { NativeSelect } from "./ui/native-select";

export function AppearanceSettings({ token }: { token: string }) {
	const { colorTheme, pending, error } = useColorThemeSaveState();

	const handleChange = (value: string) => {
		if (!isColorTheme(value)) return;
		void changeColorTheme(token, value);
	};

	return (
		<section
			className="max-w-xl space-y-4"
			aria-labelledby="settings-appearance-heading"
		>
			<div className="space-y-1">
				<h3 id="settings-appearance-heading" className="text-sm font-semibold">
					Appearance
				</h3>
				<p className="text-sm text-muted-foreground">
					Choose how the review UI looks. Saved to your mole-tools config.
				</p>
			</div>
			{error ? (
				<Alert variant="destructive" role="alert">
					{error}
				</Alert>
			) : null}
			<div className="flex flex-wrap items-center gap-2">
				<label
					className="w-24 shrink-0 text-xs font-medium"
					htmlFor="settings-color-theme"
				>
					Color theme
				</label>
				<NativeSelect
					className="min-w-0 flex-1"
					id="settings-color-theme"
					size="sm"
					value={colorTheme}
					disabled={pending}
					onChange={(event) => {
						void handleChange(event.currentTarget.value);
					}}
				>
					{COLOR_THEME_OPTIONS.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</NativeSelect>
			</div>
		</section>
	);
}

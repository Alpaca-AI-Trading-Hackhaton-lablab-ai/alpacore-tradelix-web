import { useEffect, useRef } from "react";
import {
	INDICATOR_OPTIONS,
	type PocGroqModel,
	type PocSettings,
} from "@/api/market-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AgentSettings } from "./AgentGraph";

export type KeyDraft = {
	groq: string;
	tavily: string;
	alpaca_api_key: string;
	alpaca_secret_key: string;
};

function sourceBadge(source: string | undefined) {
	if (source === "db") return "success" as const;
	if (source === "env") return "warning" as const;
	return "outline" as const;
}

function toggleId(list: string[], id: string): string[] {
	return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function OptionsDrawer({
	open,
	onClose,
	settings,
	onSettings,
	keyDraft,
	onKeyDraft,
	keySources,
	allowlist,
	onSaveKeys,
	savingKeys,
	settingsError,
}: {
	open: boolean;
	onClose: () => void;
	settings: AgentSettings;
	onSettings: (next: AgentSettings) => void;
	keyDraft: KeyDraft;
	onKeyDraft: (next: KeyDraft) => void;
	keySources: PocSettings["keys"] | undefined;
	allowlist: PocGroqModel[];
	onSaveKeys: () => void;
	savingKeys: boolean;
	settingsError: boolean;
}) {
	const ref = useRef<HTMLDialogElement>(null);
	const deepOn = settings.deepSentiment || settings.deepDecision;

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		if (open && !el.open) el.showModal();
		if (!open && el.open) el.close();
	}, [open]);

	return (
		// Native <dialog> already traps focus and handles Escape via showModal().
		// onClick closes on backdrop click (coordinates outside the sheet).
		// biome-ignore lint/a11y/useKeyWithClickEvents: Esc is native to modal dialog
		<dialog
			ref={ref}
			className="options-drawer"
			aria-labelledby="options-title"
			onClose={onClose}
			onClick={(event) => {
				const el = ref.current;
				if (!el) return;
				const rect = el.getBoundingClientRect();
				const inside =
					event.clientX >= rect.left &&
					event.clientX <= rect.right &&
					event.clientY >= rect.top &&
					event.clientY <= rect.bottom;
				if (!inside) onClose();
			}}
		>
			<div className="flex h-full flex-col">
				<div className="flex items-center justify-between border-b border-border px-5 py-4">
					<h2 id="options-title" className="font-serif text-xl text-foreground">
						Options
					</h2>
					<button
						type="button"
						onClick={onClose}
						className="text-sm text-muted-foreground hover:text-foreground"
					>
						Close
					</button>
				</div>
				<div className="flex-1 space-y-8 overflow-y-auto px-5 py-5">
					<section>
						<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							API keys
						</h3>
						<p className="mb-3 text-xs text-muted-foreground">
							Saved keys override .env. Leave blank to keep the current source.
							Values are never shown after save.
						</p>
						<div className="grid gap-3">
							<KeyField
								label="Groq"
								source={keySources?.groq}
								value={keyDraft.groq}
								onChange={(v) => onKeyDraft({ ...keyDraft, groq: v })}
							/>
							<KeyField
								label="Tavily"
								source={keySources?.tavily}
								value={keyDraft.tavily}
								onChange={(v) => onKeyDraft({ ...keyDraft, tavily: v })}
							/>
							<KeyField
								label="Alpaca key"
								source={keySources?.alpaca_api_key}
								value={keyDraft.alpaca_api_key}
								onChange={(v) => onKeyDraft({ ...keyDraft, alpaca_api_key: v })}
							/>
							<KeyField
								label="Alpaca secret"
								source={keySources?.alpaca_secret_key}
								value={keyDraft.alpaca_secret_key}
								onChange={(v) =>
									onKeyDraft({ ...keyDraft, alpaca_secret_key: v })
								}
							/>
						</div>
						<Button
							type="button"
							variant="secondary"
							className="mt-3"
							onClick={onSaveKeys}
							disabled={savingKeys}
						>
							{savingKeys ? "Saving…" : "Save keys"}
						</Button>
						{settingsError ? (
							<p className="mt-2 text-xs text-short">
								Settings API unavailable (is Postgres up?)
							</p>
						) : null}
					</section>

					<section>
						<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Models
						</h3>
						<label className="mb-3 block text-[10px] uppercase tracking-wide text-muted-foreground">
							Sentiment
							<select
								value={settings.sentimentModel}
								onChange={(event) =>
									onSettings({
										...settings,
										sentimentModel: event.target.value,
									})
								}
								className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-xs normal-case text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
							>
								{allowlist.length === 0 ? (
									<option value="">Loading…</option>
								) : null}
								{allowlist.map((item) => (
									<option key={item.id} value={item.id}>
										{item.label}
									</option>
								))}
							</select>
						</label>
						<label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
							Decision
							<select
								value={settings.decisionModel}
								onChange={(event) =>
									onSettings({
										...settings,
										decisionModel: event.target.value,
									})
								}
								className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-xs normal-case text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
							>
								{allowlist.length === 0 ? (
									<option value="">Loading…</option>
								) : null}
								{allowlist.map((item) => (
									<option key={item.id} value={item.id}>
										{item.label}
									</option>
								))}
							</select>
						</label>
					</section>

					<section>
						<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Deep research
						</h3>
						<p className="mb-3 text-xs text-muted-foreground">
							Opt-in ReAct loops on the proposal side. The gate stays
							deterministic.
						</p>
						<label className="mb-3 flex items-center gap-2 text-sm text-foreground">
							<input
								type="checkbox"
								checked={deepOn}
								onChange={(event) => {
									const on = event.target.checked;
									onSettings({
										...settings,
										deepSentiment: on,
										deepDecision: on,
									});
								}}
							/>
							Enable Deep research (both agents)
						</label>
						<label className="flex items-center gap-2 text-xs text-foreground">
							<input
								type="checkbox"
								checked={settings.deepSentiment}
								onChange={(event) =>
									onSettings({
										...settings,
										deepSentiment: event.target.checked,
									})
								}
							/>
							Sentiment ReAct
						</label>
						<label className="mt-1.5 flex items-center gap-2 text-xs text-foreground">
							<input
								type="checkbox"
								checked={settings.deepDecision}
								onChange={(event) =>
									onSettings({
										...settings,
										deepDecision: event.target.checked,
									})
								}
							/>
							Decision ReAct
						</label>
					</section>

					<section>
						<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Indicators
						</h3>
						<p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
							Chart / compute
						</p>
						<IndicatorGrid
							selected={settings.indicators}
							onToggle={(id) =>
								onSettings({
									...settings,
									indicators: toggleId(settings.indicators, id),
								})
							}
						/>
						<p className="mt-4 mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
							Decision snapshot
						</p>
						<IndicatorGrid
							selected={settings.decisionIndicators}
							onToggle={(id) =>
								onSettings({
									...settings,
									decisionIndicators: toggleId(settings.decisionIndicators, id),
								})
							}
						/>
					</section>
				</div>
			</div>
		</dialog>
	);
}

function KeyField({
	label,
	source,
	value,
	onChange,
}: {
	label: string;
	source?: string | undefined;
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<label className="block text-xs text-muted-foreground">
			<span className="mb-1 flex items-center justify-between gap-2">
				{label}
				<Badge variant={sourceBadge(source)} className="uppercase">
					{source ?? "—"}
				</Badge>
			</span>
			<input
				type="password"
				autoComplete="off"
				placeholder="unchanged"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				className="h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
			/>
		</label>
	);
}

function IndicatorGrid({
	selected,
	onToggle,
}: {
	selected: string[];
	onToggle: (id: string) => void;
}) {
	return (
		<div className="grid grid-cols-2 gap-1.5">
			{INDICATOR_OPTIONS.map((item) => (
				<label
					key={item.id}
					className="flex items-center gap-1.5 text-xs text-foreground"
				>
					<input
						type="checkbox"
						checked={selected.includes(item.id)}
						onChange={() => onToggle(item.id)}
					/>
					{item.label}
				</label>
			))}
		</div>
	);
}

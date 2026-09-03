import { useEffect, useRef, useState } from "react";
import {
	INDICATOR_OPTIONS,
	type PocApiBudget,
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

export type LoopSettings = {
	maxCredit: number;
	intervalSeconds: number;
	windowStart: string | null;
	windowEnd: string | null;
	universe: string[];
};

const CADENCE_PRESETS: { label: string; seconds: number }[] = [
	{ label: "1m", seconds: 60 },
	{ label: "5m", seconds: 300 },
	{ label: "15m", seconds: 900 },
	{ label: "30m", seconds: 1800 },
	{ label: "1h", seconds: 3600 },
	{ label: "4h", seconds: 14400 },
	{ label: "1d", seconds: 86400 },
];

const MIN_INTERVAL_S = 30;

type CadenceUnit = "s" | "m" | "h";

function unitSeconds(unit: CadenceUnit): number {
	if (unit === "h") return 3600;
	if (unit === "m") return 60;
	return 1;
}

function splitInterval(seconds: number): {
	n: number;
	unit: CadenceUnit;
	preset: string | null;
} {
	const preset = CADENCE_PRESETS.find((item) => item.seconds === seconds);
	if (preset) {
		const unit: CadenceUnit =
			seconds % 3600 === 0 ? "h" : seconds % 60 === 0 ? "m" : "s";
		return { n: seconds / unitSeconds(unit), unit, preset: preset.label };
	}
	if (seconds % 3600 === 0) return { n: seconds / 3600, unit: "h", preset: null };
	if (seconds % 60 === 0) return { n: seconds / 60, unit: "m", preset: null };
	return { n: seconds, unit: "s", preset: null };
}

function pad2(n: number): string {
	return String(n).padStart(2, "0");
}

type UtcParts = {
	dd: string;
	mm: string;
	yyyy: string;
	hh: string;
	mi: string;
	ss: string;
};

const EMPTY_UTC: UtcParts = {
	dd: "",
	mm: "",
	yyyy: "",
	hh: "",
	mi: "",
	ss: "",
};

function isoToParts(iso: string | null | undefined): UtcParts {
	if (!iso) return { ...EMPTY_UTC };
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return { ...EMPTY_UTC };
	return {
		dd: pad2(d.getUTCDate()),
		mm: pad2(d.getUTCMonth() + 1),
		yyyy: String(d.getUTCFullYear()),
		hh: pad2(d.getUTCHours()),
		mi: pad2(d.getUTCMinutes()),
		ss: pad2(d.getUTCSeconds()),
	};
}

function partsToIso(parts: UtcParts): string | null {
	const y = Number(parts.yyyy);
	const mo = Number(parts.mm);
	const d = Number(parts.dd);
	const h = Number(parts.hh);
	const mi = Number(parts.mi);
	const s = Number(parts.ss);
	if (
		!Number.isInteger(y) ||
		y < 1970 ||
		!Number.isInteger(mo) ||
		mo < 1 ||
		mo > 12 ||
		!Number.isInteger(d) ||
		d < 1 ||
		d > 31 ||
		!Number.isInteger(h) ||
		h < 0 ||
		h > 23 ||
		!Number.isInteger(mi) ||
		mi < 0 ||
		mi > 59 ||
		!Number.isInteger(s) ||
		s < 0 ||
		s > 59
	) {
		return null;
	}
	const iso = `${String(y).padStart(4, "0")}-${pad2(mo)}-${pad2(d)}T${pad2(h)}:${pad2(mi)}:${pad2(s)}Z`;
	const parsed = new Date(iso);
	if (Number.isNaN(parsed.getTime())) return null;
	if (
		parsed.getUTCFullYear() !== y ||
		parsed.getUTCMonth() + 1 !== mo ||
		parsed.getUTCDate() !== d
	) {
		return null;
	}
	return iso;
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
	loop,
	onLoop,
	universeChoices,
	onSaveSchedule,
	savingSchedule,
	scheduleError,
	budgets,
	onSaveBudgets,
	savingBudgets,
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
	loop: LoopSettings;
	onLoop: (next: LoopSettings) => void;
	universeChoices: string[];
	onSaveSchedule: () => void;
	savingSchedule?: boolean | undefined;
	scheduleError?: string | null | undefined;
	budgets: PocApiBudget[];
	onSaveBudgets: (next: PocApiBudget[]) => void;
	savingBudgets?: boolean | undefined;
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
					<ScheduleSection
						loop={loop}
						onLoop={onLoop}
						universeChoices={universeChoices}
						onSave={onSaveSchedule}
						saving={savingSchedule}
						error={scheduleError}
					/>

					<BudgetsSection
						budgets={budgets}
						onSave={onSaveBudgets}
						saving={savingBudgets}
					/>

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

function ScheduleSection({
	loop,
	onLoop,
	universeChoices,
	onSave,
	saving,
	error,
}: {
	loop: LoopSettings;
	onLoop: (next: LoopSettings) => void;
	universeChoices: string[];
	onSave: () => void;
	saving?: boolean | undefined;
	error?: string | null | undefined;
}) {
	const split = splitInterval(loop.intervalSeconds);
	const [customN, setCustomN] = useState(String(split.n));
	const [customUnit, setCustomUnit] = useState<CadenceUnit>(split.unit);

	useEffect(() => {
		const next = splitInterval(loop.intervalSeconds);
		setCustomN(String(next.n));
		setCustomUnit(next.unit);
	}, [loop.intervalSeconds]);

	function applySeconds(seconds: number) {
		onLoop({
			...loop,
			intervalSeconds: Math.max(MIN_INTERVAL_S, Math.round(seconds)),
		});
	}

	return (
		<section>
			<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				Schedule
			</h3>
			<p className="mb-3 text-xs text-muted-foreground">
				UTC window and cadence. Save before Start. Floor is {MIN_INTERVAL_S}s.
			</p>
			<label className="mb-3 block text-[10px] uppercase tracking-wide text-muted-foreground">
				Max credit / order (USD)
				<input
					type="number"
					min={1}
					step={50}
					value={loop.maxCredit}
					onChange={(event) =>
						onLoop({
							...loop,
							maxCredit: Math.max(1, Number(event.target.value) || 0),
						})
					}
					className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-xs normal-case text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
				/>
			</label>
			<p className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
				Cadence
			</p>
			<div className="mb-2 flex flex-wrap gap-1">
				{CADENCE_PRESETS.map((item) => {
					const active = item.seconds === loop.intervalSeconds;
					return (
						<button
							key={item.label}
							type="button"
							onClick={() => applySeconds(item.seconds)}
							className={`rounded-md px-2 py-1 text-xs font-semibold uppercase ${
								active
									? "bg-primary text-primary-foreground"
									: "border border-border text-muted-foreground hover:text-foreground"
							}`}
						>
							{item.label}
						</button>
					);
				})}
			</div>
			<div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
				<span>custom</span>
				<input
					type="number"
					min={1}
					step={1}
					value={customN}
					onChange={(event) => {
						const n = Math.max(1, Math.round(Number(event.target.value) || 0));
						setCustomN(String(n));
						applySeconds(n * unitSeconds(customUnit));
					}}
					className="h-8 w-16 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
				/>
				<select
					value={customUnit}
					onChange={(event) => {
						const unit = event.target.value as CadenceUnit;
						setCustomUnit(unit);
						applySeconds(Number(customN || 1) * unitSeconds(unit));
					}}
					className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none"
					aria-label="Cadence unit"
				>
					<option value="s">s</option>
					<option value="m">m</option>
					<option value="h">h</option>
				</select>
			</div>
			<p className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
				Window (UTC)
			</p>
			<div className="mb-2 space-y-2">
				<UtcDateTimeField
					label="Start"
					value={loop.windowStart}
					onChange={(iso) => onLoop({ ...loop, windowStart: iso })}
				/>
				<UtcDateTimeField
					label="End"
					value={loop.windowEnd}
					onChange={(iso) => onLoop({ ...loop, windowEnd: iso })}
				/>
			</div>
			<p className="mb-3 text-xs text-muted-foreground">
				On end: Stop agents + cancel pending + flatten positions
			</p>
			<p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
				Universe
			</p>
			<div className="mb-3 grid grid-cols-2 gap-1.5">
				{universeChoices.map((item) => {
					const checked = loop.universe.includes(item);
					return (
						<label
							key={item}
							className="flex items-center gap-1.5 text-xs text-foreground"
						>
							<input
								type="checkbox"
								checked={checked}
								onChange={() => {
									const next = checked
										? loop.universe.filter((sym) => sym !== item)
										: [...loop.universe, item];
									if (next.length === 0) return;
									onLoop({ ...loop, universe: next });
								}}
							/>
							{item}
						</label>
					);
				})}
			</div>
			<Button
				type="button"
				variant="secondary"
				onClick={onSave}
				disabled={saving}
			>
				{saving ? "Saving…" : "Save schedule"}
			</Button>
			{error ? <p className="mt-2 text-xs text-short">{error}</p> : null}
		</section>
	);
}

function UtcDateTimeField({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string | null;
	onChange: (iso: string | null) => void;
}) {
	const [parts, setParts] = useState<UtcParts>(() => isoToParts(value));
	const refs = useRef<Array<HTMLInputElement | null>>([]);

	useEffect(() => {
		setParts(isoToParts(value));
	}, [value]);

	const fields: { key: keyof UtcParts; max: number; placeholder: string }[] = [
		{ key: "dd", max: 2, placeholder: "dd" },
		{ key: "mm", max: 2, placeholder: "mm" },
		{ key: "yyyy", max: 4, placeholder: "yyyy" },
		{ key: "hh", max: 2, placeholder: "hh" },
		{ key: "mi", max: 2, placeholder: "mm" },
		{ key: "ss", max: 2, placeholder: "ss" },
	];

	function update(key: keyof UtcParts, raw: string, index: number, max: number) {
		const digits = raw.replace(/\D/g, "").slice(0, max);
		const next = { ...parts, [key]: digits };
		setParts(next);
		onChange(partsToIso(next));
		if (digits.length >= max) {
			refs.current[index + 1]?.focus();
		}
	}

	return (
		<div className="flex flex-wrap items-center gap-1.5">
			<span className="w-10 text-[10px] uppercase tracking-wide text-muted-foreground">
				{label}
			</span>
			{fields.map((field, index) => (
				<input
					key={field.key}
					ref={(el) => {
						refs.current[index] = el;
					}}
					inputMode="numeric"
					placeholder={field.placeholder}
					value={parts[field.key]}
					onChange={(event) =>
						update(field.key, event.target.value, index, field.max)
					}
					className={`h-8 rounded-md border border-input bg-background px-1 text-center font-mono text-xs text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
						field.key === "yyyy" ? "w-14" : "w-9"
					}`}
					aria-label={`${label} ${field.placeholder} UTC`}
				/>
			))}
			<Badge variant="outline" className="uppercase">
				UTC
			</Badge>
		</div>
	);
}

function BudgetsSection({
	budgets,
	onSave,
	saving,
}: {
	budgets: PocApiBudget[];
	onSave: (next: PocApiBudget[]) => void;
	saving?: boolean | undefined;
}) {
	const [draft, setDraft] = useState<PocApiBudget[]>(budgets);

	useEffect(() => {
		setDraft(budgets);
	}, [budgets]);

	function update(index: number, patch: Partial<PocApiBudget>) {
		setDraft((rows) =>
			rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
		);
	}

	return (
		<section>
			<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				Budgets
			</h3>
			<p className="mb-3 text-xs text-muted-foreground">
				Per-window caps. Warn then degrade; OVER stops the scheduler.
			</p>
			{draft.length === 0 ? (
				<p className="mb-3 text-xs text-muted-foreground">No budgets loaded.</p>
			) : (
				<div className="mb-3 space-y-2">
					{draft.map((row, index) => (
						<div
							key={`${row.provider}-${row.limit_type}`}
							className="grid grid-cols-[5rem_1fr_4.5rem] items-center gap-2 text-xs"
						>
							<span className="font-mono uppercase text-foreground">
								{row.provider}
							</span>
							<label className="text-[10px] uppercase tracking-wide text-muted-foreground">
								{row.limit_type}
								<input
									type="number"
									min={0}
									step={1}
									value={row.limit_value}
									onChange={(event) =>
										update(index, {
											limit_value: Math.max(0, Number(event.target.value) || 0),
										})
									}
									className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs normal-case text-foreground outline-none"
								/>
							</label>
							<label className="text-[10px] uppercase tracking-wide text-muted-foreground">
								warn %
								<input
									type="number"
									min={1}
									max={100}
									step={1}
									value={row.warn_pct}
									onChange={(event) =>
										update(index, {
											warn_pct: Math.min(
												100,
												Math.max(1, Math.round(Number(event.target.value) || 0)),
											),
										})
									}
									className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs normal-case text-foreground outline-none"
								/>
							</label>
						</div>
					))}
				</div>
			)}
			<Button
				type="button"
				variant="secondary"
				onClick={() => onSave(draft)}
				disabled={saving || draft.length === 0}
			>
				{saving ? "Saving…" : "Save budgets"}
			</Button>
		</section>
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

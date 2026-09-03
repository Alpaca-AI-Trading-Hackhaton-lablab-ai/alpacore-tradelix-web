import { Play, Square } from "lucide-react";
import { useEffect, useState } from "react";
import type { PocApiUsage, PocSchedule } from "@/api/market-client";
import { orderStatusClass } from "@/lib/format";

function pad(n: number) {
	return String(n).padStart(2, "0");
}

function formatUtc(iso: string | null | undefined): string {
	if (!iso) return "—";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "—";
	return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}

function cadenceLabel(seconds: number): string {
	if (seconds % 86400 === 0) return `every ${seconds / 86400}d`;
	if (seconds % 3600 === 0) return `every ${seconds / 3600}h`;
	if (seconds % 60 === 0) return `every ${seconds / 60}m`;
	return `every ${seconds}s`;
}

function countdown(
	target: string | null | undefined,
	now: number,
	inFlight: boolean,
	state: string,
): string {
	if (inFlight) return "running";
	if (state === "paused") return "paused";
	if (state === "ended") return "ended";
	if (state === "disabled") return "stopped";
	if (!target) return "waiting";
	const ms = new Date(target).getTime() - now;
	if (Number.isNaN(ms)) return "waiting";
	if (ms <= 0) return "due";
	const total = Math.floor(ms / 1000);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	if (hours > 0) return `next ${hours}h ${minutes}m`;
	if (minutes > 0) return `next ${minutes}m ${seconds}s`;
	return `next ${seconds}s`;
}

function budgetPct(entries: PocApiUsage[] | undefined): number | null {
	if (!entries?.length) return null;
	let used = 0;
	let limit = 0;
	for (const row of entries) {
		if (row.limit == null || row.limit <= 0) continue;
		used += row.used;
		limit += row.limit;
	}
	if (limit <= 0) return null;
	return Math.round((used / limit) * 100);
}

export function ScheduleChip({
	schedule,
	usage,
	onStart,
	onStop,
	onNeedOptions,
	startPending,
	stopPending,
}: {
	schedule?: PocSchedule | null;
	usage?: PocApiUsage[] | undefined;
	onStart: () => void;
	onStop: () => void;
	onNeedOptions: () => void;
	startPending?: boolean | undefined;
	stopPending?: boolean | undefined;
}) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	}, []);

	const state = String(schedule?.state ?? "disabled");
	const enabled = Boolean(schedule?.enabled);
	const inFlight = Boolean(schedule?.in_flight);
	const busy = Boolean(startPending || stopPending);
	const pct = budgetPct(usage);
	const target =
		state === "scheduled" ? schedule?.window_start : schedule?.next_run_ts;
	const ready = Boolean(
		schedule?.window_start &&
			schedule?.window_end &&
			(schedule.interval_seconds ?? 0) >= 30 &&
			(schedule.max_credit ?? 0) > 0 &&
			(schedule.universe?.length ?? 0) > 0,
	);

	function handleToggle() {
		if (enabled && state !== "ended") {
			onStop();
			return;
		}
		if (!ready) {
			onNeedOptions();
			return;
		}
		onStart();
	}

	return (
		<div className="inline-flex items-center gap-1.5">
			<span
				className={`max-w-[22rem] truncate text-[11px] ${orderStatusClass(state)}`}
				title="Schedule status (UTC)"
			>
				⏱ {cadenceLabel(schedule?.interval_seconds ?? 1800)}
				{" · "}
				{state}
				{" · UTC "}
				{formatUtc(schedule?.window_start)}→{formatUtc(schedule?.window_end)}
				{" · "}
				{countdown(target, now, inFlight, state)}
				{pct != null ? ` · budget ${pct}%` : ""}
			</span>
			<button
				type="button"
				onClick={handleToggle}
				disabled={busy}
				className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-semibold uppercase text-foreground transition hover:bg-muted/40 disabled:opacity-50"
			>
				{enabled && state !== "ended" ? (
					<Square className="size-3" />
				) : (
					<Play className="size-3" />
				)}
				{enabled && state !== "ended" ? "Stop" : "Start"}
			</button>
		</div>
	);
}

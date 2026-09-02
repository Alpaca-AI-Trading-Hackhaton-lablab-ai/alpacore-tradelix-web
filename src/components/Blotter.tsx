import { Rocket, ScrollText } from "lucide-react";
import { useState } from "react";
import type {
	PocControl,
	PocInvocation,
	PocOrderResult,
	PocPosition,
} from "@/api/market-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	formatMoney,
	formatNumber,
	gateVerdictClass,
	orderStatusClass,
} from "@/lib/format";

export type DecisionLogEntry = {
	id: string;
	at: string;
	kind: "DRY_RUN" | "ORDER";
	symbol: string;
	action: string;
	status: string;
	size: number;
	verdict?: string;
};

type Tab = "positions" | "execution" | "invocations" | "log";

const TABS: { id: Tab; label: string }[] = [
	{ id: "positions", label: "Positions" },
	{ id: "execution", label: "Execution" },
	{ id: "invocations", label: "Invocations" },
	{ id: "log", label: "Decision Log" },
];

export function Blotter({
	symbol,
	positions,
	orderResult,
	control,
	invocations,
	decisionLog,
}: {
	symbol: string;
	positions: PocPosition[];
	orderResult: PocOrderResult | null;
	control: PocControl | undefined;
	invocations: PocInvocation[];
	decisionLog: DecisionLogEntry[];
}) {
	const [tab, setTab] = useState<Tab>("positions");

	return (
		<Card className="lg:col-span-4">
			<CardHeader className="pb-0">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<CardTitle>Blotter</CardTitle>
					<div className="flex flex-wrap gap-1">
						{TABS.map((item) => (
							<button
								key={item.id}
								type="button"
								onClick={() => setTab(item.id)}
								className={`rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
									tab === item.id
										? "bg-primary text-primary-foreground"
										: "text-muted-foreground hover:text-foreground"
								}`}
							>
								{item.label}
							</button>
						))}
					</div>
				</div>
			</CardHeader>
			<CardContent className="pt-5">
				{tab === "positions" ? <PositionsTable positions={positions} /> : null}
				{tab === "execution" ? (
					<ExecutionPanel
						symbol={symbol}
						positions={positions}
						orderResult={orderResult}
						control={control}
					/>
				) : null}
				{tab === "invocations" ? (
					<InvocationsTable entries={invocations} />
				) : null}
				{tab === "log" ? <DecisionLogTable entries={decisionLog} /> : null}
			</CardContent>
		</Card>
	);
}

function PositionsTable({ positions }: { positions: PocPosition[] }) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Symbol</TableHead>
					<TableHead>Side</TableHead>
					<TableHead>Qty</TableHead>
					<TableHead>Avg entry</TableHead>
					<TableHead>Market value</TableHead>
					<TableHead>Unrealized P/L</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{positions.map((p) => (
					<TableRow key={p.symbol}>
						<TableCell>{p.symbol}</TableCell>
						<TableCell>{p.side}</TableCell>
						<TableCell>{formatNumber(p.qty, 4)}</TableCell>
						<TableCell>{formatMoney(p.avg_entry_price)}</TableCell>
						<TableCell>{formatMoney(p.market_value)}</TableCell>
						<TableCell>{formatMoney(p.unrealized_pl)}</TableCell>
					</TableRow>
				))}
				{positions.length === 0 && (
					<TableRow>
						<TableCell colSpan={6} className="py-4 text-muted-foreground">
							No open positions.
						</TableCell>
					</TableRow>
				)}
			</TableBody>
		</Table>
	);
}

function ExecutionPanel({
	symbol,
	positions,
	orderResult,
	control,
}: {
	symbol: string;
	positions: PocPosition[];
	orderResult: PocOrderResult | null;
	control: PocControl | undefined;
}) {
	return (
		<div>
			<div className="mb-4 flex items-center justify-between">
				<div className="flex items-center gap-2 text-sm font-semibold">
					<Rocket className="size-4 text-muted-foreground" />
					Order Execution
				</div>
				<span className={orderStatusClass(orderResult?.status)}>
					{orderResult?.status ?? "IDLE"}
				</span>
			</div>
			<div className="grid gap-4 md:grid-cols-3">
				<Step
					label="1 · Order submitted"
					ok={Boolean(orderResult?.order_id)}
					detail={
						orderResult?.order_id
							? `#${orderResult.order_id.slice(0, 8)}`
							: orderResult?.status === "NO_TRADE"
								? "No trade (HOLD)"
								: orderResult?.status === "BLOCKED"
									? (orderResult.reason ?? "blocked by gate")
									: orderResult?.status === "DRY_RUN"
										? "dry-run (not armed)"
										: (orderResult?.error ?? "—")
					}
				/>
				<Step
					label="2 · Order filled"
					ok={orderResult?.status === "FILLED"}
					pending={["SUBMITTED", "ACCEPTED", "PARTIALLY_FILLED"].includes(
						orderResult?.status ?? "",
					)}
					detail={
						orderResult?.status === "FILLED"
							? `${formatNumber(orderResult.filled_qty, 4)} @ ${formatMoney(
									orderResult.filled_avg_price ?? undefined,
								)}`
							: (orderResult?.reason ??
								orderResult?.order_status ??
								"not filled")
					}
				/>
				<Step
					label="3 · Position created"
					ok={positions.some(
						(p) => p.symbol === (orderResult?.decision?.symbol ?? symbol),
					)}
					detail={
						positions.find(
							(p) => p.symbol === (orderResult?.decision?.symbol ?? symbol),
						)
							? "in portfolio"
							: "not created"
					}
				/>
			</div>
			{orderResult?.gate ? (
				<p className="mt-4 text-xs text-muted-foreground">
					Gate:{" "}
					<span className={gateVerdictClass(orderResult.gate.verdict)}>
						{orderResult.gate.verdict}
					</span>
					{orderResult.gate.reasons[0]
						? ` · ${orderResult.gate.reasons[0]}`
						: ""}
					{!control?.armed && orderResult.status === "DRY_RUN"
						? " · arm the system to send"
						: ""}
				</p>
			) : null}
			{orderResult?.mode === "demo" ? (
				<p className="mt-4 text-xs text-gold">
					Demo mode: no Alpaca paper credentials; nothing was sent to the
					broker.
				</p>
			) : null}
		</div>
	);
}

function InvocationsTable({ entries }: { entries: PocInvocation[] }) {
	return (
		<>
			<div className="mb-3 flex items-center gap-2 text-sm font-semibold">
				<ScrollText className="size-4 text-muted-foreground" />
				Invocations
			</div>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Time</TableHead>
						<TableHead>Agent</TableHead>
						<TableHead>Kind</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>ms</TableHead>
						<TableHead>Summary</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{entries.map((entry) => (
						<TableRow key={entry.id}>
							<TableCell className="whitespace-nowrap">
								{entry.ts ? new Date(entry.ts).toLocaleString() : "—"}
							</TableCell>
							<TableCell>{entry.agent_id}</TableCell>
							<TableCell>{entry.kind}</TableCell>
							<TableCell>{entry.status ?? "—"}</TableCell>
							<TableCell>{entry.latency_ms ?? "—"}</TableCell>
							<TableCell className="max-w-md truncate">
								{entry.summary ?? "—"}
							</TableCell>
						</TableRow>
					))}
					{entries.length === 0 && (
						<TableRow>
							<TableCell colSpan={6} className="py-4 text-muted-foreground">
								Run the pipeline to record invocations.
							</TableCell>
						</TableRow>
					)}
				</TableBody>
			</Table>
		</>
	);
}

function DecisionLogTable({ entries }: { entries: DecisionLogEntry[] }) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Time</TableHead>
					<TableHead>Type</TableHead>
					<TableHead>Symbol</TableHead>
					<TableHead>Action</TableHead>
					<TableHead>Status</TableHead>
					<TableHead>Gate</TableHead>
					<TableHead>Size</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{entries.map((entry) => (
					<TableRow key={entry.id}>
						<TableCell>{new Date(entry.at).toLocaleString()}</TableCell>
						<TableCell>
							{entry.kind === "ORDER" ? "Order" : "Dry-run"}
						</TableCell>
						<TableCell>{entry.symbol}</TableCell>
						<TableCell>{entry.action}</TableCell>
						<TableCell>{entry.status}</TableCell>
						<TableCell>{entry.verdict ?? "—"}</TableCell>
						<TableCell>{formatMoney(entry.size)}</TableCell>
					</TableRow>
				))}
				{entries.length === 0 && (
					<TableRow>
						<TableCell colSpan={7} className="py-4 text-muted-foreground">
							No entries yet.
						</TableCell>
					</TableRow>
				)}
			</TableBody>
		</Table>
	);
}

function Step({
	label,
	ok,
	pending,
	detail,
}: {
	label: string;
	ok: boolean;
	pending?: boolean;
	detail?: string;
}) {
	const state = ok ? "OK" : pending ? "PENDING" : "NO";
	const mark = ok ? "✓" : pending ? "…" : "✕";
	const color = ok ? "text-long" : pending ? "text-gold" : "text-short";
	return (
		<div className="rounded-lg border border-border/60 bg-muted/40 p-4">
			<div className="text-xs text-muted-foreground">{label}</div>
			<div className={`mt-1 text-lg font-semibold ${color}`}>
				{mark} {state}
			</div>
			<div className="mt-1 truncate text-xs text-muted-foreground">
				{detail ?? "—"}
			</div>
		</div>
	);
}

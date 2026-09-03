import { Rocket, ScrollText } from "lucide-react";
import { useState } from "react";
import type {
	PocApiUsage,
	PocConditionalOrder,
	PocControl,
	PocInvocation,
	PocOrderResult,
	PocPosition,
	WouldCall,
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

type Tab =
	| "positions"
	| "execution"
	| "conditionals"
	| "invocations"
	| "log"
	| "usage";

const TABS: { id: Tab; label: string }[] = [
	{ id: "positions", label: "Positions" },
	{ id: "execution", label: "Execution" },
	{ id: "conditionals", label: "Conditional Orders" },
	{ id: "invocations", label: "Invocations" },
	{ id: "log", label: "Decision Log" },
	{ id: "usage", label: "Usage" },
];

export function Blotter({
	symbol,
	positions,
	orderResult,
	control,
	invocations,
	decisionLog,
	conditionals,
	onCancelConditional,
	usage,
}: {
	symbol: string;
	positions: PocPosition[];
	orderResult: PocOrderResult | null;
	control: PocControl | undefined;
	invocations: PocInvocation[];
	decisionLog: DecisionLogEntry[];
	conditionals: PocConditionalOrder[];
	onCancelConditional?: ((id: string) => void) | undefined;
	usage?: PocApiUsage[];
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
				{tab === "conditionals" ? (
					<ConditionalsTable
						orders={conditionals}
						onCancel={onCancelConditional}
					/>
				) : null}
				{tab === "invocations" ? (
					<InvocationsTable entries={invocations} />
				) : null}
				{tab === "log" ? <DecisionLogTable entries={decisionLog} /> : null}
				{tab === "usage" ? <UsageTable entries={usage ?? []} /> : null}
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
			<WouldCallList calls={asWouldCallList(orderResult?.would_call)} />
		</div>
	);
}

function asWouldCallList(
	value: PocOrderResult["would_call"],
): WouldCall[] {
	if (!value) return [];
	return Array.isArray(value) ? value : [value];
}

function WouldCallList({ calls }: { calls: WouldCall[] }) {
	if (calls.length === 0) return null;
	return (
		<ol className="mt-4 space-y-1 font-mono text-[11px] text-muted-foreground">
			{calls.map((call, i) => (
				<li key={`${call.order_class ?? call.type}-${i}`}>
					{i + 1}. {call.order_class ?? call.type ?? call.tool}
					{call.emulated ? " (emulated)" : ""}
					{call.notional != null ? ` · $${call.notional}` : ""}
					{call.take_profit?.limit_price != null
						? ` · TP ${call.take_profit.limit_price}`
						: ""}
					{call.stop_loss?.stop_price != null
						? ` · SL ${call.stop_loss.stop_price}`
						: ""}
				</li>
			))}
		</ol>
	);
}

function ConditionalsTable({
	orders,
	onCancel,
}: {
	orders: PocConditionalOrder[];
	onCancel?: ((id: string) => void) | undefined;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Status</TableHead>
					<TableHead>Symbol</TableHead>
					<TableHead>Trigger</TableHead>
					<TableHead>Side</TableHead>
					<TableHead>Size</TableHead>
					<TableHead>Created</TableHead>
					<TableHead />
				</TableRow>
			</TableHeader>
			<TableBody>
				{orders.map((row) => (
					<TableRow key={row.id}>
						<TableCell>
							<span className={orderStatusClass(row.status.toUpperCase())}>
								{row.status}
							</span>
						</TableCell>
						<TableCell>{row.symbol ?? row.plan.symbol}</TableCell>
						<TableCell className="font-mono text-xs">
							{row.trigger.kind === "price"
								? `${row.trigger.op} ${row.trigger.price}`
								: `webhook · ${row.trigger.token_source}`}
						</TableCell>
						<TableCell>{row.plan.side}</TableCell>
						<TableCell>{formatMoney(row.plan.size.notional)}</TableCell>
						<TableCell>
							{row.created_ts
								? new Date(row.created_ts).toLocaleString()
								: "—"}
						</TableCell>
						<TableCell>
							{row.status === "armed" || row.status === "working" ? (
								<button
									type="button"
									className="text-xs text-short"
									onClick={() => onCancel?.(row.id)}
								>
									Cancel
								</button>
							) : null}
						</TableCell>
					</TableRow>
				))}
				{orders.length === 0 && (
					<TableRow>
						<TableCell colSpan={7} className="py-4 text-muted-foreground">
							No conditional orders. Arm a price or webhook trigger from the
							ticket.
						</TableCell>
					</TableRow>
				)}
			</TableBody>
		</Table>
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

function UsageTable({ entries }: { entries: PocApiUsage[] }) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Provider</TableHead>
					<TableHead>Used</TableHead>
					<TableHead>Budget</TableHead>
					<TableHead>Remaining</TableHead>
					<TableHead>Est. $</TableHead>
					<TableHead>State</TableHead>
					<TableHead>Degrade</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{entries.map((row) => {
					const pct =
						row.limit != null && row.limit > 0
							? Math.min(100, Math.round((row.used / row.limit) * 100))
							: null;
					return (
						<TableRow key={row.provider}>
							<TableCell className="uppercase">{row.provider}</TableCell>
							<TableCell className="font-mono">
								{formatNumber(row.used, 0)}
								{pct != null ? (
									<div className="mt-1 h-1.5 w-24 overflow-hidden rounded bg-muted">
										<div
											className={`h-full ${
												row.state === "OVER"
													? "bg-short"
													: row.state === "WARN"
														? "bg-gold"
														: "bg-long"
											}`}
											style={{ width: `${pct}%` }}
										/>
									</div>
								) : null}
							</TableCell>
							<TableCell>
								{row.limit != null ? formatNumber(row.limit, 0) : "—"}
							</TableCell>
							<TableCell>
								{row.remaining != null ? formatNumber(row.remaining, 0) : "—"}
							</TableCell>
							<TableCell>{formatMoney(row.est_cost_usd)}</TableCell>
							<TableCell>
								<span className={orderStatusClass(String(row.state))}>
									{row.state}
								</span>
							</TableCell>
							<TableCell>{row.degrade_level}</TableCell>
						</TableRow>
					);
				})}
				{entries.length === 0 && (
					<TableRow>
						<TableCell colSpan={7} className="py-4 text-muted-foreground">
							No usage recorded for this window.
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

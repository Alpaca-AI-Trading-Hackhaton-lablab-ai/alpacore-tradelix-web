import { useEffect, useMemo } from "react";
import type {
	BracketPreviewOut,
	PocBracketPlan,
	PocDecision,
	PocPosition,
	PocTrigger,
} from "@/api/market-client";
import { Button } from "@/components/ui/button";
import { actionClass, formatMoney, formatNumber, orderStatusClass } from "@/lib/format";
import {
	addTakeProfit,
	breakEvenPrice,
	maxLoss,
	removeTakeProfit,
	rMultiple,
	seedPlan,
	summarizeTrigger,
	validatePlan,
} from "@/lib/order-plan";

type Props = {
	symbol: string;
	decision: PocDecision | undefined;
	lastPrice: number | undefined;
	atr: number | undefined;
	position: PocPosition | undefined;
	plan: PocBracketPlan | null;
	dirty: boolean;
	onPlanChange: (plan: PocBracketPlan | null, dirty: boolean) => void;
	trigger: PocTrigger | null;
	onTriggerChange: (trigger: PocTrigger | null) => void;
	preview: BracketPreviewOut | null;
	ticketState: "draft" | "previewed";
	onDryRun: () => void;
	dryRunPending?: boolean | undefined;
};

const inputCls =
	"h-7 w-full rounded border border-input bg-background px-1.5 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function OrderTicket({
	symbol,
	decision,
	lastPrice,
	atr,
	position,
	plan,
	dirty,
	onPlanChange,
	trigger,
	onTriggerChange,
	preview,
	ticketState,
	onDryRun,
	dryRunPending,
}: Props) {
	const hold = (decision?.action ?? "HOLD").toUpperCase() === "HOLD" || !decision;

	useEffect(() => {
		if (dirty) return;
		onPlanChange(seedPlan(decision, lastPrice, atr), false);
	}, [decision, lastPrice, atr, dirty, onPlanChange]);

	const check = useMemo(() => validatePlan(plan), [plan]);
	const r = plan ? rMultiple(plan) : null;
	const loss = plan ? maxLoss(plan) : null;
	const be = plan ? breakEvenPrice(plan, position?.avg_entry_price) : null;

	const setPlan = (next: PocBracketPlan) => onPlanChange(next, true);

	const disabled = hold || !plan;

	return (
		<div className="space-y-3 border-t border-border/60 pt-4" data-testid="order-ticket">
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs uppercase tracking-wide text-muted-foreground">
					Order Ticket
				</span>
				<span className={orderStatusClass(ticketState === "previewed" ? "DRY_RUN" : undefined)}>
					{ticketState}
				</span>
			</div>

			{position ? (
				<div className="rounded-md border border-border/60 bg-muted/40 px-2 py-1 font-mono text-[10px] text-muted-foreground">
					{position.side} · {formatNumber(position.qty, 3)} · avg{" "}
					{formatMoney(position.avg_entry_price)} · uPnL{" "}
					{formatMoney(position.unrealized_pl)}
				</div>
			) : null}

			{hold || !plan ? (
				<p className="text-xs text-muted-foreground">
					Ticket disabled while the decision is HOLD. Run the pipeline for a BUY/SELL.
				</p>
			) : (
				<>
					<div className="flex gap-1">
						{(["buy", "sell"] as const).map((side) => (
							<button
								key={side}
								type="button"
								disabled={disabled}
								onClick={() => setPlan({ ...plan, side })}
								className={`h-7 flex-1 rounded-md text-xs font-semibold uppercase ${
									plan.side === side
										? actionClass(side === "buy" ? "BUY" : "SELL") +
											" bg-muted"
										: "text-muted-foreground"
								}`}
							>
								{side}
							</button>
						))}
					</div>

					<label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
						Size
						<input
							className={`${inputCls} mt-1`}
							type="number"
							min={0}
							value={plan.size.notional ?? 0}
							onChange={(e) =>
								setPlan({
									...plan,
									size: { ...plan.size, notional: Number(e.target.value) },
								})
							}
						/>
					</label>

					<div className="grid grid-cols-2 gap-2">
						<label className="text-[10px] uppercase tracking-wide text-muted-foreground">
							Entry
							<select
								className={`${inputCls} mt-1`}
								value={plan.entry.type}
								onChange={(e) =>
									setPlan({
										...plan,
										entry: {
											...plan.entry,
											type: e.target.value as PocBracketPlan["entry"]["type"],
										},
									})
								}
							>
								<option value="market">Market</option>
								<option value="limit">Limit</option>
							</select>
						</label>
						<label className="text-[10px] uppercase tracking-wide text-muted-foreground">
							@ {symbol}
							<input
								className={`${inputCls} mt-1`}
								type="number"
								step="0.01"
								value={plan.entry.price ?? ""}
								onChange={(e) =>
									setPlan({
										...plan,
										entry: { ...plan.entry, price: Number(e.target.value) },
									})
								}
							/>
						</label>
					</div>

					<div className="flex justify-between text-xs">
						<span className="text-muted-foreground">R:R</span>
						<span className="font-mono text-gold">{formatNumber(r ?? undefined, 2)}</span>
					</div>
					<div className="flex justify-between text-[10px] text-muted-foreground">
						<span>Max loss {formatMoney(loss ?? undefined)}</span>
						<span>BE {formatNumber(be ?? undefined, 2)}</span>
					</div>

					<div className="space-y-1.5">
						<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
							Take profit
						</div>
						{plan.tps.map((tp, i) => (
							<div key={`tp-${i}`} className="grid grid-cols-[1fr_52px_28px] gap-1">
								<input
									className={inputCls}
									type="number"
									step="0.01"
									aria-label={`TP${i + 1} price`}
									value={tp.price ?? ""}
									onChange={(e) => {
										const tps = plan.tps.map((row, idx) =>
											idx === i ? { ...row, price: Number(e.target.value) } : row,
										);
										setPlan({ ...plan, tps });
									}}
								/>
								<input
									className={inputCls}
									type="number"
									min={0}
									max={100}
									aria-label={`TP${i + 1} size percent`}
									value={tp.size_pct ?? 0}
									onChange={(e) => {
										const tps = plan.tps.map((row, idx) =>
											idx === i ? { ...row, size_pct: Number(e.target.value) } : row,
										);
										setPlan({ ...plan, tps });
									}}
								/>
								<button
									type="button"
									className="text-xs text-muted-foreground hover:text-short"
									disabled={plan.tps.length <= 1}
									onClick={() => setPlan(removeTakeProfit(plan, i))}
									aria-label={`Remove TP${i + 1}`}
								>
									×
								</button>
							</div>
						))}
						<button
							type="button"
							className="text-[10px] font-semibold uppercase text-gold"
							onClick={() => setPlan(addTakeProfit(plan))}
						>
							+ add TP
						</button>
					</div>

					<div className="space-y-1.5">
						<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
							Stop loss
						</div>
						<div className="flex gap-1">
							{(["fixed", "trailing", "follow_tp"] as const).map((mode) => (
								<button
									key={mode}
									type="button"
									onClick={() => {
										const sl = {
											role: "sl" as const,
											type:
												mode === "trailing"
													? ("trailing_stop" as const)
													: ("stop" as const),
											mode,
											trailing_distance_pct: plan.sl?.trailing_distance_pct ?? 1,
										};
										setPlan({
											...plan,
											sl:
												plan.sl?.price != null
													? { ...sl, price: plan.sl.price }
													: sl,
										});
									}}
									className={`h-6 flex-1 rounded text-[10px] font-semibold uppercase ${
										(plan.sl?.mode ?? "fixed") === mode
											? "bg-secondary text-foreground"
											: "text-muted-foreground"
									}`}
								>
									{mode === "follow_tp" ? "Follow-TP" : mode}
								</button>
							))}
						</div>
						<input
							className={inputCls}
							type="number"
							step="0.01"
							aria-label="Stop loss price"
							value={plan.sl?.price ?? ""}
							onChange={(e) =>
								setPlan({
									...plan,
									sl: {
										role: "sl",
										type: plan.sl?.type ?? "stop",
										mode: plan.sl?.mode ?? "fixed",
										price: Number(e.target.value),
									},
								})
							}
						/>
						<label className="flex items-center gap-2 text-[11px] text-muted-foreground">
							<input
								type="checkbox"
								checked={plan.break_even?.on === "tp1_fill"}
								onChange={(e) =>
									setPlan({
										...plan,
										break_even: {
											on: e.target.checked ? "tp1_fill" : "price",
											fees_frac: 0,
										},
									})
								}
							/>
							Break-even on TP1 fill
						</label>
					</div>

					<div className="space-y-1.5">
						<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
							Conditional
						</div>
						<select
							className={inputCls}
							value={trigger?.kind ?? "none"}
							onChange={(e) => {
								const kind = e.target.value;
								if (kind === "price") {
									onTriggerChange({
										kind: "price",
										op: plan.side === "buy" ? ">=" : "<=",
										price: plan.entry.price ?? lastPrice ?? 0,
									});
								} else if (kind === "webhook") {
									onTriggerChange({ kind: "webhook", token_source: "missing" });
								} else {
									onTriggerChange(null);
								}
							}}
						>
							<option value="none">Immediate</option>
							<option value="price">Price</option>
							<option value="webhook">Webhook</option>
						</select>
						{trigger?.kind === "price" ? (
							<div className="grid grid-cols-[48px_1fr] gap-1">
								<select
									className={inputCls}
									value={trigger.op}
									onChange={(e) =>
										onTriggerChange({
											...trigger,
											op: e.target.value as ">=" | "<=",
										})
									}
								>
									<option value=">=">≥</option>
									<option value="<=">≤</option>
								</select>
								<input
									className={inputCls}
									type="number"
									step="0.01"
									value={trigger.price}
									onChange={(e) =>
										onTriggerChange({
											...trigger,
											price: Number(e.target.value),
										})
									}
								/>
							</div>
						) : null}
						<p className="text-[10px] leading-snug text-muted-foreground">
							{summarizeTrigger(plan, trigger)}
						</p>
					</div>

					{!check.ok ? (
						<ul className="text-[10px] text-short">
							{check.errors.map((err) => (
								<li key={err}>{err}</li>
							))}
						</ul>
					) : null}

					<Button
						type="button"
						variant="secondary"
						size="sm"
						className="w-full"
						onClick={onDryRun}
						disabled={dryRunPending || !check.ok}
					>
						{dryRunPending ? "Previewing…" : "Dry-run plan"}
					</Button>

					{preview?.would_call?.length ? (
						<ol className="space-y-1 font-mono text-[10px] text-muted-foreground">
							{preview.would_call.map((call, i) => (
								<li key={`${call.order_class ?? call.type}-${i}`}>
									{call.order_class ?? call.type ?? call.tool}
									{call.emulated ? " · emulated" : ""}
									{call.take_profit?.limit_price != null
										? ` · TP ${call.take_profit.limit_price}`
										: ""}
									{call.stop_loss?.stop_price != null
										? ` · SL ${call.stop_loss.stop_price}`
										: ""}
								</li>
							))}
						</ol>
					) : null}
				</>
			)}
		</div>
	);
}

import type {
	PocBracketPlan,
	PocDecision,
	PocOrderLeg,
	PocTrigger,
	WouldCall,
} from "@/api/market-client";

function num(value: unknown, fallback?: number): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return fallback;
}

export function entryPrice(plan: PocBracketPlan | null | undefined): number | undefined {
	return num(plan?.entry?.price);
}

export function planNotional(plan: PocBracketPlan | null | undefined): number {
	return num(plan?.size?.notional, 0) ?? 0;
}

export function seedPlan(
	decision: PocDecision | undefined,
	lastPrice: number | undefined,
	atr?: number | null,
	feesFrac = 0,
): PocBracketPlan | null {
	const action = (decision?.action ?? "HOLD").toUpperCase();
	const symbol = (decision?.symbol ?? "SPY").toUpperCase();
	const notional = num(decision?.position_size, 0) ?? 0;
	const entry = num(lastPrice);
	if (action !== "BUY" && action !== "SELL") return null;
	if (entry == null || entry <= 0) return null;
	const side = action === "BUY" ? "buy" : "sell";
	let atrN = num(atr);
	if (atrN == null || atrN <= 0) atrN = entry * 0.01;
	const sl = Number((side === "buy" ? entry - atrN : entry + atrN).toFixed(4));
	const tp = Number((side === "buy" ? entry + 2 * atrN : entry - 2 * atrN).toFixed(4));
	return {
		symbol,
		side,
		size: { notional: Number(notional.toFixed(2)) },
		entry: { role: "entry", type: "market", price: Number(entry.toFixed(4)) },
		tps: [{ role: "tp", type: "limit", price: tp, size_pct: 100 }],
		sl: { role: "sl", type: "stop", price: sl, mode: "fixed" },
		break_even: { on: "tp1_fill", fees_frac: feesFrac },
	};
}

export function rMultiple(plan: PocBracketPlan | null | undefined): number | null {
	const entry = entryPrice(plan);
	const sl = num(plan?.sl?.price);
	const tp = num(plan?.tps?.[0]?.price);
	if (entry == null || sl == null || tp == null || entry === sl) return null;
	return Math.abs(tp - entry) / Math.abs(entry - sl);
}

export function breakEvenPrice(
	plan: PocBracketPlan | null | undefined,
	avgEntry?: number,
): number | null {
	const fees = num(plan?.break_even?.fees_frac, 0) ?? 0;
	const entry = avgEntry != null ? num(avgEntry) : entryPrice(plan);
	if (entry == null) return null;
	if (plan?.side === "sell") return Number((entry * (1 - fees)).toFixed(4));
	return Number((entry * (1 + fees)).toFixed(4));
}

export function maxLoss(plan: PocBracketPlan | null | undefined): number | null {
	const entry = entryPrice(plan);
	const sl = num(plan?.sl?.price);
	const notional = planNotional(plan);
	if (entry == null || sl == null || entry <= 0) return null;
	return Number((notional * Math.abs(entry - sl) / entry).toFixed(2));
}

export function validatePlan(plan: PocBracketPlan | null | undefined): {
	ok: boolean;
	errors: string[];
	r_multiple: number | null;
	max_loss: number | null;
} {
	const errors: string[] = [];
	if (!plan) {
		return { ok: false, errors: ["missing plan"], r_multiple: null, max_loss: null };
	}
	const side = plan.side;
	if (side !== "buy" && side !== "sell") errors.push("side must be buy or sell");
	const entry = entryPrice(plan);
	if (entry == null || entry <= 0) errors.push("entry price required");
	const sl = plan.sl;
	const slPrice = num(sl?.price);
	const slMode = (sl?.mode ?? "fixed").toLowerCase();
	if (slMode === "fixed" && slPrice == null) errors.push("stop loss price required");
	if (entry != null && slPrice != null) {
		if (side === "buy" && slPrice >= entry) errors.push("long SL must be below entry");
		if (side === "sell" && slPrice <= entry) errors.push("short SL must be above entry");
	}
	const pcts: number[] = [];
	const prices: number[] = [];
	(plan.tps ?? []).forEach((tp, i) => {
		const price = num(tp.price);
		const pct = num(tp.size_pct, 0) ?? 0;
		if (price == null) errors.push(`tp${i + 1} price required`);
		else {
			prices.push(price);
			if (entry != null) {
				if (side === "buy" && price <= entry) errors.push(`tp${i + 1} must be above entry`);
				if (side === "sell" && price >= entry) errors.push(`tp${i + 1} must be below entry`);
			}
		}
		pcts.push(pct);
	});
	if ((plan.tps?.length ?? 0) > 0 && Math.abs(pcts.reduce((a, b) => a + b, 0) - 100) > 0.01) {
		errors.push("TP size_pct must sum to 100");
	}
	if (prices.length >= 2) {
		for (let i = 0; i < prices.length - 1; i++) {
			const a = prices[i] ?? 0;
			const b = prices[i + 1] ?? 0;
			if (side === "buy" && a >= b) errors.push("long TPs must be strictly increasing");
			if (side === "sell" && a <= b) errors.push("short TPs must be strictly decreasing");
		}
	}
	if (planNotional(plan) <= 0 && plan.size.qty == null) {
		errors.push("size notional or qty required");
	}
	const r = errors.length === 0 ? rMultiple(plan) : null;
	return {
		ok: errors.length === 0,
		errors,
		r_multiple: r == null ? null : Number(r.toFixed(4)),
		max_loss: maxLoss(plan),
	};
}

export function buildWouldCall(
	plan: PocBracketPlan | null | undefined,
	trigger?: PocTrigger,
): {
	would_call: WouldCall[];
	risk: {
		r_multiple: number | null;
		max_loss: number | null;
		break_even: string | null;
	};
	conditional?: PocTrigger;
} {
	if (!plan) {
		return {
			would_call: [],
			risk: { r_multiple: null, max_loss: null, break_even: null },
		};
	}
	const side = plan.side;
	const symbol = plan.symbol;
	const notional = planNotional(plan);
	const tps = plan.tps ?? [];
	const sl = plan.sl;
	const first = tps[0];
	const slMode = (sl?.mode ?? "fixed").toLowerCase();
	const trailingOnly = slMode === "trailing" && tps.length === 0;
	const calls: WouldCall[] = [];
	if (trailingOnly) {
		const trail: WouldCall = {
			tool: "place_stock_order",
			type: "trailing_stop",
			symbol,
			side,
			notional,
			emulated: Boolean(sl?.trailing_start || sl?.improve_only),
		};
		const dist = sl?.trailing_distance_pct ?? sl?.trailing_distance;
		if (dist != null) trail.trail_percent = dist;
		calls.push(trail);
	} else {
		const call: WouldCall = {
			tool: "place_stock_order",
			order_class: "bracket",
			symbol,
			side,
			notional,
			entry: plan.entry?.type ?? "market",
		};
		if (first?.price != null) call.take_profit = { limit_price: first.price };
		if (sl?.price != null) call.stop_loss = { stop_price: sl.price };
		if (slMode === "trailing") call.emulated = true;
		calls.push(call);
		for (const tp of tps.slice(1)) {
			const extra: WouldCall = {
				tool: "place_stock_order",
				type: "limit",
				symbol,
				side: side === "buy" ? "sell" : "buy",
				qty: "<remainder>",
				emulated: true,
			};
			if (tp.price != null) extra.limit_price = tp.price;
			if (tp.size_pct != null) extra.size_pct = tp.size_pct;
			calls.push(extra);
		}
	}
	return {
		would_call: calls,
		risk: {
			r_multiple: rMultiple(plan),
			max_loss: maxLoss(plan),
			break_even: plan.break_even?.on ?? null,
		},
		...(trigger ? { conditional: trigger } : {}),
	};
}

export function updateLegPrice(
	plan: PocBracketPlan,
	role: "entry" | "sl" | "be" | `tp${number}`,
	price: number,
): PocBracketPlan {
	const next: PocBracketPlan = {
		...plan,
		entry: { ...plan.entry },
		tps: plan.tps.map((tp) => ({ ...tp })),
		size: { ...plan.size },
	};
	if (plan.sl) next.sl = { ...plan.sl };
	if (role === "entry") next.entry = { ...next.entry, price };
	else if (role === "sl" && next.sl) next.sl = { ...next.sl, price };
	else if (role.startsWith("tp")) {
		const idx = Number(role.slice(2)) - 1;
		if (next.tps[idx]) next.tps[idx] = { ...next.tps[idx], price };
	}
	return next;
}

export function addTakeProfit(plan: PocBracketPlan): PocBracketPlan {
	const tps = plan.tps.map((tp) => ({ ...tp }));
	const last = tps[tps.length - 1];
	const entry = entryPrice(plan) ?? 0;
	const lastPx = num(last?.price) ?? entry;
	const step = Math.abs(lastPx - entry) || entry * 0.01;
	const nextPrice =
		plan.side === "buy" ? lastPx + step : lastPx - step;
	const share = tps.length === 0 ? 100 : Number((100 / (tps.length + 1)).toFixed(2));
	const resized: PocOrderLeg[] = tps.map((tp) => ({ ...tp, size_pct: share }));
	resized.push({
		role: "tp",
		type: "limit",
		price: Number(nextPrice.toFixed(4)),
		size_pct: Number((100 - share * tps.length).toFixed(2)),
	});
	return { ...plan, tps: resized };
}

export function removeTakeProfit(plan: PocBracketPlan, index: number): PocBracketPlan {
	if (plan.tps.length <= 1) return plan;
	const tps = plan.tps.filter((_, i) => i !== index).map((tp) => ({ ...tp }));
	const share = Number((100 / tps.length).toFixed(2));
	tps.forEach((tp, i) => {
		tp.size_pct = i === tps.length - 1 ? Number((100 - share * (tps.length - 1)).toFixed(2)) : share;
	});
	return { ...plan, tps };
}

export function summarizeTrigger(
	plan: PocBracketPlan,
	trigger?: PocTrigger | null,
): string {
	const side = plan.side.toUpperCase();
	const size = planNotional(plan);
	const tps = plan.tps.map((tp) => tp.price).filter((p) => p != null).join("/");
	const sl = plan.sl?.mode === "trailing" ? "trail SL" : `SL ${plan.sl?.price ?? "—"}`;
	const body = `${side} $${size}, TP ${tps || "—"}, ${sl}`;
	if (!trigger) return body;
	if (trigger.kind === "price") {
		return `When ${plan.symbol} ${trigger.op} ${trigger.price} → ${body}`;
	}
	return `When webhook (${trigger.token_source}) → ${body}`;
}

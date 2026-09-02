export function toNumber(
	value: string | number | undefined,
): number | undefined {
	if (typeof value === "number") return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

export function formatMoney(value: number | undefined): string {
	if (value === undefined || !Number.isFinite(value)) return "—";
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: 2,
	}).format(value);
}

export function formatNumber(
	value: number | undefined,
	digits: number,
): string {
	if (value === undefined || !Number.isFinite(value)) return "—";
	return value.toFixed(digits);
}

export function classifyStatus(status: string | undefined): string {
	const s = (status ?? "").toLowerCase();
	if (s === "filled") return "FILLED";
	if (["rejected", "canceled", "expired", "done_for_day"].includes(s))
		return "REJECTED";
	if (["accepted", "new", "pending_new", "accepted_for_bidding"].includes(s))
		return "ACCEPTED";
	if (s === "partially_filled") return "PARTIALLY_FILLED";
	if (s === "submitted") return "SUBMITTED";
	return (status ?? "—").toUpperCase();
}

export function orderStatusClass(status: string | undefined): string {
	const base = "text-sm font-semibold";
	if (status === "FILLED") return `${base} text-long`;
	if (status === "REJECTED" || status === "FAILED" || status === "BLOCKED")
		return `${base} text-short`;
	if (
		status === "SUBMITTED" ||
		status === "ACCEPTED" ||
		status === "PARTIALLY_FILLED" ||
		status === "DRY_RUN"
	)
		return `${base} text-gold`;
	return `${base} text-muted-foreground`;
}

export function gateVerdictClass(verdict: string | undefined): string {
	const base = "text-sm font-bold uppercase";
	if (verdict === "ALLOW") return `${base} text-long`;
	if (verdict === "BLOCK") return `${base} text-short`;
	return `${base} text-muted-foreground`;
}

export function actionClass(action: string | undefined): string {
	const base = "text-3xl font-semibold";
	if (action === "BUY") return `${base} text-long`;
	if (action === "SELL") return `${base} text-short`;
	if (action === "HOLD") return `${base} text-gold`;
	return `${base} text-muted-foreground`;
}

export function riskClass(riskLevel: string | undefined): string {
	const base = "text-base font-semibold";
	if (riskLevel === "LOW") return `${base} text-long`;
	if (riskLevel === "MEDIUM") return `${base} text-gold`;
	if (riskLevel === "HIGH") return `${base} text-short`;
	return `${base} text-muted-foreground`;
}

export function statusClass(status: string | undefined): string {
	const base = "text-base font-semibold";
	if (status === "BULLISH") return `${base} text-long`;
	if (status === "BEARISH") return `${base} text-short`;
	if (status === "NEUTRAL") return `${base} text-gold`;
	return `${base} text-muted-foreground`;
}

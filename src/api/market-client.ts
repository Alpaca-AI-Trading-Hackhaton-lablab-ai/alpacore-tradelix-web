import { env } from "../env";

export type PocMarketState = {
	symbol: string;
	sentiment: "BULLISH" | "BEARISH" | "NEUTRAL" | string;
	confidence: number;
	trade_bias: "CALL" | "PUT" | "WAIT" | string;
	trend: string;
	price: number;
	rsi: number;
	sma20: number;
	sma50: number;
	technical_signal: "BUY" | "SELL" | "HOLD" | string;
	option_strategy: string;
};

export type PocRisk = {
	account_balance: number;
	confidence: number;
	risk_level: "LOW" | "MEDIUM" | "HIGH" | string;
	position_size: number;
	max_loss: number;
	take_profit: number;
};

export type PocDecision = {
	symbol: string;
	action: "BUY" | "SELL" | "HOLD" | string;
	position_size: number;
	technical_signal: string;
	sentiment: string;
	risk_level: string;
	error?: string;
};

export type PocAccount = {
	equity?: string | number;
	cash?: string | number;
	buying_power?: string | number;
	status?: string;
	[key: string]: unknown;
};

export type PocQuote = {
	symbol?: string;
	price?: number;
	[key: string]: unknown;
};

export type DryRunPreview = {
	status: "DRY_RUN" | "NO_TRADE";
	reason: string;
	would_call: null | {
		tool: "place_stock_order";
		symbol: string;
		side: "buy" | "sell";
		notional_position_size: number;
	};
	decision: PocDecision;
};

const base = () => env.VITE_API_URL.replace(/\/$/, "");

async function getJson<T>(path: string): Promise<T> {
	const res = await fetch(`${base()}${path}`);
	if (!res.ok) throw new Error(`${path} ${res.status}`);
	return res.json() as Promise<T>;
}

export async function fetchMarketState(): Promise<PocMarketState> {
	return getJson<PocMarketState>("/market-state");
}

export async function fetchRisk(): Promise<PocRisk> {
	return getJson<PocRisk>("/risk");
}

export async function fetchDecision(): Promise<PocDecision> {
	return getJson<PocDecision>("/decision");
}

export async function fetchAccount(): Promise<PocAccount> {
	return getJson<PocAccount>("/account");
}

export async function fetchSpyQuote(): Promise<PocQuote> {
	return getJson<PocQuote>("/spy");
}

export function buildDryRunPreview(decision: PocDecision): DryRunPreview {
	if (decision.error) {
		return {
			status: "NO_TRADE",
			reason: decision.error,
			would_call: null,
			decision,
		};
	}

	if (decision.action === "HOLD") {
		return {
			status: "NO_TRADE",
			reason: "Decision Agent returned HOLD",
			would_call: null,
			decision,
		};
	}

	const side = decision.action === "SELL" ? "sell" : "buy";
	return {
		status: "DRY_RUN",
		reason: "Execution preview only",
		would_call: {
			tool: "place_stock_order",
			symbol: decision.symbol,
			side,
			notional_position_size: decision.position_size,
		},
		decision,
	};
}

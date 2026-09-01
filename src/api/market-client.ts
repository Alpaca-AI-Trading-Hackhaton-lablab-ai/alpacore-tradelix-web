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
	ema20?: number;
	macd?: number;
	atr?: number;
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
	rationale?: string;
	confidence?: number;
	model?: string;
	error?: string;
};

export type PocGateCheck = {
	name: string;
	ok: boolean;
	detail: string;
	hard?: boolean;
};

export type PocGate = {
	verdict: "ALLOW" | "BLOCK" | "NO_TRADE" | string;
	action?: string;
	symbol?: string;
	notional?: number;
	checks: PocGateCheck[];
	reasons: string[];
};

export type PocControl = {
	armed: boolean;
	kill: boolean;
	execute_enabled_default: boolean;
};

export type PocAuditEntry = {
	ts: string;
	symbol?: string | null;
	action?: string | null;
	verdict?: string | null;
	status?: string | null;
	notional?: number | null;
	order_id?: string | null;
	reasons?: string[] | null;
};

export type PocAccount = {
	equity?: string | number;
	cash?: string | number;
	buying_power?: string | number;
	status?: string;
	mode?: string;
	[key: string]: unknown;
};

export type PocQuote = {
	symbol?: string;
	price?: number;
	[key: string]: unknown;
};

export type PocOrderResult = {
	status:
		| "FILLED"
		| "ACCEPTED"
		| "PARTIALLY_FILLED"
		| "REJECTED"
		| "SUBMITTED"
		| "NO_TRADE"
		| "BLOCKED"
		| "DRY_RUN"
		| "FAILED"
		| string;
	order_id?: string;
	order_status?: string;
	filled_qty?: number;
	filled_avg_price?: number | null;
	notional?: number | null;
	reason?: string | null;
	mode?: string;
	decision?: PocDecision;
	gate?: PocGate;
	error?: string;
};

export type PocPosition = {
	symbol: string;
	qty: number;
	side: string;
	avg_entry_price: number;
	market_value: number;
	unrealized_pl: number;
};

export type PocPositions = {
	mode: string;
	positions: PocPosition[];
	warning?: string;
};

export type PocNodeStatus = "idle" | "running" | "done" | "error";

export type PocPipelineNode = {
	node: string;
	status: PocNodeStatus;
	message?: string | null;
	// biome-ignore lint/suspicious/noExplicitAny: output shape varies per agent
	output?: any;
	model?: string | null;
	ts?: number;
};

export type PocReactTurn = {
	kind?: "react";
	node: string;
	turn?: number;
	thought?: string | null;
	tool?: string | null;
	observation?: string | null;
	ts?: number;
};

export type PocGroqModel = {
	id: string;
	label: string;
	role_hint?: string | null;
};

export type PocModelsCatalog = {
	allowlist: PocGroqModel[];
	defaults: { sentiment: string; decision: string };
};

export type PipelineOpts = {
	deep?: boolean;
	sentimentModel?: string;
	decisionModel?: string;
	indicators?: string;
	decisionIndicators?: string;
	deepSentiment?: boolean;
	deepDecision?: boolean;
};

export type PocBar = {
	time: number;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
};

export type PocLinePoint = { time: number; value: number; color?: string };

export type PocBars = {
	symbol: string;
	indicators?: string[];
	candles: PocBar[];
	overlays: Record<string, PocLinePoint[]>;
	oscillators: Record<string, PocLinePoint[]>;
	volume: PocLinePoint[];
	snapshot: Record<string, unknown>;
	error?: string;
};

export const INDICATOR_OPTIONS = [
	{ id: "sma20", label: "SMA 20" },
	{ id: "sma50", label: "SMA 50" },
	{ id: "ema20", label: "EMA 20" },
	{ id: "rsi", label: "RSI 14" },
	{ id: "macd", label: "MACD" },
	{ id: "volume", label: "Volume" },
	{ id: "atr", label: "ATR 14" },
] as const;

export type PocPipeline = {
	symbol: string;
	nodes: PocPipelineNode[];
	news?: unknown;
	sentiment?: unknown;
	options?: unknown;
	features?: unknown;
	technical?: unknown;
	market_state?: PocMarketState;
	account?: PocAccount;
	risk?: PocRisk;
	decision?: PocDecision;
	gate?: PocGate;
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

function withQuery(path: string, symbol: string, opts?: PipelineOpts): string {
	const params = new URLSearchParams({ symbol });
	if (opts?.deep) params.set("deep", "true");
	if (opts?.sentimentModel) params.set("sentiment_model", opts.sentimentModel);
	if (opts?.decisionModel) params.set("decision_model", opts.decisionModel);
	if (opts?.indicators) params.set("indicators", opts.indicators);
	if (opts?.decisionIndicators)
		params.set("decision_indicators", opts.decisionIndicators);
	if (opts?.deepSentiment) params.set("deep_sentiment", "true");
	if (opts?.deepDecision) params.set("deep_decision", "true");
	if (opts?.deepSentiment === false) params.set("deep_sentiment", "false");
	if (opts?.deepDecision === false) params.set("deep_decision", "false");
	return `${path}?${params.toString()}`;
}

const withSymbol = (path: string, symbol: string) => withQuery(path, symbol);

async function getJson<T>(path: string): Promise<T> {
	const res = await fetch(`${base()}${path}`);
	if (!res.ok) throw new Error(`${path} ${res.status}`);
	return res.json() as Promise<T>;
}

async function postJson<T>(path: string): Promise<T> {
	const res = await fetch(`${base()}${path}`, { method: "POST" });
	if (!res.ok) throw new Error(`${path} ${res.status}`);
	return res.json() as Promise<T>;
}

export async function fetchMarketState(
	symbol: string,
): Promise<PocMarketState> {
	return getJson<PocMarketState>(withSymbol("/market-state", symbol));
}

export async function fetchRisk(symbol: string): Promise<PocRisk> {
	return getJson<PocRisk>(withSymbol("/risk", symbol));
}

export async function fetchDecision(symbol: string): Promise<PocDecision> {
	return getJson<PocDecision>(withSymbol("/decision", symbol));
}

export async function fetchAccount(): Promise<PocAccount> {
	return getJson<PocAccount>("/account");
}

export async function fetchSpyQuote(symbol: string): Promise<PocQuote> {
	return getJson<PocQuote>(withSymbol("/spy", symbol));
}

export async function executeOrder(
	symbol: string,
	opts?: PipelineOpts,
): Promise<PocOrderResult> {
	return postJson<PocOrderResult>(withQuery("/execute", symbol, opts));
}

export async function fetchOrderStatus(
	orderId: string,
): Promise<PocOrderResult> {
	return getJson<PocOrderResult>(`/order/${encodeURIComponent(orderId)}`);
}

export async function fetchPositions(): Promise<PocPositions> {
	return getJson<PocPositions>("/positions");
}

export async function fetchPipeline(
	symbol: string,
	opts?: PipelineOpts,
): Promise<PocPipeline> {
	return getJson<PocPipeline>(withQuery("/pipeline", symbol, opts));
}

export async function fetchModels(): Promise<PocModelsCatalog> {
	return getJson<PocModelsCatalog>("/models");
}

export async function fetchBars(
	symbol: string,
	indicators?: string | undefined,
): Promise<PocBars> {
	const opts: PipelineOpts = {};
	if (indicators) opts.indicators = indicators;
	return getJson<PocBars>(withQuery("/bars", symbol, opts));
}

export async function fetchControl(): Promise<PocControl> {
	return getJson<PocControl>("/control");
}

export async function setArmed(enabled: boolean): Promise<PocControl> {
	return postJson<PocControl>(`/control/arm?enabled=${enabled}`);
}

export async function setKill(enabled: boolean): Promise<PocControl> {
	return postJson<PocControl>(`/control/kill?enabled=${enabled}`);
}

export async function fetchAudit(
	limit = 20,
): Promise<{ entries: PocAuditEntry[] }> {
	return getJson<{ entries: PocAuditEntry[] }>(`/audit?limit=${limit}`);
}

export type KeySource = "db" | "env" | "missing";

export type PocAgentSettingsRow = {
	model?: string;
	deep?: boolean;
	indicators?: string[];
};

export type PocSettings = {
	keys: {
		groq: KeySource;
		tavily: KeySource;
		alpaca_api_key: KeySource;
		alpaca_secret_key: KeySource;
	};
	agents: {
		sentiment: PocAgentSettingsRow;
		decision: PocAgentSettingsRow;
		technical: PocAgentSettingsRow;
		features: PocAgentSettingsRow;
	};
};

export type PocInvocation = {
	id: number;
	ts: string | null;
	run_id?: string | null;
	symbol?: string | null;
	agent_id: string;
	kind: string;
	model?: string | null;
	latency_ms?: number | null;
	status?: string | null;
	summary?: string | null;
};

export async function fetchSettings(): Promise<PocSettings> {
	return getJson<PocSettings>("/settings");
}

export async function saveSettings(body: {
	keys?: Partial<Record<string, string>>;
	agents?: Record<string, PocAgentSettingsRow>;
}): Promise<PocSettings> {
	const res = await fetch(`${base()}/settings`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`/settings ${res.status}`);
	return res.json() as Promise<PocSettings>;
}

export async function fetchLogs(opts?: {
	symbol?: string;
	agent?: string;
	limit?: number;
}): Promise<{ entries: PocInvocation[] }> {
	const params = new URLSearchParams();
	if (opts?.symbol) params.set("symbol", opts.symbol);
	if (opts?.agent) params.set("agent", opts.agent);
	params.set("limit", String(opts?.limit ?? 40));
	return getJson<{ entries: PocInvocation[] }>(`/logs?${params.toString()}`);
}

export type StreamHandlers = {
	onNode: (node: PocPipelineNode) => void;
	onReact?: (turn: PocReactTurn) => void;
	onDone?: () => void;
	onError?: (err: unknown) => void;
};

/**
 * Opens an SSE connection to /pipeline/stream and calls onNode for each node
 * event (running -> done|error). Returns the EventSource so it can be closed.
 */
export function streamPipeline(
	symbol: string,
	handlers: StreamHandlers,
	opts?: PipelineOpts,
): EventSource {
	const url = `${base()}${withQuery("/pipeline/stream", symbol, opts)}`;
	const es = new EventSource(url);

	es.addEventListener("node", (event) => {
		try {
			handlers.onNode(JSON.parse((event as MessageEvent).data));
		} catch (err) {
			handlers.onError?.(err);
		}
	});

	es.addEventListener("react", (event) => {
		try {
			handlers.onReact?.(JSON.parse((event as MessageEvent).data));
		} catch (err) {
			handlers.onError?.(err);
		}
	});

	es.addEventListener("done", () => {
		es.close();
		handlers.onDone?.();
	});

	es.onerror = (err) => {
		es.close();
		handlers.onError?.(err);
	};

	return es;
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

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	KeyRound,
	PlayCircle,
	Power,
	RefreshCw,
	Rocket,
	ScrollText,
	ShieldAlert,
	ShieldCheck,
	WalletCards,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
	buildDryRunPreview,
	executeOrder,
	fetchAccount,
	fetchBars,
	fetchControl,
	fetchLogs,
	fetchModels,
	fetchOrderStatus,
	fetchPositions,
	fetchSettings,
	fetchSpyQuote,
	INDICATOR_OPTIONS,
	type PipelineOpts,
	type PocDecision,
	type PocGate,
	type PocMarketState,
	type PocOrderResult,
	type PocRisk,
	type PocSettings,
	saveSettings,
	setArmed,
	setKill,
} from "@/api/market-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { env } from "@/env";
import { AgentGraph, type AgentSettings } from "./AgentGraph";
import { PriceChart } from "./PriceChart";

const SYMBOLS = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA"];
const ALL_INDICATORS = INDICATOR_OPTIONS.map((item) => item.id);

const EMPTY_SETTINGS: AgentSettings = {
	sentimentModel: "",
	decisionModel: "",
	deepSentiment: false,
	deepDecision: false,
	indicators: [...ALL_INDICATORS],
	decisionIndicators: [...ALL_INDICATORS],
};

function agentsToSettings(
	agents: PocSettings["agents"],
	fallback: AgentSettings,
): AgentSettings {
	return {
		sentimentModel: agents.sentiment.model || fallback.sentimentModel,
		decisionModel: agents.decision.model || fallback.decisionModel,
		deepSentiment: Boolean(agents.sentiment.deep),
		deepDecision: Boolean(agents.decision.deep),
		indicators: agents.technical.indicators?.length
			? [...agents.technical.indicators]
			: fallback.indicators,
		decisionIndicators: agents.decision.indicators?.length
			? [...agents.decision.indicators]
			: fallback.decisionIndicators,
	};
}

function settingsToAgents(settings: AgentSettings) {
	return {
		sentiment: {
			model: settings.sentimentModel,
			deep: settings.deepSentiment,
		},
		decision: {
			model: settings.decisionModel,
			deep: settings.deepDecision,
			indicators: settings.decisionIndicators,
		},
		technical: { indicators: settings.indicators },
		features: { indicators: settings.indicators },
	};
}

function sourceBadge(source: string | undefined) {
	if (source === "db") return "success" as const;
	if (source === "env") return "warning" as const;
	return "outline" as const;
}

function settingsToOpts(settings: AgentSettings): PipelineOpts {
	const opts: PipelineOpts = {
		deepSentiment: settings.deepSentiment,
		deepDecision: settings.deepDecision,
	};
	if (settings.deepSentiment || settings.deepDecision) opts.deep = true;
	if (settings.sentimentModel) opts.sentimentModel = settings.sentimentModel;
	if (settings.decisionModel) opts.decisionModel = settings.decisionModel;
	if (settings.indicators.length)
		opts.indicators = settings.indicators.join(",");
	if (settings.decisionIndicators.length)
		opts.decisionIndicators = settings.decisionIndicators.join(",");
	return opts;
}

export function TradingDashboard() {
	const [symbol, setSymbol] = useState(env.VITE_DEFAULT_SYMBOL.toUpperCase());
	const queryClient = useQueryClient();
	const [orderResult, setOrderResult] = useState<PocOrderResult | null>(null);
	const [settings, setSettings] = useState<AgentSettings>(EMPTY_SETTINGS);
	const [keyDraft, setKeyDraft] = useState({
		groq: "",
		tavily: "",
		alpaca_api_key: "",
		alpaca_secret_key: "",
	});
	const hydrated = useRef(false);
	const skipPersist = useRef(true);
	const [decisionLog, setDecisionLog] = useState<
		Array<{
			id: string;
			at: string;
			kind: "DRY_RUN" | "ORDER";
			symbol: string;
			action: string;
			status: string;
			size: number;
			verdict?: string;
		}>
	>([]);

	const pushLog = (entry: {
		kind: "DRY_RUN" | "ORDER";
		symbol: string;
		action: string;
		status: string;
		size: number;
		verdict?: string;
	}) =>
		setDecisionLog((items) =>
			[
				{ id: crypto.randomUUID(), at: new Date().toISOString(), ...entry },
				...items,
			].slice(0, 10),
		);

	const marketQuery = useQuery<PocMarketState>({
		queryKey: ["market", symbol],
		queryFn: async () => {
			throw new Error("seeded by pipeline");
		},
		enabled: false,
	});
	const riskQuery = useQuery<PocRisk>({
		queryKey: ["risk", symbol],
		queryFn: async () => {
			throw new Error("seeded by pipeline");
		},
		enabled: false,
	});
	const decisionQuery = useQuery<PocDecision>({
		queryKey: ["decision", symbol],
		queryFn: async () => {
			throw new Error("seeded by pipeline");
		},
		enabled: false,
	});
	const accountQuery = useQuery({
		queryKey: ["account"],
		queryFn: fetchAccount,
		refetchInterval: 30_000,
	});
	const quoteQuery = useQuery({
		queryKey: ["quote", symbol],
		queryFn: () => fetchSpyQuote(symbol),
		refetchInterval: 30_000,
	});
	const positionsQuery = useQuery({
		queryKey: ["positions"],
		queryFn: fetchPositions,
		refetchInterval: 30_000,
	});
	const controlQuery = useQuery({
		queryKey: ["control"],
		queryFn: fetchControl,
		refetchInterval: 30_000,
	});
	const modelsQuery = useQuery({
		queryKey: ["models"],
		queryFn: fetchModels,
		staleTime: Number.POSITIVE_INFINITY,
	});
	const storedQuery = useQuery({
		queryKey: ["settings"],
		queryFn: fetchSettings,
	});
	const logsQuery = useQuery({
		queryKey: ["logs", symbol],
		queryFn: () => fetchLogs({ symbol, limit: 40 }),
		refetchInterval: 10_000,
	});
	const catalog = modelsQuery.data;
	const mergedSettings: AgentSettings = {
		...settings,
		sentimentModel:
			settings.sentimentModel || catalog?.defaults.sentiment || "",
		decisionModel: settings.decisionModel || catalog?.defaults.decision || "",
	};
	const pipelineOpts = settingsToOpts(mergedSettings);
	const barsQuery = useQuery({
		queryKey: ["bars", symbol, mergedSettings.indicators.join(",")],
		queryFn: () =>
			fetchBars(symbol, mergedSettings.indicators.join(",") || undefined),
		refetchInterval: 60_000,
	});
	const gateQuery = useQuery<PocGate>({
		queryKey: ["gate", symbol],
		queryFn: async () => {
			throw new Error("seeded by pipeline");
		},
		enabled: false,
	});

	useEffect(() => {
		if (!storedQuery.data) return;
		skipPersist.current = true;
		hydrated.current = true;
		setSettings((prev) => agentsToSettings(storedQuery.data.agents, prev));
	}, [storedQuery.data]);

	useEffect(() => {
		if (!hydrated.current) return;
		if (skipPersist.current) {
			skipPersist.current = false;
			return;
		}
		const toSave: AgentSettings = {
			...settings,
			sentimentModel:
				settings.sentimentModel || catalog?.defaults.sentiment || "",
			decisionModel: settings.decisionModel || catalog?.defaults.decision || "",
		};
		const handle = window.setTimeout(() => {
			void saveSettings({ agents: settingsToAgents(toSave) }).then((view) =>
				queryClient.setQueryData(["settings"], view),
			);
		}, 500);
		return () => window.clearTimeout(handle);
	}, [
		settings,
		catalog?.defaults.sentiment,
		catalog?.defaults.decision,
		queryClient,
	]);

	const arm = useMutation({
		mutationFn: (enabled: boolean) => setArmed(enabled),
		onSuccess: (state) => queryClient.setQueryData(["control"], state),
	});
	const kill = useMutation({
		mutationFn: (enabled: boolean) => setKill(enabled),
		onSuccess: (state) => queryClient.setQueryData(["control"], state),
	});

	const refresh = useMutation({
		mutationFn: async () => {
			await queryClient.invalidateQueries({ queryKey: ["account"] });
			await queryClient.invalidateQueries({ queryKey: ["quote"] });
			await queryClient.invalidateQueries({ queryKey: ["positions"] });
			await queryClient.invalidateQueries({ queryKey: ["control"] });
			await queryClient.invalidateQueries({ queryKey: ["bars"] });
			await queryClient.invalidateQueries({ queryKey: ["logs"] });
			await queryClient.invalidateQueries({ queryKey: ["settings"] });
		},
	});

	const saveKeys = useMutation({
		mutationFn: async () => {
			const keys: Record<string, string> = {};
			for (const [name, value] of Object.entries(keyDraft)) {
				if (value.trim()) keys[name] = value.trim();
			}
			if (Object.keys(keys).length === 0) return storedQuery.data;
			return saveSettings({ keys });
		},
		onSuccess: (view) => {
			if (view) queryClient.setQueryData(["settings"], view);
			setKeyDraft({
				groq: "",
				tavily: "",
				alpaca_api_key: "",
				alpaca_secret_key: "",
			});
			void queryClient.invalidateQueries({ queryKey: ["account"] });
		},
	});

	const dryRun = useMutation({
		mutationFn: async () => {
			const cached = queryClient.getQueryData<PocDecision>([
				"decision",
				symbol,
			]);
			if (!cached) throw new Error("Run the pipeline first");
			return cached;
		},
		onSuccess: (decision) => {
			const preview = buildDryRunPreview(decision);
			pushLog({
				kind: "DRY_RUN",
				symbol: decision.symbol,
				action: decision.action,
				status: preview.status,
				size: decision.position_size,
			});
			queryClient.setQueryData(["decision", symbol], decision);
		},
	});

	const execute = useMutation({
		mutationFn: () => executeOrder(symbol, pipelineOpts),
		onSuccess: async (result) => {
			setOrderResult(result);
			pushLog({
				kind: "ORDER",
				symbol: result.decision?.symbol ?? symbol,
				action: result.decision?.action ?? "—",
				status: result.status,
				size: result.notional ?? result.decision?.position_size ?? 0,
				...(result.gate?.verdict ? { verdict: result.gate.verdict } : {}),
			});
			// Re-read positions/account and, if still pending, reconcile by polling.
			await queryClient.invalidateQueries({ queryKey: ["positions"] });
			await queryClient.invalidateQueries({ queryKey: ["account"] });
			await queryClient.invalidateQueries({ queryKey: ["logs"] });
			if (
				result.order_id &&
				["SUBMITTED", "ACCEPTED", "PARTIALLY_FILLED"].includes(result.status)
			) {
				const orderId = result.order_id;
				for (let i = 0; i < 5; i++) {
					await new Promise((r) => setTimeout(r, 1000));
					const latest = await fetchOrderStatus(orderId);
					const status = classifyStatus(latest.status);
					setOrderResult((prev) => ({ ...prev, ...latest, status }));
					if (["FILLED", "REJECTED"].includes(status)) break;
				}
				await queryClient.invalidateQueries({ queryKey: ["positions"] });
			}
		},
		onError: (err) => {
			setOrderResult({
				status: "FAILED",
				error: err instanceof Error ? err.message : "execute failed",
			});
		},
	});

	const market = marketQuery.data;
	const risk = riskQuery.data;
	const decision = decisionQuery.data;
	const account = accountQuery.data;
	const quote = quoteQuery.data;
	const positions = positionsQuery.data?.positions ?? [];
	const control = controlQuery.data;
	const gate: PocGate | undefined = orderResult?.gate ?? gateQuery.data;
	const isLoading = accountQuery.isLoading || quoteQuery.isLoading;
	const error =
		accountQuery.error || quoteQuery.error || barsQuery.error || null;

	return (
		<div
			className="dark min-h-screen bg-background text-foreground"
			data-testid="tradelix-dashboard"
		>
			<div className="border-b border-border bg-card/60 backdrop-blur">
				<div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 px-6 py-2">
					<span className="font-serif text-base text-foreground">{symbol}</span>
					<span className="font-mono text-lg tabular-nums text-foreground">
						{formatMoney(market?.price ?? quote?.price)}
					</span>
					<TickerStat
						label="Equity"
						value={formatMoney(toNumber(account?.equity))}
					/>
					<TickerStat
						label="Buying power"
						value={formatMoney(toNumber(account?.buying_power))}
					/>
					<div className="ml-auto flex items-center gap-2">
						<Badge
							variant={account?.mode === "paper" ? "success" : "warning"}
							className="uppercase"
						>
							{account?.mode ?? "—"}
						</Badge>
						<button
							type="button"
							onClick={() => arm.mutate(!control?.armed)}
							disabled={arm.isPending || control?.kill}
							className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold uppercase transition ${
								control?.armed
									? "bg-long text-background"
									: "border border-border text-muted-foreground hover:text-foreground"
							} disabled:opacity-50`}
							title="Arm to allow real paper orders on an ALLOW verdict"
						>
							<ShieldAlert className="size-3.5" />
							{control?.armed ? "Armed" : "Safe"}
						</button>
						<button
							type="button"
							onClick={() => kill.mutate(!control?.kill)}
							disabled={kill.isPending}
							className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold uppercase transition ${
								control?.kill
									? "bg-short text-white"
									: "border border-short/60 text-short hover:bg-short/10"
							} disabled:opacity-50`}
							title="Kill switch: block every order at the gate"
						>
							<Power className="size-3.5" />
							{control?.kill ? "Kill on" : "Kill"}
						</button>
					</div>
				</div>
			</div>

			<header className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-6 pt-8 pb-5">
				<div>
					<Badge variant="success">{env.VITE_APP_TITLE}</Badge>
					<div className="mt-2 flex flex-wrap items-center gap-3">
						<h1 className="font-serif text-4xl text-foreground">{symbol}</h1>
						<select
							value={symbol}
							onChange={(event) => setSymbol(event.target.value)}
							className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
							aria-label="Symbol"
						>
							{SYMBOLS.map((item) => (
								<option key={item} value={item}>
									{item}
								</option>
							))}
						</select>
					</div>
					<p className="mt-2 max-w-xl text-sm text-muted-foreground">
						Python PoC dashboard
					</p>
				</div>
				<div className="flex gap-3">
					<Button
						type="button"
						variant="outline"
						onClick={() => refresh.mutate()}
					>
						<RefreshCw className={refresh.isPending ? "animate-spin" : ""} />
						Refresh
					</Button>
					<Button
						type="button"
						variant="secondary"
						onClick={() => dryRun.mutate()}
						disabled={!decision}
					>
						<PlayCircle />
						Dry-run
					</Button>
					<Button
						type="button"
						onClick={() => execute.mutate()}
						disabled={execute.isPending}
					>
						<Rocket className={execute.isPending ? "animate-pulse" : ""} />
						{execute.isPending ? "Executing…" : "Execute"}
					</Button>
				</div>
			</header>

			<main className="mx-auto grid max-w-6xl gap-5 px-6 pb-12 lg:grid-cols-3">
				{error ? (
					<Card className="border-destructive/40 bg-destructive/10 lg:col-span-3">
						<CardContent className="pt-5 text-sm text-destructive">
							{error instanceof Error ? error.message : "API request failed"}
						</CardContent>
					</Card>
				) : null}

				<AgentGraph
					key={symbol}
					symbol={symbol}
					orderResult={orderResult}
					allowlist={catalog?.allowlist ?? []}
					settings={mergedSettings}
					onSettings={setSettings}
				/>

				<Card className="lg:col-span-3">
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<KeyRound className="size-5 text-gold" />
							API keys
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						<p className="text-xs text-muted-foreground">
							Saved keys override .env. Leave blank to keep the current source.
							Values are never shown after save.
						</p>
						<div className="grid gap-3 sm:grid-cols-2">
							<KeyField
								label="Groq"
								source={storedQuery.data?.keys.groq}
								value={keyDraft.groq}
								onChange={(v) => setKeyDraft((s) => ({ ...s, groq: v }))}
							/>
							<KeyField
								label="Tavily"
								source={storedQuery.data?.keys.tavily}
								value={keyDraft.tavily}
								onChange={(v) => setKeyDraft((s) => ({ ...s, tavily: v }))}
							/>
							<KeyField
								label="Alpaca key"
								source={storedQuery.data?.keys.alpaca_api_key}
								value={keyDraft.alpaca_api_key}
								onChange={(v) =>
									setKeyDraft((s) => ({ ...s, alpaca_api_key: v }))
								}
							/>
							<KeyField
								label="Alpaca secret"
								source={storedQuery.data?.keys.alpaca_secret_key}
								value={keyDraft.alpaca_secret_key}
								onChange={(v) =>
									setKeyDraft((s) => ({ ...s, alpaca_secret_key: v }))
								}
							/>
						</div>
						<Button
							type="button"
							variant="secondary"
							onClick={() => saveKeys.mutate()}
							disabled={saveKeys.isPending}
						>
							{saveKeys.isPending ? "Saving…" : "Save keys"}
						</Button>
						{storedQuery.error ? (
							<p className="text-xs text-short">
								Settings API unavailable (is Postgres up?)
							</p>
						) : null}
					</CardContent>
				</Card>

				<Card className="lg:col-span-2">
					<CardHeader>
						<CardTitle>Price</CardTitle>
					</CardHeader>
					<CardContent>
						<PriceChart symbol={symbol} bars={barsQuery.data} />
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Market State</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-3xl font-medium text-long">
							{market?.trend ?? "—"}
						</p>
						<dl className="mt-6 space-y-2 text-sm text-muted-foreground">
							<Row label="RSI" value={formatNumber(market?.rsi, 1)} />
							<Row label="SMA 20" value={formatNumber(market?.sma20, 2)} />
							<Row label="SMA 50" value={formatNumber(market?.sma50, 2)} />
							<Row label="EMA 20" value={formatNumber(market?.ema20, 2)} />
							<Row label="MACD" value={formatNumber(market?.macd, 2)} />
							<Row label="Signal" value={market?.technical_signal ?? "—"} />
						</dl>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Sentiment</CardTitle>
					</CardHeader>
					<CardContent>
						<p className={statusClass(market?.sentiment)}>
							{market?.sentiment ?? "—"}
						</p>
						<dl className="mt-4 space-y-2 text-sm text-muted-foreground">
							<Row
								label="Confidence"
								value={`${formatNumber(market?.confidence, 0)}%`}
							/>
							<Row label="Bias" value={market?.trade_bias ?? "—"} />
							<Row label="Strategy" value={market?.option_strategy ?? "—"} />
						</dl>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<ShieldCheck className="size-5 text-gold" />
							Risk
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className={riskClass(risk?.risk_level)}>
							{risk?.risk_level ?? "—"}
						</p>
						<dl className="mt-4 space-y-2 text-sm text-muted-foreground">
							<Row label="Position" value={formatMoney(risk?.position_size)} />
							<Row label="Max loss" value={formatMoney(risk?.max_loss)} />
							<Row label="Take profit" value={formatMoney(risk?.take_profit)} />
						</dl>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<WalletCards className="size-5 text-muted-foreground" />
							Account
						</CardTitle>
					</CardHeader>
					<CardContent>
						<dl className="space-y-2 text-sm text-muted-foreground">
							<Row label="Cash" value={formatMoney(toNumber(account?.cash))} />
							<Row label="Status" value={account?.status ?? "—"} />
						</dl>
					</CardContent>
				</Card>

				<Card className="lg:col-span-3">
					<CardContent className="pt-5">
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div>
								<CardTitle>Decision</CardTitle>
								<p className={actionClass(decision?.action)}>
									{decision?.action ?? "—"}
								</p>
							</div>
							<div className="text-right text-sm text-muted-foreground">
								<div>{decision?.symbol ?? symbol}</div>
								<div className="text-foreground">
									{formatMoney(decision?.position_size)}
								</div>
								{decision?.model ? (
									<div className="mt-1 font-mono text-[11px]">
										{decision.model.split("/").pop()}
									</div>
								) : null}
							</div>
						</div>
						{decision?.rationale ? (
							<p className="mt-3 text-sm text-muted-foreground">
								{decision.rationale}
							</p>
						) : null}
						{decision?.confidence != null ? (
							<p className="mt-1 text-xs text-muted-foreground">
								Confidence {formatNumber(decision.confidence, 0)}%
							</p>
						) : null}
						<div className="mt-5 flex flex-wrap items-center gap-2">
							<span className="text-xs uppercase tracking-wide text-muted-foreground">
								Execution gate
							</span>
							<span className={gateVerdictClass(gate?.verdict)}>
								{gate?.verdict ?? "—"}
							</span>
							{gate?.notional ? (
								<span className="text-xs text-muted-foreground">
									· {formatMoney(gate.notional)} notional
								</span>
							) : null}
						</div>
						{gate && gate.checks.length > 0 ? (
							<div className="mt-3 grid gap-2 sm:grid-cols-2">
								{gate.checks.map((c) => (
									<div
										key={c.name}
										className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs"
									>
										<span className="flex items-center gap-1.5">
											<span className={c.ok ? "text-long" : "text-short"}>
												{c.ok ? "✓" : "✕"}
											</span>
											<span className="text-foreground">{c.name}</span>
										</span>
										<span className="truncate text-right text-muted-foreground">
											{c.detail}
										</span>
									</div>
								))}
							</div>
						) : (
							<p className="mt-3 text-sm text-muted-foreground">
								{gate?.reasons?.[0] ?? "Run the pipeline to evaluate the gate."}
							</p>
						)}
					</CardContent>
				</Card>

				<Card className="lg:col-span-3">
					<CardHeader className="flex flex-row items-center justify-between">
						<CardTitle className="flex items-center gap-2">
							<Rocket className="size-5 text-muted-foreground" />
							Order Execution
						</CardTitle>
						<span className={orderStatusClass(orderResult?.status)}>
							{orderResult?.status ?? "IDLE"}
						</span>
					</CardHeader>
					<CardContent>
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
										(p) =>
											p.symbol === (orderResult?.decision?.symbol ?? symbol),
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
					</CardContent>
				</Card>

				<Card className="lg:col-span-3">
					<CardHeader>
						<CardTitle>Positions</CardTitle>
					</CardHeader>
					<CardContent>
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
										<TableCell
											colSpan={6}
											className="py-4 text-muted-foreground"
										>
											No open positions.
										</TableCell>
									</TableRow>
								)}
							</TableBody>
						</Table>
					</CardContent>
				</Card>

				<Card className="lg:col-span-3">
					<CardHeader>
						<CardTitle>Decision Log</CardTitle>
					</CardHeader>
					<CardContent>
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
								{decisionLog.map((entry) => (
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
								{decisionLog.length === 0 && (
									<TableRow>
										<TableCell
											colSpan={7}
											className="py-4 text-muted-foreground"
										>
											No entries yet.
										</TableCell>
									</TableRow>
								)}
							</TableBody>
						</Table>
					</CardContent>
				</Card>

				<Card className="lg:col-span-3">
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<ScrollText className="size-5 text-muted-foreground" />
							Invocations
						</CardTitle>
					</CardHeader>
					<CardContent>
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
								{(logsQuery.data?.entries ?? []).map((entry) => (
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
								{(logsQuery.data?.entries.length ?? 0) === 0 && (
									<TableRow>
										<TableCell
											colSpan={6}
											className="py-4 text-muted-foreground"
										>
											Run the pipeline to record invocations.
										</TableCell>
									</TableRow>
								)}
							</TableBody>
						</Table>
					</CardContent>
				</Card>

				{isLoading ? (
					<div className="fixed right-5 bottom-5 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground shadow-sm">
						Loading
					</div>
				) : null}
			</main>
		</div>
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

function TickerStat({ label, value }: { label: string; value: string }) {
	return (
		<span className="flex items-baseline gap-1.5 text-sm">
			<span className="text-xs text-muted-foreground">{label}</span>
			<span className="font-mono tabular-nums text-foreground">{value}</span>
		</span>
	);
}

function Row({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex justify-between gap-4">
			<dt>{label}</dt>
			<dd className="text-right font-mono tabular-nums text-foreground">
				{value}
			</dd>
		</div>
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

function classifyStatus(status: string | undefined): string {
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

function orderStatusClass(status: string | undefined): string {
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

function gateVerdictClass(verdict: string | undefined): string {
	const base = "text-sm font-bold uppercase";
	if (verdict === "ALLOW") return `${base} text-long`;
	if (verdict === "BLOCK") return `${base} text-short`;
	return `${base} text-muted-foreground`;
}

function toNumber(value: string | number | undefined): number | undefined {
	if (typeof value === "number") return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

function formatMoney(value: number | undefined): string {
	if (value === undefined || !Number.isFinite(value)) return "—";
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: 2,
	}).format(value);
}

function formatNumber(value: number | undefined, digits: number): string {
	if (value === undefined || !Number.isFinite(value)) return "—";
	return value.toFixed(digits);
}

function actionClass(action: string | undefined): string {
	const base = "mt-3 text-3xl font-semibold";
	if (action === "BUY") return `${base} text-long`;
	if (action === "SELL") return `${base} text-short`;
	if (action === "HOLD") return `${base} text-gold`;
	return `${base} text-muted-foreground`;
}

function riskClass(riskLevel: string | undefined): string {
	const base = "text-3xl font-semibold";
	if (riskLevel === "LOW") return `${base} text-long`;
	if (riskLevel === "MEDIUM") return `${base} text-gold`;
	if (riskLevel === "HIGH") return `${base} text-short`;
	return `${base} text-muted-foreground`;
}

function statusClass(status: string | undefined): string {
	const base = "text-3xl font-semibold";
	if (status === "BULLISH") return `${base} text-long`;
	if (status === "BEARISH") return `${base} text-short`;
	if (status === "NEUTRAL") return `${base} text-gold`;
	return `${base} text-muted-foreground`;
}

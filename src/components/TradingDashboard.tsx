import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	PlayCircle,
	Power,
	RefreshCw,
	Rocket,
	ShieldAlert,
	SlidersHorizontal,
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
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { env } from "@/env";
import {
	actionClass,
	classifyStatus,
	formatMoney,
	formatNumber,
	gateVerdictClass,
	riskClass,
	statusClass,
	toNumber,
} from "@/lib/format";
import { AgentGraph, type AgentSettings } from "./AgentGraph";
import { Blotter, type DecisionLogEntry } from "./Blotter";
import { OptionsDrawer } from "./OptionsDrawer";
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
	const [optionsOpen, setOptionsOpen] = useState(false);
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
	const [decisionLog, setDecisionLog] = useState<DecisionLogEntry[]>([]);

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
				<div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-1 px-6 py-2">
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

			<header className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-4 px-6 pt-6 pb-4">
				<div className="flex flex-wrap items-center gap-3">
					<Badge variant="success">{env.VITE_APP_TITLE}</Badge>
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
				<div className="flex flex-wrap gap-3">
					<Button
						type="button"
						variant="outline"
						onClick={() => setOptionsOpen(true)}
					>
						<SlidersHorizontal />
						Options
					</Button>
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

			<main className="mx-auto grid max-w-7xl gap-5 px-6 pb-12 lg:grid-cols-4">
				{error ? (
					<Card className="border-destructive/40 bg-destructive/10 lg:col-span-4">
						<CardContent className="pt-5 text-sm text-destructive">
							{error instanceof Error ? error.message : "API request failed"}
						</CardContent>
					</Card>
				) : null}

				<div className="min-w-0 lg:col-span-1">
					<AgentGraph
						key={symbol}
						symbol={symbol}
						orderResult={orderResult}
						settings={mergedSettings}
					/>
				</div>

				<Card className="min-w-0 lg:col-span-2">
					<CardContent className="pt-5">
						<CardTitle className="mb-3">Price</CardTitle>
						<PriceChart symbol={symbol} bars={barsQuery.data} />
						<dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm text-muted-foreground sm:grid-cols-3">
							<Row label="Trend" value={market?.trend ?? "—"} />
							<Row label="RSI" value={formatNumber(market?.rsi, 1)} />
							<Row label="SMA 20" value={formatNumber(market?.sma20, 2)} />
							<Row label="SMA 50" value={formatNumber(market?.sma50, 2)} />
							<Row label="EMA 20" value={formatNumber(market?.ema20, 2)} />
							<Row label="Signal" value={market?.technical_signal ?? "—"} />
						</dl>
					</CardContent>
				</Card>

				<DecisionRail
					symbol={symbol}
					decision={decision}
					gate={gate}
					market={market}
					risk={risk}
					account={account}
				/>

				<Blotter
					symbol={symbol}
					positions={positions}
					orderResult={orderResult}
					control={control}
					invocations={logsQuery.data?.entries ?? []}
					decisionLog={decisionLog}
				/>

				{isLoading ? (
					<div className="fixed right-5 bottom-5 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground shadow-sm">
						Loading
					</div>
				) : null}
			</main>

			<OptionsDrawer
				open={optionsOpen}
				onClose={() => setOptionsOpen(false)}
				settings={mergedSettings}
				onSettings={setSettings}
				keyDraft={keyDraft}
				onKeyDraft={setKeyDraft}
				keySources={storedQuery.data?.keys}
				allowlist={catalog?.allowlist ?? []}
				onSaveKeys={() => saveKeys.mutate()}
				savingKeys={saveKeys.isPending}
				settingsError={Boolean(storedQuery.error)}
			/>
		</div>
	);
}

function DecisionRail({
	symbol,
	decision,
	gate,
	market,
	risk,
	account,
}: {
	symbol: string;
	decision: PocDecision | undefined;
	gate: PocGate | undefined;
	market: PocMarketState | undefined;
	risk: PocRisk | undefined;
	account: { cash?: string | number; status?: string } | undefined;
}) {
	return (
		<Card className="min-w-0 lg:col-span-1">
			<CardContent className="space-y-5 pt-5">
				<div>
					<CardTitle>Decision</CardTitle>
					<p className={`mt-2 ${actionClass(decision?.action)}`}>
						{decision?.action ?? "—"}
					</p>
					<div className="mt-1 text-sm text-muted-foreground">
						{decision?.symbol ?? symbol} ·{" "}
						{formatMoney(decision?.position_size)}
					</div>
					{decision?.model ? (
						<div className="mt-1 font-mono text-[11px] text-muted-foreground">
							{decision.model.split("/").pop()}
						</div>
					) : null}
					{decision?.rationale ? (
						<p className="mt-2 line-clamp-4 text-xs text-muted-foreground">
							{decision.rationale}
						</p>
					) : null}
					{decision?.confidence != null ? (
						<p className="mt-1 text-xs text-muted-foreground">
							Confidence {formatNumber(decision.confidence, 0)}%
						</p>
					) : null}
				</div>

				<div>
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-xs uppercase tracking-wide text-muted-foreground">
							Gate
						</span>
						<span className={gateVerdictClass(gate?.verdict)}>
							{gate?.verdict ?? "—"}
						</span>
					</div>
					{gate && gate.checks.length > 0 ? (
						<div className="mt-2 space-y-1">
							{gate.checks.map((c) => (
								<div
									key={c.name}
									className="flex items-center justify-between gap-2 text-[11px]"
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
						<p className="mt-2 text-xs text-muted-foreground">
							{gate?.reasons?.[0] ?? "Run the pipeline to evaluate the gate."}
						</p>
					)}
				</div>

				<dl className="space-y-3 border-t border-border/60 pt-4 text-sm text-muted-foreground">
					<div>
						<div className="mb-1 flex items-baseline justify-between">
							<dt className="text-[10px] uppercase tracking-wide">Sentiment</dt>
							<dd className={statusClass(market?.sentiment)}>
								{market?.sentiment ?? "—"}
							</dd>
						</div>
						<Row
							label="Confidence"
							value={`${formatNumber(market?.confidence, 0)}%`}
						/>
						<Row label="Bias" value={market?.trade_bias ?? "—"} />
					</div>
					<div>
						<div className="mb-1 flex items-baseline justify-between">
							<dt className="text-[10px] uppercase tracking-wide">Risk</dt>
							<dd className={riskClass(risk?.risk_level)}>
								{risk?.risk_level ?? "—"}
							</dd>
						</div>
						<Row label="Position" value={formatMoney(risk?.position_size)} />
						<Row label="Max loss" value={formatMoney(risk?.max_loss)} />
					</div>
					<div>
						<div className="mb-1 text-[10px] uppercase tracking-wide">
							Account
						</div>
						<Row label="Cash" value={formatMoney(toNumber(account?.cash))} />
						<Row label="Status" value={account?.status ?? "—"} />
					</div>
				</dl>
			</CardContent>
		</Card>
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

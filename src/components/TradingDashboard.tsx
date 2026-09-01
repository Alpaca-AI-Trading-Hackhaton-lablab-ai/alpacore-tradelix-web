import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlayCircle, RefreshCw, ShieldCheck, WalletCards } from "lucide-react";
import { useMemo, useState } from "react";

import {
	buildDryRunPreview,
	type DryRunPreview,
	fetchAccount,
	fetchDecision,
	fetchMarketState,
	fetchRisk,
	fetchSpyQuote,
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
import { PriceChart } from "./PriceChart";

export function TradingDashboard() {
	const symbol = env.VITE_DEFAULT_SYMBOL;
	const queryClient = useQueryClient();
	const [decisionLog, setDecisionLog] = useState<
		Array<{ id: string; at: string; preview: DryRunPreview }>
	>([]);

	const marketQuery = useQuery({
		queryKey: ["market", symbol],
		queryFn: fetchMarketState,
		refetchInterval: 30_000,
	});
	const riskQuery = useQuery({
		queryKey: ["risk"],
		queryFn: fetchRisk,
		refetchInterval: 30_000,
	});
	const decisionQuery = useQuery({
		queryKey: ["decision"],
		queryFn: fetchDecision,
		refetchInterval: 30_000,
	});
	const accountQuery = useQuery({
		queryKey: ["account"],
		queryFn: fetchAccount,
		refetchInterval: 30_000,
	});
	const quoteQuery = useQuery({
		queryKey: ["quote", symbol],
		queryFn: fetchSpyQuote,
		refetchInterval: 30_000,
	});

	const refresh = useMutation({
		mutationFn: async () => {
			await queryClient.invalidateQueries();
		},
	});

	const dryRun = useMutation({
		mutationFn: fetchDecision,
		onSuccess: (decision) => {
			const preview = buildDryRunPreview(decision);
			setDecisionLog((items) =>
				[
					{ id: crypto.randomUUID(), at: new Date().toISOString(), preview },
					...items,
				].slice(0, 10),
			);
			queryClient.setQueryData(["decision"], decision);
		},
	});

	const market = marketQuery.data;
	const risk = riskQuery.data;
	const decision = decisionQuery.data;
	const account = accountQuery.data;
	const quote = quoteQuery.data;
	const dryRunPreview = useMemo(
		() => (decision ? buildDryRunPreview(decision) : null),
		[decision],
	);
	const isLoading =
		marketQuery.isLoading ||
		riskQuery.isLoading ||
		decisionQuery.isLoading ||
		accountQuery.isLoading ||
		quoteQuery.isLoading;
	const error =
		marketQuery.error ||
		riskQuery.error ||
		decisionQuery.error ||
		accountQuery.error ||
		quoteQuery.error ||
		null;

	return (
		<div
			className="dark min-h-screen bg-background text-foreground"
			data-testid="tradelix-dashboard"
		>
			<header className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-6 pt-8 pb-5">
				<div>
					<Badge variant="success">{env.VITE_APP_TITLE}</Badge>
					<h1 className="mt-2 font-serif text-4xl text-white">{symbol}</h1>
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
					>
						<PlayCircle />
						Dry-run
					</Button>
				</div>
			</header>

			<main className="mx-auto grid max-w-6xl gap-5 px-6 pb-12 lg:grid-cols-3">
				{error ? (
					<Card className="border-destructive/40 bg-destructive/10 lg:col-span-3">
						<CardContent className="pt-5 text-sm text-rose-100">
							{error instanceof Error ? error.message : "API request failed"}
						</CardContent>
					</Card>
				) : null}

				<Card className="lg:col-span-2">
					<CardHeader className="flex flex-row items-center justify-between">
						<CardTitle>Price</CardTitle>
						<span className="text-sm text-muted-foreground">
							{formatMoney(market?.price ?? quote?.price)}
						</span>
					</CardHeader>
					<CardContent>
						<PriceChart
							symbol={symbol}
							lastPrice={market?.price ?? quote?.price ?? 100}
						/>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Market State</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-3xl font-medium text-emerald-200">
							{market?.trend ?? "—"}
						</p>
						<dl className="mt-6 space-y-2 text-sm text-muted-foreground">
							<Row label="RSI" value={formatNumber(market?.rsi, 1)} />
							<Row label="SMA 20" value={formatNumber(market?.sma20, 2)} />
							<Row label="SMA 50" value={formatNumber(market?.sma50, 2)} />
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
							<ShieldCheck className="size-5 text-amber-300" />
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
							<WalletCards className="size-5 text-sky-300" />
							Account
						</CardTitle>
					</CardHeader>
					<CardContent>
						<dl className="space-y-2 text-sm text-muted-foreground">
							<Row
								label="Equity"
								value={formatMoney(toNumber(account?.equity))}
							/>
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
							</div>
						</div>
						<div className="mt-5 grid gap-4 md:grid-cols-3">
							<Metric label="Sentiment" value={decision?.sentiment ?? "—"} />
							<Metric
								label="Technical"
								value={decision?.technical_signal ?? "—"}
							/>
							<Metric label="Dry-run" value={dryRunPreview?.status ?? "—"} />
						</div>
						<pre className="mt-5 overflow-x-auto rounded-lg bg-black/30 p-4 text-xs text-muted-foreground">
							{dryRunPreview
								? JSON.stringify(dryRunPreview, null, 2)
								: "No decision yet"}
						</pre>
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
									<TableHead>Symbol</TableHead>
									<TableHead>Action</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Position</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{decisionLog.map((entry) => (
									<TableRow key={entry.id}>
										<TableCell>{new Date(entry.at).toLocaleString()}</TableCell>
										<TableCell>{entry.preview.decision.symbol}</TableCell>
										<TableCell>{entry.preview.decision.action}</TableCell>
										<TableCell>{entry.preview.status}</TableCell>
										<TableCell>
											{formatMoney(entry.preview.decision.position_size)}
										</TableCell>
									</TableRow>
								))}
								{decisionLog.length === 0 && (
									<TableRow>
										<TableCell
											colSpan={5}
											className="py-4 text-muted-foreground"
										>
											No dry-run entries yet.
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

function Row({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex justify-between gap-4">
			<dt>{label}</dt>
			<dd className="text-right text-foreground">{value}</dd>
		</div>
	);
}

function Metric({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<div className="text-xs text-muted-foreground">{label}</div>
			<div className="mt-1 text-base text-foreground">{value}</div>
		</div>
	);
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
	if (action === "BUY") return `${base} text-emerald-300`;
	if (action === "SELL") return `${base} text-rose-300`;
	if (action === "HOLD") return `${base} text-amber-300`;
	return `${base} text-muted-foreground`;
}

function riskClass(riskLevel: string | undefined): string {
	const base = "text-3xl font-semibold";
	if (riskLevel === "LOW") return `${base} text-emerald-300`;
	if (riskLevel === "MEDIUM") return `${base} text-amber-300`;
	if (riskLevel === "HIGH") return `${base} text-rose-300`;
	return `${base} text-muted-foreground`;
}

function statusClass(status: string | undefined): string {
	const base = "text-3xl font-semibold";
	if (status === "BULLISH") return `${base} text-emerald-300`;
	if (status === "BEARISH") return `${base} text-rose-300`;
	if (status === "NEUTRAL") return `${base} text-amber-300`;
	return `${base} text-muted-foreground`;
}

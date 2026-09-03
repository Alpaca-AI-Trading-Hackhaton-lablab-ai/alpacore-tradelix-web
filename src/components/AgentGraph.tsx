import { useQueryClient } from "@tanstack/react-query";
import {
	Activity,
	Brain,
	CandlestickChart,
	Gauge,
	Gavel,
	GitBranch,
	Landmark,
	Layers,
	Newspaper,
	Play,
	Rocket,
	ShieldAlert,
	ShieldCheck,
	Square,
	Wallet,
	X,
} from "lucide-react";
import {
	type ComponentType,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	type PipelineOpts,
	type PocNodeStatus,
	type PocOrderResult,
	type PocPipelineNode,
	type PocReactTurn,
	streamPipeline,
} from "@/api/market-client";
import { Card, CardContent } from "@/components/ui/card";

type NodeDef = {
	id: string;
	label: string;
	title: string;
	icon: ComponentType<{ className?: string }>;
};

/** Topological order: PIPELINE_KEYS + execution. */
const NODES: NodeDef[] = [
	{ id: "news", label: "News", title: "News", icon: Newspaper },
	{ id: "sentiment", label: "Sentiment", title: "Sentiment", icon: Brain },
	{ id: "options", label: "Options", title: "Options", icon: GitBranch },
	{ id: "features", label: "Features", title: "Features", icon: Activity },
	{
		id: "technical",
		label: "Technical",
		title: "Technical",
		icon: CandlestickChart,
	},
	{ id: "orderblock", label: "OB", title: "Order Block", icon: Layers },
	{
		id: "institutional",
		label: "Flow",
		title: "Institutional",
		icon: Landmark,
	},
	{ id: "market_state", label: "State", title: "Market State", icon: Gauge },
	{ id: "account", label: "Account", title: "Account", icon: Wallet },
	{ id: "risk", label: "Risk", title: "Risk", icon: ShieldCheck },
	{ id: "decision", label: "Decision", title: "Decision", icon: Gavel },
	{ id: "gate", label: "Gate", title: "Gate", icon: ShieldAlert },
	{ id: "execution", label: "Exec", title: "Execution", icon: Rocket },
];

type NodeKind = "llm" | "indicators" | "locked";

const NODE_META: Record<
	string,
	{ kind: NodeKind; role: "LLM" | "deterministic"; blurb: string }
> = {
	news: {
		kind: "locked",
		role: "deterministic",
		blurb: "Tavily headlines. No LLM.",
	},
	sentiment: {
		kind: "llm",
		role: "LLM",
		blurb: "News → sentiment. Model + optional ReAct (news + concept lookup).",
	},
	options: {
		kind: "locked",
		role: "deterministic",
		blurb: "Rule labels from sentiment. No LLM.",
	},
	features: {
		kind: "indicators",
		role: "deterministic",
		blurb: "Same pandas engine as technical. Hourly bars. No LLM.",
	},
	technical: {
		kind: "indicators",
		role: "deterministic",
		blurb:
			"EMA 3/10/50/100 and RSI3 on 1Hour bars. SMA/MACD/ATR stay. No LLM math.",
	},
	orderblock: {
		kind: "locked",
		role: "deterministic",
		blurb:
			"Daily order block: last opposing candle before a 1.5× range impulse.",
	},
	institutional: {
		kind: "locked",
		role: "deterministic",
		blurb: "Hourly volume vs SMA20 + accumulation/distribution. No tick tape.",
	},
	market_state: {
		kind: "locked",
		role: "deterministic",
		blurb:
			"Merges sentiment, options, features, technical, order blocks, and flow.",
	},
	account: {
		kind: "locked",
		role: "deterministic",
		blurb: "Alpaca paper account read.",
	},
	risk: {
		kind: "locked",
		role: "deterministic",
		blurb: "Position sizing. Never an LLM.",
	},
	decision: {
		kind: "llm",
		role: "LLM",
		blurb:
			"Scored setup (EMA/RSI3/OB/flow). Deep mode may look up unknown concepts.",
	},
	gate: {
		kind: "locked",
		role: "deterministic",
		blurb: "Sole authority to trade. Cannot be a ReAct agent.",
	},
	execution: {
		kind: "locked",
		role: "deterministic",
		blurb: "Broker submit after ALLOW + arm. Not part of the SSE graph.",
	},
};

type NodeState = { status: PocNodeStatus; message?: string | null };

const STATUS_DOT: Record<PocNodeStatus, string> = {
	idle: "bg-node-idle",
	running: "bg-node-running",
	done: "bg-node-done",
	error: "bg-node-error",
};

function orderToStatus(order?: PocOrderResult | null): NodeState {
	if (!order) return { status: "idle" };
	const s = order.status;
	if (s === "FILLED") {
		return { status: "done", message: `FILLED · ${order.filled_qty ?? 0}` };
	}
	if (s === "REJECTED" || s === "FAILED") {
		return { status: "error", message: order.reason ?? order.error ?? s };
	}
	if (s === "NO_TRADE") return { status: "idle", message: "No trade (HOLD)" };
	if (s === "BLOCKED") {
		return { status: "error", message: order.reason ?? "Blocked by gate" };
	}
	if (s === "DRY_RUN")
		return { status: "done", message: "Dry-run (not armed)" };
	if (["SUBMITTED", "ACCEPTED", "PARTIALLY_FILLED"].includes(s)) {
		return { status: "running", message: s };
	}
	return { status: "done", message: s };
}

const initialStates = (): Record<string, NodeState> =>
	Object.fromEntries(NODES.map((n) => [n.id, { status: "idle" }]));

const CACHE_KEY: Record<string, (symbol: string) => unknown[]> = {
	market_state: (s) => ["market", s],
	risk: (s) => ["risk", s],
	decision: (s) => ["decision", s],
	gate: (s) => ["gate", s],
	account: () => ["account"],
};

export type AgentSettings = {
	sentimentModel: string;
	decisionModel: string;
	deepSentiment: boolean;
	deepDecision: boolean;
	indicators: string[];
	decisionIndicators: string[];
};

export function AgentGraph({
	symbol,
	orderResult,
	settings,
}: {
	symbol: string;
	orderResult?: PocOrderResult | null;
	settings: AgentSettings;
}) {
	const queryClient = useQueryClient();
	const [states, setStates] =
		useState<Record<string, NodeState>>(initialStates);
	const [running, setRunning] = useState(false);
	const [selected, setSelected] = useState<string | null>(null);
	const [reactLog, setReactLog] = useState<
		Array<PocReactTurn & { id: string }>
	>([]);
	const esRef = useRef<EventSource | null>(null);

	const execState = orderToStatus(orderResult);

	const pipelineOpts = useCallback((): PipelineOpts => {
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
	}, [settings]);

	const startStream = useCallback(
		(opts: PipelineOpts) => {
			esRef.current?.close();
			setStates(initialStates());
			setReactLog([]);
			setRunning(true);
			esRef.current = streamPipeline(
				symbol,
				{
					onNode: (ev: PocPipelineNode) => {
						setStates((prev) => ({
							...prev,
							[ev.node]: {
								status: ev.status,
								message: ev.message ?? null,
							},
						}));
						const keyFn = CACHE_KEY[ev.node];
						if (ev.status === "done" && keyFn && ev.output) {
							queryClient.setQueryData(keyFn(symbol), ev.output);
						}
					},
					onReact: (turn) => {
						setReactLog((prev) =>
							[...prev, { ...turn, id: crypto.randomUUID() }].slice(-16),
						);
					},
					onDone: () => setRunning(false),
					onError: () => setRunning(false),
				},
				opts,
			);
		},
		[symbol, queryClient],
	);

	function stop() {
		esRef.current?.close();
		esRef.current = null;
		setRunning(false);
	}

	function runManual() {
		startStream(pipelineOpts());
	}

	useEffect(() => {
		return () => esRef.current?.close();
	}, []);

	const stateOf = (id: string): NodeState =>
		id === "execution" ? execState : (states[id] ?? { status: "idle" });

	const deepOn = settings.deepSentiment || settings.deepDecision;
	const selectedDef = NODES.find((n) => n.id === selected);
	const meta = selected ? NODE_META[selected] : null;
	const stSelected = selected ? stateOf(selected) : null;
	const nodeReact = selected
		? reactLog.filter((turn) => turn.node === selected)
		: [];

	return (
		<Card>
			<CardContent className="pt-5">
				<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
					<div>
						<h2 className="font-serif text-xl text-foreground">
							Agent Pipeline
						</h2>
						<p className="text-xs text-muted-foreground">
							{NODES.length} agents · idle until Run · {symbol}
							{deepOn ? " · deep" : ""}
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Legend />
						<button
							type="button"
							onClick={running ? stop : runManual}
							className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90"
						>
							{running ? (
								<Square className="size-4" />
							) : (
								<Play className="size-4" />
							)}
							{running ? "Stop" : "Run pipeline"}
						</button>
					</div>
				</div>

				<ol className="relative m-0 list-none space-y-0 p-0">
					{NODES.map((node, index) => {
						const st = stateOf(node.id);
						const Icon = node.icon;
						const isSel = selected === node.id;
						const next = NODES[index + 1];
						const nextSt = next ? stateOf(next.id).status : "idle";
						const railOn =
							st.status === "done" &&
							(nextSt === "done" || nextSt === "running");
						const railActive = nextSt === "running";
						return (
							<li key={node.id} className="relative flex gap-3">
								<div className="flex w-4 shrink-0 flex-col items-center">
									<span
										className={`mt-2 size-2.5 shrink-0 rounded-full ${STATUS_DOT[st.status]}`}
									/>
									{next ? (
										<span
											className={`min-h-6 w-px flex-1 ${
												railActive
													? "bg-gold"
													: railOn
														? "bg-long"
														: "bg-border"
											}`}
										/>
									) : null}
								</div>
								<button
									type="button"
									onClick={() =>
										setSelected((cur) => (cur === node.id ? null : node.id))
									}
									className={`mb-1.5 min-w-0 flex-1 rounded-md border bg-background/60 px-2 py-1.5 text-left transition hover:border-gold/60 ${
										st.status === "running"
											? "node-running border-node-running"
											: ""
									} ${isSel ? "ring-2 ring-gold/70" : ""}`}
								>
									<div className="flex items-center gap-1.5">
										<Icon className="size-3.5 shrink-0 text-muted-foreground" />
										<span className="truncate text-[11px] font-semibold uppercase tracking-wide text-foreground">
											{node.label}
										</span>
									</div>
									<p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
										{st.message ?? (st.status === "idle" ? "—" : st.status)}
									</p>
								</button>
							</li>
						);
					})}
				</ol>

				{selected && meta && selectedDef ? (
					<aside className="mt-3 rounded-md border border-border/70 bg-muted/20 p-3">
						<div className="mb-2 flex items-start justify-between gap-2">
							<div>
								<h3 className="text-sm font-semibold uppercase tracking-wide">
									{selectedDef.title}
								</h3>
								<p
									className={`text-[10px] font-semibold uppercase ${
										meta.role === "LLM" ? "text-gold" : "text-muted-foreground"
									}`}
								>
									{meta.role}
								</p>
							</div>
							<button
								type="button"
								onClick={() => setSelected(null)}
								className="text-muted-foreground hover:text-foreground"
								aria-label="Close inspector"
							>
								<X className="size-4" />
							</button>
						</div>
						<p className="mb-3 text-xs text-muted-foreground">{meta.blurb}</p>
						{stSelected ? (
							<p className="mb-2 font-mono text-xs text-foreground">
								{stSelected.message ?? stSelected.status}
							</p>
						) : null}
						{meta.kind === "locked" ? (
							<p className="text-xs text-muted-foreground">
								Not configurable. Architecture stays deterministic here.
							</p>
						) : (
							<p className="text-xs text-muted-foreground">
								Configure models, Deep, and indicators in Options.
							</p>
						)}
						{nodeReact.length > 0 ? (
							<div className="mt-3 max-h-32 overflow-y-auto rounded-md border border-border/60 bg-muted/20 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
								{nodeReact.map((turn) => (
									<div key={turn.id} className="mb-1.5">
										<span className="text-foreground">
											#{(turn.turn ?? 0) + 1}
										</span>
										{turn.tool ? (
											<span className="text-gold"> · {turn.tool}</span>
										) : null}
										{turn.thought ? (
											<div className="line-clamp-2 pl-2">{turn.thought}</div>
										) : null}
										{turn.observation ? (
											<div className="line-clamp-2 pl-2 text-muted-foreground/80">
												obs: {turn.observation}
											</div>
										) : null}
									</div>
								))}
							</div>
						) : null}
					</aside>
				) : (
					<p className="mt-3 text-xs text-muted-foreground">
						Click an agent to inspect output or ReAct.
					</p>
				)}

				{reactLog.length > 0 ? (
					<div className="mt-3 max-h-40 overflow-y-auto rounded-md border border-border/60 bg-muted/20 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
						{reactLog.map((turn) => (
							<div key={turn.id} className="mb-1.5">
								<span className="text-foreground">
									{turn.node}#{(turn.turn ?? 0) + 1}
								</span>
								{turn.tool ? (
									<span className="text-gold"> · {turn.tool}</span>
								) : null}
								{turn.thought ? (
									<div className="line-clamp-2 pl-3 text-muted-foreground">
										{turn.thought}
									</div>
								) : null}
								{turn.observation ? (
									<div className="line-clamp-2 pl-3 text-muted-foreground/80">
										obs: {turn.observation}
									</div>
								) : null}
							</div>
						))}
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}

function Legend() {
	const items: [PocNodeStatus, string][] = [
		["running", "running"],
		["done", "done"],
		["error", "error"],
	];
	return (
		<div className="hidden items-center gap-3 text-[10px] text-muted-foreground lg:flex">
			{items.map(([status, label]) => (
				<span key={status} className="inline-flex items-center gap-1">
					<span className={`size-2 rounded-full ${STATUS_DOT[status]}`} />
					{label}
				</span>
			))}
		</div>
	);
}

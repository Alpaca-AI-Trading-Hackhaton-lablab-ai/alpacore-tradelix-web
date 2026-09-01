import { useQueryClient } from "@tanstack/react-query";
import {
	Activity,
	Brain,
	CandlestickChart,
	Gauge,
	Gavel,
	GitBranch,
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
	INDICATOR_OPTIONS,
	type PipelineOpts,
	type PocGroqModel,
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
	icon: ComponentType<{ className?: string }>;
	col: number;
	row: number;
};

const NODES: NodeDef[] = [
	{ id: "news", label: "News", icon: Newspaper, col: 0, row: 0 },
	{ id: "features", label: "Features", icon: Activity, col: 0, row: 1 },
	{
		id: "technical",
		label: "Technical",
		icon: CandlestickChart,
		col: 0,
		row: 2,
	},
	{ id: "account", label: "Account", icon: Wallet, col: 0, row: 3 },
	{ id: "sentiment", label: "Sentiment", icon: Brain, col: 1, row: 0 },
	{ id: "options", label: "Options", icon: GitBranch, col: 2, row: 0 },
	{ id: "risk", label: "Risk", icon: ShieldCheck, col: 2, row: 3 },
	{ id: "market_state", label: "Market State", icon: Gauge, col: 3, row: 1 },
	{ id: "decision", label: "Decision", icon: Gavel, col: 4, row: 2 },
	{ id: "gate", label: "Gate", icon: ShieldAlert, col: 5, row: 2 },
	{ id: "execution", label: "Execution", icon: Rocket, col: 6, row: 2 },
];

const EDGES: [string, string][] = [
	["news", "sentiment"],
	["sentiment", "options"],
	["sentiment", "risk"],
	["account", "risk"],
	["sentiment", "market_state"],
	["options", "market_state"],
	["features", "market_state"],
	["technical", "market_state"],
	["market_state", "decision"],
	["risk", "decision"],
	["decision", "gate"],
	["gate", "execution"],
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
		blurb: "News → sentiment. Model + optional ReAct research loop.",
	},
	options: {
		kind: "locked",
		role: "deterministic",
		blurb: "Rule labels from sentiment. No LLM.",
	},
	features: {
		kind: "indicators",
		role: "deterministic",
		blurb: "Same pandas engine as technical. No LLM.",
	},
	technical: {
		kind: "indicators",
		role: "deterministic",
		blurb: "RSI/SMA/MACD computed in Python. The LLM does not calculate them.",
	},
	market_state: {
		kind: "locked",
		role: "deterministic",
		blurb: "Merges sentiment, options, features, and technical.",
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
		blurb: "Interprets the indicator snapshot. Does not size the order.",
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

const W = 158;
const H = 66;
const HGAP = 46;
const VGAP = 30;
const PAD = 14;
const CANVAS_W = PAD * 2 + 7 * W + 6 * HGAP;
const CANVAS_H = PAD * 2 + 4 * H + 3 * VGAP;

function pos(node: NodeDef) {
	const left = PAD + node.col * (W + HGAP);
	const top = PAD + node.row * (H + VGAP);
	return { left, top, right: left + W, midY: top + H / 2 };
}

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

function toggleId(list: string[], id: string): string[] {
	return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function AgentGraph({
	symbol,
	orderResult,
	allowlist,
	settings,
	onSettings,
}: {
	symbol: string;
	orderResult?: PocOrderResult | null;
	allowlist: PocGroqModel[];
	settings: AgentSettings;
	onSettings: (next: AgentSettings) => void;
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
	const meta = selected ? NODE_META[selected] : null;

	return (
		<Card className="lg:col-span-3">
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
							onClick={() =>
								onSettings({
									...settings,
									deepSentiment: !deepOn,
									deepDecision: !deepOn,
								})
							}
							className={`inline-flex h-9 items-center rounded-md px-3 text-xs font-semibold uppercase transition ${
								deepOn
									? "bg-gold text-background"
									: "border border-border text-muted-foreground hover:text-foreground"
							}`}
							title="Opt-in ReAct on sentiment and decision"
						>
							Deep research
						</button>
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

				<div className="flex flex-col gap-4 xl:flex-row">
					<div className="min-w-0 flex-1 overflow-x-auto">
						<div
							className="relative"
							style={{ width: CANVAS_W, height: CANVAS_H }}
						>
							<svg
								className="pointer-events-none absolute inset-0"
								width={CANVAS_W}
								height={CANVAS_H}
								aria-hidden="true"
							>
								<title>Agent graph edges</title>
								{EDGES.map(([from, to]) => {
									const a = NODES.find((n) => n.id === from);
									const b = NODES.find((n) => n.id === to);
									if (!a || !b) return null;
									const pa = pos(a);
									const pb = pos(b);
									const sx = pa.right;
									const sy = pa.midY;
									const tx = pb.left;
									const ty = pb.midY;
									const dx = Math.max(40, (tx - sx) * 0.5);
									const d = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
									const sFrom = stateOf(from).status;
									const sTo = stateOf(to).status;
									const active = sTo === "running";
									const done = sFrom === "done" && sTo === "done";
									const stroke = active
										? "var(--gold)"
										: done
											? "var(--long)"
											: "var(--border)";
									return (
										<path
											key={`${from}-${to}`}
											d={d}
											fill="none"
											stroke={stroke}
											strokeWidth={active ? 2 : 1.5}
											strokeOpacity={active || done ? 0.9 : 0.5}
											className={active ? "edge-flow" : ""}
										/>
									);
								})}
							</svg>

							{NODES.map((node) => {
								const st = stateOf(node.id);
								const Icon = node.icon;
								const p = pos(node);
								const isSel = selected === node.id;
								return (
									<button
										key={node.id}
										type="button"
										onClick={() =>
											setSelected((cur) => (cur === node.id ? null : node.id))
										}
										className={`absolute rounded-md border bg-background/60 p-2 text-left transition hover:border-gold/60 ${
											st.status === "running"
												? "node-running border-node-running"
												: ""
										} ${isSel ? "ring-2 ring-gold/70" : ""}`}
										style={{
											left: p.left,
											top: p.top,
											width: W,
											height: H,
										}}
									>
										<div className="flex items-center gap-1.5">
											<Icon className="size-3.5 text-muted-foreground" />
											<span className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
												{node.label}
											</span>
											<span
												className={`ml-auto size-2 rounded-full ${STATUS_DOT[st.status]}`}
											/>
										</div>
										<p className="mt-1 line-clamp-2 text-[10px] leading-tight text-muted-foreground">
											{st.message ?? (st.status === "idle" ? "—" : st.status)}
										</p>
									</button>
								);
							})}
						</div>
					</div>

					{selected && meta ? (
						<aside className="w-full shrink-0 rounded-md border border-border/70 bg-muted/20 p-4 xl:w-80">
							<div className="mb-3 flex items-start justify-between gap-2">
								<div>
									<h3 className="text-sm font-semibold uppercase tracking-wide">
										{NODES.find((n) => n.id === selected)?.label}
									</h3>
									<p
										className={`text-[10px] font-semibold uppercase ${
											meta.role === "LLM"
												? "text-gold"
												: "text-muted-foreground"
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
							<p className="mb-4 text-xs text-muted-foreground">{meta.blurb}</p>
							{meta.kind === "llm" && selected === "sentiment" ? (
								<LlmControls
									allowlist={allowlist}
									model={settings.sentimentModel}
									deep={settings.deepSentiment}
									onModel={(id) =>
										onSettings({ ...settings, sentimentModel: id })
									}
									onDeep={(v) => onSettings({ ...settings, deepSentiment: v })}
								/>
							) : null}
							{meta.kind === "llm" && selected === "decision" ? (
								<>
									<LlmControls
										allowlist={allowlist}
										model={settings.decisionModel}
										deep={settings.deepDecision}
										onModel={(id) =>
											onSettings({ ...settings, decisionModel: id })
										}
										onDeep={(v) => onSettings({ ...settings, deepDecision: v })}
									/>
									<IndicatorToggles
										label="Snapshot for the decision prompt"
										selected={settings.decisionIndicators}
										onToggle={(id) =>
											onSettings({
												...settings,
												decisionIndicators: toggleId(
													settings.decisionIndicators,
													id,
												),
											})
										}
									/>
								</>
							) : null}
							{meta.kind === "indicators" ? (
								<IndicatorToggles
									label="Compute"
									selected={settings.indicators}
									onToggle={(id) =>
										onSettings({
											...settings,
											indicators: toggleId(settings.indicators, id),
										})
									}
								/>
							) : null}
							{meta.kind === "locked" ? (
								<p className="text-xs text-muted-foreground">
									Not configurable. Architecture stays deterministic here.
								</p>
							) : null}
						</aside>
					) : (
						<p className="text-xs text-muted-foreground xl:w-56">
							Click an agent to inspect model, ReAct, or indicators.
						</p>
					)}
				</div>

				{reactLog.length > 0 ? (
					<div className="mt-4 max-h-40 overflow-y-auto rounded-md border border-border/60 bg-muted/20 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
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

function LlmControls({
	allowlist,
	model,
	deep,
	onModel,
	onDeep,
}: {
	allowlist: PocGroqModel[];
	model: string;
	deep: boolean;
	onModel: (id: string) => void;
	onDeep: (v: boolean) => void;
}) {
	return (
		<div className="space-y-3">
			<label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
				Model
				<select
					value={model}
					onChange={(event) => onModel(event.target.value)}
					className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-xs normal-case text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
				>
					{allowlist.length === 0 ? <option value="">Loading…</option> : null}
					{allowlist.map((item) => (
						<option key={item.id} value={item.id}>
							{item.label}
						</option>
					))}
				</select>
			</label>
			<label className="flex items-center gap-2 text-xs text-foreground">
				<input
					type="checkbox"
					checked={deep}
					onChange={(event) => onDeep(event.target.checked)}
				/>
				ReAct loop (deep)
			</label>
		</div>
	);
}

function IndicatorToggles({
	label,
	selected,
	onToggle,
}: {
	label: string;
	selected: string[];
	onToggle: (id: string) => void;
}) {
	return (
		<div className="mt-3">
			<p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
				{label}
			</p>
			<div className="grid grid-cols-2 gap-1.5">
				{INDICATOR_OPTIONS.map((item) => (
					<label
						key={item.id}
						className="flex items-center gap-1.5 text-xs text-foreground"
					>
						<input
							type="checkbox"
							checked={selected.includes(item.id)}
							onChange={() => onToggle(item.id)}
						/>
						{item.label}
					</label>
				))}
			</div>
		</div>
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

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
	ShieldCheck,
	Square,
	Wallet,
} from "lucide-react";
import {
	type ComponentType,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	type PocNodeStatus,
	type PocOrderResult,
	type PocPipelineNode,
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

// Fixed pipeline topology (backend.py: run_pipeline). Each node = one agent.
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
	{ id: "execution", label: "Execution", icon: Rocket, col: 5, row: 2 },
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
	["decision", "execution"],
];

// Canvas geometry.
const W = 158;
const H = 66;
const HGAP = 46;
const VGAP = 30;
const PAD = 14;
const CANVAS_W = PAD * 2 + 6 * W + 5 * HGAP;
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
	if (["SUBMITTED", "ACCEPTED", "PARTIALLY_FILLED"].includes(s)) {
		return { status: "running", message: s };
	}
	return { status: "done", message: s };
}

const initialStates = (): Record<string, NodeState> =>
	Object.fromEntries(NODES.map((n) => [n.id, { status: "idle" }]));

// TanStack Query keys each node feeds, used to seed the cache.
const CACHE_KEY: Record<string, (symbol: string) => unknown[]> = {
	market_state: (s) => ["market", s],
	risk: (s) => ["risk", s],
	decision: (s) => ["decision", s],
	account: () => ["account"],
};

export function AgentGraph({
	symbol,
	orderResult,
}: {
	symbol: string;
	orderResult?: PocOrderResult | null;
}) {
	const queryClient = useQueryClient();
	const [states, setStates] =
		useState<Record<string, NodeState>>(initialStates);
	const [running, setRunning] = useState(false);
	const esRef = useRef<EventSource | null>(null);

	// The execution node reflects the result of the `execute` mutation.
	const execState = orderToStatus(orderResult);

	const run = useCallback(() => {
		esRef.current?.close();
		setStates(initialStates());
		setRunning(true);
		esRef.current = streamPipeline(symbol, {
			onNode: (ev: PocPipelineNode) => {
				setStates((prev) => ({
					...prev,
					[ev.node]: { status: ev.status, message: ev.message ?? null },
				}));
				// Seed the cache so the cards update instantly from the same trace.
				const keyFn = CACHE_KEY[ev.node];
				if (ev.status === "done" && keyFn && ev.output) {
					queryClient.setQueryData(keyFn(symbol), ev.output);
				}
			},
			onDone: () => setRunning(false),
			onError: () => setRunning(false),
		});
	}, [symbol, queryClient]);

	function stop() {
		esRef.current?.close();
		esRef.current = null;
		setRunning(false);
	}

	// Auto-run: stream the pipeline on mount and whenever the symbol changes, so
	// the graph and the cards it seeds stay live without a manual click.
	useEffect(() => {
		run();
		return () => esRef.current?.close();
	}, [run]);

	const stateOf = (id: string): NodeState =>
		id === "execution" ? execState : (states[id] ?? { status: "idle" });

	return (
		<Card className="lg:col-span-3">
			<CardContent className="pt-5">
				<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
					<div>
						<h2 className="font-serif text-xl text-foreground">
							Agent Pipeline
						</h2>
						<p className="text-xs text-muted-foreground">
							{NODES.length} agents · live SSE · {symbol}
						</p>
					</div>
					<div className="flex items-center gap-3">
						<Legend />
						<button
							type="button"
							onClick={running ? stop : run}
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

				<div className="overflow-x-auto">
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
							return (
								<div
									key={node.id}
									className={`absolute rounded-md border bg-background/60 p-2 ${
										st.status === "running"
											? "node-running border-node-running"
											: ""
									}`}
									style={{ left: p.left, top: p.top, width: W, height: H }}
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
								</div>
							);
						})}
					</div>
				</div>
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
		<div className="hidden items-center gap-3 text-[10px] text-muted-foreground sm:flex">
			{items.map(([status, label]) => (
				<span key={status} className="inline-flex items-center gap-1">
					<span className={`size-2 rounded-full ${STATUS_DOT[status]}`} />
					{label}
				</span>
			))}
		</div>
	);
}

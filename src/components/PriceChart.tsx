import {
	CandlestickSeries,
	ColorType,
	createChart,
	HistogramSeries,
	type IChartApi,
	type IPriceLine,
	type ISeriesApi,
	LineSeries,
	LineStyle,
	type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import type { PocBars, PocBracketPlan, PocLinePoint } from "@/api/market-client";
import { breakEvenPrice, updateLegPrice } from "@/lib/order-plan";

const LONG = "#0ecb81";
const SHORT = "#f6465d";
const SMA20 = "#f0b90b";
const SMA50 = "#3dd6c6";
const EMA3 = "#fbbf24";
const EMA10 = "#fb7185";
const EMA20 = "#60a5fa";
const EMA50 = "#a78bfa";
const EMA100 = "#94a3b8";
const RSI = "#c084fc";
const GOLD = "#f0b90b";

export type ObZone = {
	price?: number | null;
	level?: string;
} | null;

type DragRole = "entry" | "sl" | "be" | `tp${number}`;

type Props = {
	symbol: string;
	bars?: PocBars | undefined;
	bullishOb?: ObZone | undefined;
	bearishOb?: ObZone | undefined;
	orderPlan?: PocBracketPlan | null;
	onPlanChange?: (plan: PocBracketPlan) => void;
	snapPrices?: number[];
};

function asTime(t: number): UTCTimestamp {
	return t as UTCTimestamp;
}

function lineData(points: PocLinePoint[] | undefined) {
	return (points ?? []).map((p) => ({ time: asTime(p.time), value: p.value }));
}

function lineOpts(color: string, width: 1 | 2 = 1) {
	return {
		color,
		lineWidth: width,
		priceLineVisible: false,
		lastValueVisible: false,
	} as const;
}

function lastValue(points: PocLinePoint[] | undefined): number | undefined {
	const last = points?.[points.length - 1];
	return last?.value;
}

export function PriceChart({
	symbol,
	bars,
	bullishOb,
	bearishOb,
	orderPlan,
	onPlanChange,
	snapPrices,
}: Props) {
	const candleRef = useRef<HTMLDivElement | null>(null);
	const rsiRef = useRef<HTMLDivElement | null>(null);
	const chartRef = useRef<IChartApi | null>(null);
	const rsiChartRef = useRef<IChartApi | null>(null);
	const candleSeries = useRef<ISeriesApi<"Candlestick"> | null>(null);
	const volumeSeries = useRef<ISeriesApi<"Histogram"> | null>(null);
	const sma20Series = useRef<ISeriesApi<"Line"> | null>(null);
	const sma50Series = useRef<ISeriesApi<"Line"> | null>(null);
	const ema3Series = useRef<ISeriesApi<"Line"> | null>(null);
	const ema10Series = useRef<ISeriesApi<"Line"> | null>(null);
	const ema20Series = useRef<ISeriesApi<"Line"> | null>(null);
	const ema50Series = useRef<ISeriesApi<"Line"> | null>(null);
	const ema100Series = useRef<ISeriesApi<"Line"> | null>(null);
	const rsiSeries = useRef<ISeriesApi<"Line"> | null>(null);
	const bullLine = useRef<IPriceLine | null>(null);
	const bearLine = useRef<IPriceLine | null>(null);
	const planLines = useRef<IPriceLine[]>([]);
	const planRef = useRef(orderPlan);
	const onPlanChangeRef = useRef(onPlanChange);
	const snapRef = useRef<number[]>([]);
	const dragRef = useRef<DragRole | null>(null);
	const [bands, setBands] = useState<
		{ top: number; height: number; color: string }[]
	>([]);

	planRef.current = orderPlan;
	onPlanChangeRef.current = onPlanChange;

	useEffect(() => {
		if (!candleRef.current) return;
		const chart = createChart(candleRef.current, {
			layout: {
				background: { type: ColorType.Solid, color: "transparent" },
				textColor: "#9aa4b2",
			},
			grid: {
				vertLines: { color: "rgba(255,255,255,0.04)" },
				horzLines: { color: "rgba(255,255,255,0.04)" },
			},
			rightPriceScale: { borderVisible: false },
			timeScale: { borderVisible: false },
			height: 280,
		});
		candleSeries.current = chart.addSeries(CandlestickSeries, {
			upColor: LONG,
			downColor: SHORT,
			borderUpColor: LONG,
			borderDownColor: SHORT,
			wickUpColor: LONG,
			wickDownColor: SHORT,
		});
		volumeSeries.current = chart.addSeries(HistogramSeries, {
			priceFormat: { type: "volume" },
			priceScaleId: "",
		});
		volumeSeries.current.priceScale().applyOptions({
			scaleMargins: { top: 0.78, bottom: 0 },
		});
		sma20Series.current = chart.addSeries(LineSeries, lineOpts(SMA20, 2));
		sma50Series.current = chart.addSeries(LineSeries, lineOpts(SMA50, 2));
		ema3Series.current = chart.addSeries(LineSeries, lineOpts(EMA3));
		ema10Series.current = chart.addSeries(LineSeries, lineOpts(EMA10));
		ema20Series.current = chart.addSeries(LineSeries, lineOpts(EMA20));
		ema50Series.current = chart.addSeries(LineSeries, lineOpts(EMA50));
		ema100Series.current = chart.addSeries(LineSeries, lineOpts(EMA100));
		chartRef.current = chart;

		let rsiChart: IChartApi | null = null;
		if (rsiRef.current) {
			rsiChart = createChart(rsiRef.current, {
				layout: {
					background: { type: ColorType.Solid, color: "transparent" },
					textColor: "#9aa4b2",
				},
				grid: {
					vertLines: { color: "rgba(255,255,255,0.04)" },
					horzLines: { color: "rgba(255,255,255,0.04)" },
				},
				rightPriceScale: { borderVisible: false },
				timeScale: { visible: false, borderVisible: false },
				height: 72,
			});
			rsiSeries.current = rsiChart.addSeries(LineSeries, {
				color: RSI,
				lineWidth: 2,
				priceLineVisible: false,
			});
			rsiChart.priceScale("right").applyOptions({
				scaleMargins: { top: 0.1, bottom: 0.1 },
			});
			rsiChartRef.current = rsiChart;
			chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
				if (range) rsiChart?.timeScale().setVisibleLogicalRange(range);
			});
		}

		const onResize = () => {
			if (candleRef.current) {
				chart.applyOptions({ width: candleRef.current.clientWidth });
			}
			if (rsiRef.current && rsiChart) {
				rsiChart.applyOptions({ width: rsiRef.current.clientWidth });
			}
		};
		onResize();
		window.addEventListener("resize", onResize);
		return () => {
			window.removeEventListener("resize", onResize);
			chart.remove();
			rsiChart?.remove();
			chartRef.current = null;
			rsiChartRef.current = null;
		};
	}, []);

	useEffect(() => {
		if (!candleSeries.current || !bars?.candles?.length) return;
		candleSeries.current.setData(
			bars.candles.map((c) => ({
				time: asTime(c.time),
				open: c.open,
				high: c.high,
				low: c.low,
				close: c.close,
			})),
		);
		volumeSeries.current?.setData(
			(bars.volume ?? []).map((p) => ({
				time: asTime(p.time),
				value: p.value,
				color: p.color,
			})),
		);
		sma20Series.current?.setData(lineData(bars.overlays?.sma20));
		sma50Series.current?.setData(lineData(bars.overlays?.sma50));
		ema3Series.current?.setData(lineData(bars.overlays?.ema3));
		ema10Series.current?.setData(lineData(bars.overlays?.ema10));
		ema20Series.current?.setData(lineData(bars.overlays?.ema20));
		ema50Series.current?.setData(lineData(bars.overlays?.ema50));
		ema100Series.current?.setData(lineData(bars.overlays?.ema100));
		const rsiPoints =
			(bars.oscillators?.rsi3?.length ?? 0) > 0
				? bars.oscillators?.rsi3
				: bars.oscillators?.rsi;
		rsiSeries.current?.setData(lineData(rsiPoints));
		chartRef.current?.timeScale().fitContent();
		rsiChartRef.current?.timeScale().fitContent();
	}, [bars]);

	useEffect(() => {
		const series = candleSeries.current;
		if (!series) return;
		if (bullLine.current) {
			series.removePriceLine(bullLine.current);
			bullLine.current = null;
		}
		if (bearLine.current) {
			series.removePriceLine(bearLine.current);
			bearLine.current = null;
		}
		if (bullishOb?.price != null) {
			bullLine.current = series.createPriceLine({
				price: bullishOb.price,
				color: LONG,
				lineWidth: 1,
				lineStyle: LineStyle.Dashed,
				title: `OB ${bullishOb.level ?? "HIGH"}`,
				axisLabelVisible: true,
			});
		}
		if (bearishOb?.price != null) {
			bearLine.current = series.createPriceLine({
				price: bearishOb.price,
				color: SHORT,
				lineWidth: 1,
				lineStyle: LineStyle.Dashed,
				title: `OB ${bearishOb.level ?? "LOW"}`,
				axisLabelVisible: true,
			});
		}
	}, [bullishOb, bearishOb]);

	useEffect(() => {
		const derived: number[] = [...(snapPrices ?? [])];
		if (bullishOb?.price != null) derived.push(bullishOb.price);
		if (bearishOb?.price != null) derived.push(bearishOb.price);
		for (const key of ["ema3", "ema10", "ema20", "ema50", "ema100"] as const) {
			const v = lastValue(bars?.overlays?.[key]);
			if (v != null) derived.push(v);
		}
		snapRef.current = derived;
	}, [snapPrices, bullishOb, bearishOb, bars]);

	useEffect(() => {
		const series = candleSeries.current;
		if (!series) return;
		for (const line of planLines.current) {
			try {
				series.removePriceLine(line);
			} catch {
				/* already removed with series */
			}
		}
		planLines.current = [];
		if (!orderPlan) {
			setBands([]);
			return;
		}
		const add = (
			price: number | undefined,
			color: string,
			style: LineStyle,
			title: string,
		) => {
			if (price == null) return;
			planLines.current.push(
				series.createPriceLine({
					price,
					color,
					lineWidth: 1,
					lineStyle: style,
					title,
					axisLabelVisible: true,
				}),
			);
		};
		const entry = orderPlan.entry.price;
		const tp1 = orderPlan.tps[0]?.price;
		const sl = orderPlan.sl?.price;
		add(entry, GOLD, LineStyle.Solid, "Entry");
		orderPlan.tps.forEach((tp, i) => {
			const r =
				entry != null && sl != null && entry !== sl && tp.price != null
					? (Math.abs(tp.price - entry) / Math.abs(entry - sl)).toFixed(1)
					: "";
			const pct =
				entry != null && tp.price != null
					? `${(((tp.price - entry) / entry) * 100).toFixed(1)}%`
					: "";
			add(tp.price, LONG, LineStyle.LargeDashed, `TP${i + 1} ${pct} ${r}R`);
		});
		if (sl != null && entry != null) {
			const pct = `${(((sl - entry) / entry) * 100).toFixed(1)}%`;
			add(sl, SHORT, LineStyle.Dashed, `SL ${pct}`);
		}
		const be = breakEvenPrice(orderPlan);
		if (orderPlan.break_even?.on === "tp1_fill" && be != null) {
			add(be, GOLD, LineStyle.Dotted, "BE");
		}

		const yEntry = entry != null ? series.priceToCoordinate(entry) : null;
		const yTp = tp1 != null ? series.priceToCoordinate(tp1) : null;
		const ySl = sl != null ? series.priceToCoordinate(sl) : null;
		const next: { top: number; height: number; color: string }[] = [];
		if (yEntry != null && yTp != null) {
			next.push({
				top: Math.min(yEntry, yTp),
				height: Math.abs(yTp - yEntry),
				color: "rgba(14, 203, 129, 0.12)",
			});
		}
		if (yEntry != null && ySl != null) {
			next.push({
				top: Math.min(yEntry, ySl),
				height: Math.abs(ySl - yEntry),
				color: "rgba(246, 70, 93, 0.12)",
			});
		}
		setBands(next);
	}, [orderPlan, bars]);

	useEffect(() => {
		const el = candleRef.current;
		const series = candleSeries.current;
		if (!el || !series) return;

		const hit = (y: number): DragRole | null => {
			const plan = planRef.current;
			if (!plan) return null;
			const candidates: { role: DragRole; price: number }[] = [];
			if (plan.entry.price != null)
				candidates.push({ role: "entry", price: plan.entry.price });
			plan.tps.forEach((tp, i) => {
				if (tp.price != null)
					candidates.push({ role: `tp${i + 1}`, price: tp.price });
			});
			if (plan.sl?.price != null)
				candidates.push({ role: "sl", price: plan.sl.price });
			let best: { role: DragRole; dist: number } | null = null;
			for (const c of candidates) {
				const cy = series.priceToCoordinate(c.price);
				if (cy == null) continue;
				const dist = Math.abs(cy - y);
				if (dist <= 8 && (!best || dist < best.dist))
					best = { role: c.role, dist };
			}
			return best?.role ?? null;
		};

		const snap = (price: number) => {
			for (const s of snapRef.current) {
				if (Math.abs(s - price) / Math.max(Math.abs(price), 1) < 0.0015)
					return s;
			}
			return price;
		};

		const onDown = (event: PointerEvent) => {
			const rect = el.getBoundingClientRect();
			const role = hit(event.clientY - rect.top);
			if (!role) return;
			dragRef.current = role;
			el.setPointerCapture(event.pointerId);
			event.preventDefault();
		};
		const onMove = (event: PointerEvent) => {
			const rect = el.getBoundingClientRect();
			const y = event.clientY - rect.top;
			if (!dragRef.current) {
				el.style.cursor = hit(y) ? "ns-resize" : "";
				return;
			}
			const raw = series.coordinateToPrice(y);
			if (raw == null) return;
			const plan = planRef.current;
			const cb = onPlanChangeRef.current;
			if (!plan || !cb) return;
			cb(updateLegPrice(plan, dragRef.current, Number(snap(raw).toFixed(4))));
		};
		const onUp = (event: PointerEvent) => {
			if (!dragRef.current) return;
			dragRef.current = null;
			try {
				el.releasePointerCapture(event.pointerId);
			} catch {
				/* not captured */
			}
		};

		el.addEventListener("pointerdown", onDown);
		el.addEventListener("pointermove", onMove);
		el.addEventListener("pointerup", onUp);
		el.addEventListener("pointercancel", onUp);
		return () => {
			el.removeEventListener("pointerdown", onDown);
			el.removeEventListener("pointermove", onMove);
			el.removeEventListener("pointerup", onUp);
			el.removeEventListener("pointercancel", onUp);
		};
	}, []);

	const overlays = bars?.overlays;
	const hasRsi3 = (bars?.oscillators?.rsi3?.length ?? 0) > 0;
	const hasRsi = hasRsi3 || (bars?.oscillators?.rsi?.length ?? 0) > 0;

	return (
		<div>
			<div className="relative">
				<div
					ref={candleRef}
					className="w-full"
					role="img"
					aria-label={`${symbol} candlestick chart`}
				/>
				{bands.map((band) => (
					<div
						key={`${band.color}-${band.top}`}
						className="pointer-events-none absolute right-0 left-0"
						style={{
							top: band.top,
							height: band.height,
							background: band.color,
						}}
					/>
				))}
			</div>
			<div
				ref={rsiRef}
				className={`w-full ${hasRsi ? "" : "hidden"}`}
				aria-hidden={!hasRsi}
			/>
			<div className="mt-2 flex flex-wrap gap-3 text-[10px] uppercase tracking-wide text-muted-foreground">
				<span className="text-long">Bull</span>
				<span className="text-short">Bear</span>
				{(overlays?.sma20?.length ?? 0) > 0 ? (
					<span style={{ color: SMA20 }}>SMA20</span>
				) : null}
				{(overlays?.sma50?.length ?? 0) > 0 ? (
					<span style={{ color: SMA50 }}>SMA50</span>
				) : null}
				{(overlays?.ema3?.length ?? 0) > 0 ? (
					<span style={{ color: EMA3 }}>EMA3</span>
				) : null}
				{(overlays?.ema10?.length ?? 0) > 0 ? (
					<span style={{ color: EMA10 }}>EMA10</span>
				) : null}
				{(overlays?.ema20?.length ?? 0) > 0 ? (
					<span style={{ color: EMA20 }}>EMA20</span>
				) : null}
				{(overlays?.ema50?.length ?? 0) > 0 ? (
					<span style={{ color: EMA50 }}>EMA50</span>
				) : null}
				{(overlays?.ema100?.length ?? 0) > 0 ? (
					<span style={{ color: EMA100 }}>EMA100</span>
				) : null}
				{hasRsi ? (
					<span className="text-purple-400">{hasRsi3 ? "RSI3" : "RSI"}</span>
				) : null}
				{bullishOb?.price != null ? (
					<span className="text-long">OB bull</span>
				) : null}
				{bearishOb?.price != null ? (
					<span className="text-short">OB bear</span>
				) : null}
				{orderPlan ? (
					<>
						<span style={{ color: GOLD }}>Entry</span>
						<span className="text-long">TP</span>
						<span className="text-short">SL</span>
					</>
				) : null}
			</div>
		</div>
	);
}

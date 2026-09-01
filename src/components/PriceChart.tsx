import {
	CandlestickSeries,
	ColorType,
	createChart,
	HistogramSeries,
	type IChartApi,
	type ISeriesApi,
	LineSeries,
	type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { PocBars, PocLinePoint } from "@/api/market-client";

const LONG = "#0ecb81";
const SHORT = "#f6465d";
const SMA20 = "#f0b90b";
const SMA50 = "#3dd6c6";
const EMA = "#60a5fa";

type Props = {
	symbol: string;
	bars?: PocBars | undefined;
};

function asTime(t: number): UTCTimestamp {
	return t as UTCTimestamp;
}

function lineData(points: PocLinePoint[] | undefined) {
	return (points ?? []).map((p) => ({ time: asTime(p.time), value: p.value }));
}

export function PriceChart({ symbol, bars }: Props) {
	const candleRef = useRef<HTMLDivElement | null>(null);
	const rsiRef = useRef<HTMLDivElement | null>(null);
	const chartRef = useRef<IChartApi | null>(null);
	const rsiChartRef = useRef<IChartApi | null>(null);
	const candleSeries = useRef<ISeriesApi<"Candlestick"> | null>(null);
	const volumeSeries = useRef<ISeriesApi<"Histogram"> | null>(null);
	const sma20Series = useRef<ISeriesApi<"Line"> | null>(null);
	const sma50Series = useRef<ISeriesApi<"Line"> | null>(null);
	const emaSeries = useRef<ISeriesApi<"Line"> | null>(null);
	const rsiSeries = useRef<ISeriesApi<"Line"> | null>(null);

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
		sma20Series.current = chart.addSeries(LineSeries, {
			color: SMA20,
			lineWidth: 2,
			priceLineVisible: false,
			lastValueVisible: false,
		});
		sma50Series.current = chart.addSeries(LineSeries, {
			color: SMA50,
			lineWidth: 2,
			priceLineVisible: false,
			lastValueVisible: false,
		});
		emaSeries.current = chart.addSeries(LineSeries, {
			color: EMA,
			lineWidth: 1,
			priceLineVisible: false,
			lastValueVisible: false,
		});
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
				color: "#c084fc",
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
		emaSeries.current?.setData(lineData(bars.overlays?.ema20));
		rsiSeries.current?.setData(lineData(bars.oscillators?.rsi));
		chartRef.current?.timeScale().fitContent();
		rsiChartRef.current?.timeScale().fitContent();
	}, [bars]);

	const hasRsi = (bars?.oscillators?.rsi?.length ?? 0) > 0;

	return (
		<div>
			<div
				ref={candleRef}
				className="w-full"
				role="img"
				aria-label={`${symbol} candlestick chart`}
			/>
			<div
				ref={rsiRef}
				className={`w-full ${hasRsi ? "" : "hidden"}`}
				aria-hidden={!hasRsi}
			/>
			<div className="mt-2 flex flex-wrap gap-3 text-[10px] uppercase tracking-wide text-muted-foreground">
				<span className="text-long">Bull</span>
				<span className="text-short">Bear</span>
				<span style={{ color: SMA20 }}>SMA20</span>
				<span style={{ color: SMA50 }}>SMA50</span>
				<span style={{ color: EMA }}>EMA20</span>
				{hasRsi ? <span className="text-purple-400">RSI</span> : null}
			</div>
		</div>
	);
}

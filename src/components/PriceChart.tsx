import {
	AreaSeries,
	ColorType,
	createChart,
	type IChartApi,
	type ISeriesApi,
	type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";

type Props = {
	lastPrice?: number;
	symbol: string;
};

/** Synthetic sparkline around lastPrice for MVP; wire real bars later. */
export function PriceChart({ lastPrice = 100, symbol }: Props) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const chartRef = useRef<IChartApi | null>(null);
	const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

	useEffect(() => {
		if (!containerRef.current) return;
		const chart = createChart(containerRef.current, {
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
		const series = chart.addSeries(AreaSeries, {
			lineColor: "#3dd6c6",
			topColor: "rgba(61, 214, 198, 0.35)",
			bottomColor: "rgba(61, 214, 198, 0.02)",
		});
		seriesRef.current = series;
		chartRef.current = chart;

		const onResize = () => {
			if (containerRef.current) {
				chart.applyOptions({ width: containerRef.current.clientWidth });
			}
		};
		onResize();
		window.addEventListener("resize", onResize);
		return () => {
			window.removeEventListener("resize", onResize);
			chart.remove();
		};
	}, []);

	useEffect(() => {
		if (!seriesRef.current) return;
		const now = Math.floor(Date.now() / 1000);
		const points = Array.from({ length: 40 }, (_, i) => {
			const wobble = Math.sin(i / 4) * (lastPrice * 0.01);
			return {
				time: (now - (40 - i) * 86400) as UTCTimestamp,
				value: lastPrice + wobble,
			};
		});
		seriesRef.current.setData(points);
	}, [lastPrice]);

	return (
		<div
			ref={containerRef}
			className="w-full"
			role="img"
			aria-label={`${symbol} chart`}
		/>
	);
}

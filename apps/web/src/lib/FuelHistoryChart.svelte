<script lang="ts">
	import { i18n } from './i18n/index.svelte';
	import type { Confidence, HistoryResponse } from './types';
	let { history }: { history: HistoryResponse | null } = $props();
	let t = $derived(i18n.t.chart);
	let f = $derived(i18n.format);
	let level = $derived(i18n.t.confidence);
	let rangeMonths = $state<3 | 6 | 12>(12);
	/** Width of the centered moving average in days; 1 shows the raw daily estimates. */
	let smoothingDays = $state(1);
	type SeriesKey = 'estimate' | 'official' | 'weekly';
	/** Series toggled from the legend; the y-axis fits whichever are shown. */
	let visible = $state<Record<SeriesKey, boolean>>({
		estimate: true,
		official: true,
		weekly: true
	});
	const DAY_MS = 86_400_000;
	type ChartEstimate = {
		timestamp: string;
		price: number;
		confidence: Confidence;
		model_version: string;
		kind: 'reconstructed' | 'stored';
	};
	/** Measured container width; the chart is drawn at its real pixel size so text stays legible. */
	let containerWidth = $state(0);
	let width = $derived(Math.max(containerWidth || 900, 280));
	let height = $derived(Math.round(Math.min(430, Math.max(260, width * 0.62))));
	const left = 68,
		right = 24,
		top = 24,
		bottom = 68;
	let legendItems = $derived<Array<{ key: SeriesKey; label: string }>>([
		{
			key: 'estimate',
			label: smoothingDays === 1 ? t.dailyEstimate : t.smoothedEstimate(smoothingDays)
		},
		{ key: 'official', label: t.official },
		...(history?.weekly?.length ? [{ key: 'weekly' as const, label: t.weekly }] : [])
	]);
	let series = $derived.by(() => {
		if (!history) return null;
		const availableTimes = [
			...history.official.map((item) => Date.parse(item.date)),
			...history.estimates.map((item) => Date.parse(item.timestamp)),
			...(history.reconstructedDaily ?? []).map((item) => Date.parse(item.date))
		].filter((value) => Number.isFinite(value));
		if (!availableTimes.length) return null;
		const latest = new Date(Math.max(...availableTimes)).toISOString().slice(0, 10);
		const [year, month] = latest.split('-').map(Number);
		const cutoff = new Date(Date.UTC(year, month - rangeMonths, 1)).toISOString().slice(0, 10);
		const reconstruction = history.reconstructed ?? [];
		// A monthly average describes the whole month; plot it at mid-month, not month-end.
		const allOfficial = history.official
			.map((item) => ({ ...item, time: Date.parse(`${item.date.slice(0, 8)}15`) }))
			.sort((a, b) => a.time - b.time);
		const official = allOfficial.filter((item) => item.date >= cutoff);
		// Carry the reported line in from the chart's left edge: interpolate between the last
		// month before the cutoff and the first one inside it, so the line doesn't start mid-chart.
		const cutoffTime = Date.parse(cutoff);
		const before = allOfficial.filter((item) => item.time < cutoffTime).at(-1);
		const officialLine =
			before && official.length
				? [
						{
							time: cutoffTime,
							price:
								before.price +
								((official[0].price - before.price) * (cutoffTime - before.time)) /
									(official[0].time - before.time)
						},
						...official
					]
				: official;
		// A manual recalculation can create more than one snapshot in a day. Keep the last one so the
		// chart represents the value a visitor would have seen at the end of each calculation day.
		// Stored calculations replace reconstructed days only when they come from the same model;
		// mixing versions makes the line jump between two models from day to day.
		const modelVersion =
			history.modelVersion ??
			history.estimates.reduce(
				(latest, item) => (item.timestamp > latest.timestamp ? item : latest),
				{
					timestamp: '',
					model_version: ''
				}
			).model_version;
		const estimatesByDay: Record<string, ChartEstimate> = {};
		for (const estimate of history.reconstructedDaily ?? []) {
			if (!Number.isFinite(estimate.price) || !Number.isFinite(Date.parse(estimate.date))) continue;
			estimatesByDay[estimate.date] = {
				timestamp: `${estimate.date}T23:59:59Z`,
				price: estimate.price,
				confidence: estimate.confidence,
				model_version: modelVersion,
				kind: 'reconstructed'
			};
		}
		for (const estimate of history.estimates
			.filter(
				(item) =>
					item.model_version === modelVersion &&
					Number.isFinite(item.price) &&
					Number.isFinite(Date.parse(item.timestamp))
			)
			.sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
			estimatesByDay[estimate.timestamp.slice(0, 10)] = { ...estimate, kind: 'stored' };
		}
		const allEstimates = Object.values(estimatesByDay)
			.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
			.map((item) => ({
				...item,
				time: Date.parse(`${item.timestamp.slice(0, 10)}T00:00:00Z`)
			}));
		// Centered moving average over calendar days, computed before the range cut so the left
		// edge still averages over a full window. Near the latest day the window shrinks.
		const halfWindow = ((smoothingDays - 1) / 2) * DAY_MS;
		let start = 0,
			end = 0,
			sum = 0;
		const smoothed = allEstimates.map((item) => {
			while (end < allEstimates.length && allEstimates[end].time <= item.time + halfWindow)
				sum += allEstimates[end++].price;
			while (allEstimates[start].time < item.time - halfWindow) sum -= allEstimates[start++].price;
			return { time: item.time, price: sum / (end - start) };
		});
		const inRange = (item: { time: number }) => item.time >= cutoffTime;
		const estimates = allEstimates.filter(inRange);
		const smoothedEstimates = smoothed.filter(inRange);
		const latestEstimate = estimates.at(-1) ?? null;
		const comparisons = reconstruction
			.filter((item) => item.date >= cutoff)
			.map((item) => ({ ...item, time: Date.parse(item.date) }));
		const weekly = (history.weekly ?? [])
			.map((item) => ({ ...item, time: Date.parse(`${item.date}T00:00:00Z`) }))
			.filter((item) => Number.isFinite(item.price) && item.time >= cutoffTime)
			.sort((a, b) => a.time - b.time);
		const finite = (item: { time: number; price: number }) =>
			Number.isFinite(item.time) && Number.isFinite(item.price);
		const everything = [...estimates, ...officialLine, ...weekly].filter(finite);
		if (!everything.length) return null;
		// Time spans every series so toggling doesn't shift the x-axis; prices fit the shown ones.
		const shown = [
			...(visible.estimate ? estimates : []),
			...(visible.official ? officialLine : []),
			...(visible.weekly ? weekly : [])
		].filter(finite);
		const all = shown.length ? shown : everything;
		const minTime = Math.min(...everything.map((item) => item.time)),
			maxTime = Math.max(...everything.map((item) => item.time));
		const prices = all.map((item) => item.price);
		const rawMin = Math.min(...prices),
			rawMax = Math.max(...prices),
			padding = Math.max((rawMax - rawMin) * 0.12, 0.03);
		const minPrice = rawMin - padding,
			maxPrice = rawMax + padding;
		const x = (time: number) =>
			left + ((time - minTime) / Math.max(maxTime - minTime, 1)) * (width - left - right);
		const y = (price: number) =>
			top + ((maxPrice - price) / (maxPrice - minPrice)) * (height - top - bottom);
		const path = (values: Array<{ time: number; price: number }>) =>
			values
				.map((item, index) => `${index ? 'L' : 'M'} ${x(item.time)} ${y(item.price)}`)
				.join(' ');
		const xTicks = [
			...official.map((p) => p.time),
			...(latestEstimate ? [latestEstimate.time] : [])
		].filter((value, index, values) => values.indexOf(value) === index);
		return {
			estimates,
			official,
			weekly,
			comparisons,
			latest: latestEstimate,
			x,
			y,
			xTicks,
			// Label only every nth tick when they would crowd, counting back so the latest stays labeled.
			labelEvery: Math.max(1, Math.ceil((xTicks.length * 64) / (width - left - right))),
			yTicks: Array.from({ length: 6 }, (_, i) => maxPrice - ((maxPrice - minPrice) * i) / 5),
			estimatePath: path(smoothedEstimates),
			officialPath: path(officialLine),
			weeklyPath: path(weekly)
		};
	});
</script>

<section aria-labelledby="history-heading">
	<p>{t.intro}</p>
	<div class="range-controls" role="group" aria-label={t.controls}>
		{#each [3, 6, 12] as const as months (months)}
			<button
				type="button"
				class:active={rangeMonths === months}
				aria-pressed={rangeMonths === months}
				onclick={() => (rangeMonths = months)}>{t.months(months)}</button
			>
		{/each}
		<label class="smoothing">
			{t.smoothing}
			<input type="range" min="1" max="31" step="2" bind:value={smoothingDays} />
			<output>{smoothingDays === 1 ? t.smoothingOff : t.smoothingValue(smoothingDays)}</output>
		</label>
	</div>
	{#if series}
		<div class="chart-legend" role="group" aria-label={t.legend}>
			{#each legendItems as item (item.key)}
				<button
					type="button"
					class:off={!visible[item.key]}
					aria-pressed={visible[item.key]}
					onclick={() => (visible[item.key] = !visible[item.key])}
					><i class={`${item.key}-key`}></i> {item.label}</button
				>
			{/each}
		</div>
		<div bind:clientWidth={containerWidth}>
			<svg
				viewBox={`0 0 ${width} ${height}`}
				role="img"
				aria-labelledby="chart-title chart-description"
			>
				<title id="chart-title">{t.title}</title><desc id="chart-description">{t.description}</desc>
				{#each series.yTicks as value (value)}{@const y = series.y(value)}<line
						x1={left}
						x2={width - right}
						y1={y}
						y2={y}
						class="grid"
					/><text x={left - 10} y={y + 4} text-anchor="end">{f.euros(value)}</text>{/each}
				{#each series.xTicks as value, index (value)}{@const x = series.x(value)}<line
						x1={x}
						x2={x}
						y1={top}
						y2={height - bottom}
						class="vertical grid"
					/>{#if (series.xTicks.length - 1 - index) % series.labelEvery === 0}<text
							{x}
							y={height - bottom + 22}
							text-anchor={x === left ? 'start' : x > width - right - 2 ? 'end' : 'middle'}
							>{f.monthTick(value)}</text
						>{/if}{/each}
				<text x={(left + width - right) / 2} y={height - 8} text-anchor="middle" class="axis-title"
					>{t.xAxis}</text
				><text
					transform={`translate(16 ${(top + height - bottom) / 2}) rotate(-90)`}
					text-anchor="middle"
					class="axis-title">{t.yAxis}</text
				>
				{#if visible.weekly}<path d={series.weeklyPath} class="weekly-line" />
					{#each series.weekly as point (point.date)}<circle
							cx={series.x(point.time)}
							cy={series.y(point.price)}
							r="2.5"
							class="weekly-point"
							><title>{t.weeklyPoint(point.date, f.perLitre(point.price, 3))}</title></circle
						>{/each}{/if}
				{#if visible.official}<path d={series.officialPath} class="official-line" />{/if}
				{#if visible.estimate}<path d={series.estimatePath} class="estimate-line" />{/if}
				{#if visible.official}{#each series.official as point (point.date)}<circle
							cx={series.x(point.time)}
							cy={series.y(point.price)}
							r="4.5"
							class="official-point"
							><title>{t.officialPoint(point.date, f.perLitre(point.price, 3))}</title></circle
						>{/each}{/if}
				{#if visible.estimate}{#each series.estimates as point (point.timestamp)}<circle
							cx={series.x(point.time)}
							cy={series.y(point.price)}
							r="2.5"
							class={`estimate-point confidence-${point.confidence}`}
							class:smoothed={smoothingDays > 1}
							><title
								>{t.estimatePoint(
									point.timestamp.slice(0, 10),
									f.perLitre(point.price, 3),
									level[point.confidence],
									point.kind === 'stored'
								)}</title
							></circle
						>{/each}{/if}
			</svg>
		</div>
		{#if series.latest}<p>
				{t.latest(
					f.perLitre(series.latest.price),
					series.latest.timestamp.slice(0, 10),
					level[series.latest.confidence]
				)}
			</p>{/if}
		{#if series.comparisons.length}
			<h3>{t.comparisons}</h3>
			<div class="table-scroll">
				<table>
					<thead
						><tr
							><th>{t.columns.month}</th><th>{t.columns.estimate}</th><th>{t.columns.official}</th
							><th>{t.columns.error}</th><th>{t.columns.confidence}</th></tr
						></thead
					><tbody
						>{#each series.comparisons as row (row.date)}<tr
								><td>{row.date.slice(0, 7)}</td><td>{f.perLitre(row.estimated_price, 3)}</td><td
									>{f.perLitre(row.official_price, 3)}</td
								><td>{f.cents(row.error)}</td><td>{level[row.confidence]}</td></tr
							>{/each}</tbody
					>
				</table>
			</div>
		{:else}<p>{t.noComparisons}</p>{/if}
		<details>
			<summary>{t.inputs}</summary>
			<div class="table-scroll">
				<table>
					<thead
						><tr
							><th>{t.columns.month}</th><th>{t.columns.anchor}</th><th
								>{t.columns.anchorBenchmark}</th
							><th>{t.columns.monthBenchmark}</th><th>{t.columns.vat}</th><th
								>{t.columns.taxChange}</th
							></tr
						></thead
					><tbody
						>{#each series.comparisons as row (row.date)}<tr
								><td>{row.date}</td><td>{f.number(row.anchor_price, 4)}</td><td
									>{f.number(row.anchor_benchmark, 4)}</td
								><td>{f.number(row.current_benchmark, 4)}</td><td>{f.percent(row.vat_rate, 1)}</td
								><td>{f.number(row.tax_adjustment, 4)}</td></tr
							>{/each}</tbody
					>
				</table>
			</div>
		</details>
	{:else}<p>{t.empty}</p>{/if}
</section>

<style>
	svg .official-line {
		stroke: #5796ef;
		stroke-dasharray: none;
		opacity: 1;
		fill: none;
	}
	svg .official-point {
		fill: #5796ef;
		stroke: Canvas;
	}
	svg .estimate-line {
		stroke: #55b66b;
		fill: none;
	}
	svg .estimate-point {
		fill: #55b66b;
		stroke: none;
		opacity: 1;
	}
	/* Keep the raw daily values (and their tooltips) visible behind the smoothed line. */
	svg .estimate-point.smoothed {
		opacity: 0.3;
	}
	.chart-legend .estimate-key {
		border-color: #55b66b;
	}
	.chart-legend .official-key {
		border-color: #5796ef;
		border-top-style: solid;
		opacity: 1;
	}
	.chart-legend .weekly-key {
		border-color: #e39b3c;
		border-top-style: dashed;
	}
	svg .weekly-line {
		stroke: #e39b3c;
		stroke-dasharray: 5 4;
		fill: none;
	}
	svg .weekly-point {
		fill: #e39b3c;
		stroke: none;
	}
	.chart-legend {
		flex-wrap: wrap;
	}
	.chart-legend button {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.2rem 0.4rem;
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	/* A hidden series keeps its legend entry, dimmed and struck through. */
	.chart-legend button.off {
		opacity: 0.45;
		text-decoration: line-through;
	}
	.range-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		margin: 1rem 0;
	}
	.range-controls .smoothing {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-left: auto;
	}
	.range-controls output {
		min-width: 8.5rem;
		font-variant-numeric: tabular-nums;
	}
	.range-controls button {
		padding: 0.35rem 0.65rem;
	}
</style>

<script lang="ts">
	import FuelHistoryChart from '$lib/FuelHistoryChart.svelte';
	import MathFormula from '$lib/Math.svelte';
	import RichText from '$lib/i18n/RichText.svelte';
	import { i18n, locales } from '$lib/i18n/index.svelte';
	import type { Fuel } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let selectedFuel = $state<Fuel>('95E10');
	let selected = $derived(data.fuels[selectedFuel]);
	let current = $derived(selected.current);
	let backtest = $derived(selected.history?.backtest ?? null);
	let t = $derived(i18n.t);
	let f = $derived(i18n.format);
	/** API-provided names and descriptions, translated when known. */
	const sourceName = (name: string) => t.details.sources.names[name] ?? name;

	const languageNames = { en: 'English', fi: 'Suomi' };
	/** Model 2.1 carries the anchor forward with weekly pump prices when they cover it. */
	/** Where the benchmark movement is measured from: the latest weekly date, else the anchor month. */
	let fromBenchmark = $derived(
		current?.calculation.weeklyBenchmarkEurL ?? current?.calculation.anchorBenchmarkEurL ?? 0
	);
	let usesWeekly = $derived(current?.components.weeklyPrice != null);
	let equations = $derived({
		estimate: usesWeekly
			? '\\widehat{P}_t = P_a + (\\overline{W}_t - W^{*}_a) + \\beta(1+v_t)(\\overline{B}_t-\\overline{B}_w) + (\\tau_t-\\tau_w)(1+v_t) + \\frac{P_a + \\overline{W}_t - W^{*}_a}{1+v_w}(v_t-v_w)'
			: '\\widehat{P}_t = P_a + \\beta(1+v_t)(\\overline{B}_t-\\overline{B}_a) + (\\tau_t-\\tau_a)(1+v_t) + \\frac{P_a}{1+v_a}(v_t-v_a)',
		weeklyMean:
			'\\overline{W}_t = \\tfrac{1}{2}\\left(w_{k-1} + w_k\\right), \\qquad k = \\text{latest week published by } t',
		weeklyBaseline:
			'W^{*}_a = P_a - \\frac{1}{6}\\sum_{m=a-5}^{a}\\left(P_m - \\overline{w}_m\\right)',
		calibration: `\\hat\\beta = \\arg\\min_\\beta \\sum_m \\big(P_{m} - P_{m-1} - \\Delta\\mathrm{${t.method.mathLabels.tax}}_m - \\beta(1+v_m)(\\overline{B}_m-\\overline{B}_{m-1})\\big)^2`,
		benchmark:
			'b_i^{\\mathrm{EUR/L}} = \\frac{q_i^{\\mathrm{USD/gal}}}{x_i^{\\mathrm{USD/EUR}} \\cdot 3.785411784}',
		rolling:
			'\\overline{B}_t = \\frac{1}{N_t}\\sum_{i\\in W_t} b_i^{\\mathrm{EUR/L}}, \\qquad W_t=[t-L-W+1,\\ t-L]',
		decomposition: `\\Delta P_t = \\Delta P_{\\mathrm{${t.method.mathLabels.product}}} + \\Delta P_{\\mathrm{FX}} + \\Delta P_{\\mathrm{${t.method.mathLabels.tax}}}`
	});
</script>

<main>
	<header>
		<h1>fuel.<a href="https://eeru.net" style="text-decoration: underline;">eeru.net</a></h1>
		<div class="header-controls">
			<nav aria-label={t.fuelType} class="slash-group">
				{#each ['95E10', 'DIESEL'] as const as fuel, index (fuel)}
					<button
						type="button"
						class:active={selectedFuel === fuel}
						aria-pressed={selectedFuel === fuel}
						onclick={() => (selectedFuel = fuel)}>{t.fuels[fuel]}</button
					>
					{#if index < 1}<span aria-hidden="true">/</span>{/if}
				{/each}
			</nav>
			<div class="slash-group" role="group" aria-label={t.language}>
				{#each locales as locale, index (locale)}
					<button
						type="button"
						lang={locale}
						class:active={i18n.locale === locale}
						aria-pressed={i18n.locale === locale}
						aria-label={languageNames[locale]}
						onclick={() => i18n.set(locale)}>{locale.toUpperCase()}</button
					>
					{#if index < locales.length - 1}<span aria-hidden="true">/</span>{/if}
				{/each}
			</div>
		</div>
	</header>

	{#if current}
		<section aria-labelledby="current-heading" class="summary">
			<div>
				<p id="current-heading">{t.summary.heading}</p>
				<strong>{f.euros(current.estimate.price)}<small>/{f.litre}</small></strong>
				{#if current.estimate.range}
					<p>
						{t.summary.range(
							f.percent(current.estimate.range.coverage),
							f.euros(current.estimate.range.low),
							f.euros(current.estimate.range.high)
						)}
					</p>
				{/if}
				<p>{t.summary.sinceOfficial(f.cents(current.estimate.changeSinceAnchor))}</p>
			</div>
			<dl>
				<div>
					<dt>{t.summary.confidence}</dt>
					<dd class={`confidence-${current.estimate.confidence}`}>
						{t.confidence[current.estimate.confidence]}
					</dd>
				</div>
				<div>
					<dt>{t.summary.officialPrice}</dt>
					<dd>{f.perLitre(current.official.price)}</dd>
				</div>
				<div>
					<dt>{t.summary.officialDate}</dt>
					<dd>
						{f.date(current.official.date)} · {t.summary.age(t.days(current.official.ageDays))}
					</dd>
				</div>
				<div>
					<dt>{t.summary.marketAge}</dt>
					<dd>{t.days(current.marketDataAgeDays)}</dd>
				</div>
				<div>
					<dt>{t.summary.calculated}</dt>
					<dd>
						<time datetime={current.estimate.timestamp}
							>{f.dateTime(current.estimate.timestamp)}</time
						>
					</dd>
				</div>
				{#if backtest}
					<div>
						<dt>{t.summary.typicalError}</dt>
						<dd>
							{t.summary.typicalErrorValue(f.centsAbs(backtest.mae), f.centsAbs(backtest.naiveMae))}
						</dd>
					</div>
				{/if}
			</dl>
		</section>
		<FuelHistoryChart history={selected.history} />

		<section aria-labelledby="details-heading" class="details">
			<div class="details-intro">
				<h2 id="details-heading">{t.details.heading}</h2>
				<p>{t.details.disclaimer}</p>
			</div>

			<details open>
				<summary>{t.details.change.heading}</summary>
				<dl>
					{#if current.components.weeklyPrice != null}<div>
							<dt>{t.details.change.weekly}</dt>
							<dd>{f.cents(current.components.weeklyPrice)}</dd>
						</div>{/if}
					<div>
						<dt>{t.details.change.product}</dt>
						<dd>{f.cents(current.components.refinedProduct)}</dd>
					</div>
					<div>
						<dt>{t.details.change.currency}</dt>
						<dd>{f.cents(current.components.currency)}</dd>
					</div>
					<div>
						<dt>{t.details.change.tax}</dt>
						<dd>{f.cents(current.components.tax)}</dd>
					</div>
					<div>
						<dt>{t.details.change.total}</dt>
						<dd>{f.cents(current.estimate.changeSinceAnchor)}</dd>
					</div>
				</dl>
			</details>

			<details open>
				<summary>{t.method.heading}</summary>
				<p><RichText parts={t.method.intro} /></p>
				<MathFormula formula={equations.estimate} display />
				<p><RichText parts={usesWeekly ? t.method.symbolsWeekly : t.method.symbols} /></p>
				{#if usesWeekly}
					<h3>{t.method.weeklyHeading}</h3>
					<p><RichText parts={t.method.weeklyMean} /></p>
					<MathFormula formula={equations.weeklyMean} display />
					<p><RichText parts={t.method.weeklyBaseline} /></p>
					<MathFormula formula={equations.weeklyBaseline} display />
				{/if}
				<h3>{t.method.benchmarkHeading}</h3>
				<p>{t.method.conversion}</p>
				<MathFormula formula={equations.benchmark} display />
				<p>
					<RichText
						parts={t.method.rolling(
							current.calculation.windowDays ?? 21,
							current.calculation.lagDays ?? 5
						)}
					/>
				</p>
				<MathFormula formula={equations.rolling} display />
				<p>{usesWeekly ? t.method.weeklyBenchmark : t.method.anchorBenchmark}</p>
				<h3>{t.method.fitHeading}</h3>
				<p><RichText parts={t.method.fit(current.calculation.calibrationSamples)} /></p>
				<MathFormula formula={equations.calibration} display />
				<p>{t.method.selection}</p>
				{#if backtest}
					<p>
						{t.method.backtest(
							f.centsAbs(backtest.mae),
							backtest.samples,
							backtest.from?.slice(0, 7) ?? '',
							backtest.to?.slice(0, 7) ?? '',
							f.centsAbs(backtest.naiveMae),
							f.centsAbs(backtest.errorBound80)
						)}
					</p>
				{/if}
				<h3>{t.method.attributionHeading}</h3>
				<MathFormula formula={equations.decomposition} display />
				<p>{t.method.attribution}</p>
				<dl>
					<div>
						<dt>{t.method.values.anchorPrice}</dt>
						<dd>{f.precise(current.calculation.anchorPriceEurL)}</dd>
					</div>
					{#if usesWeekly && current.calculation.weeklyPriceEurL != null && current.calculation.weeklyBaselineEurL != null}
						<div>
							<dt>{t.method.values.weeklyPrice(current.calculation.weeklyDate ?? '')}</dt>
							<dd>{f.precise(current.calculation.weeklyPriceEurL)}</dd>
						</div>
						<div>
							<dt>{t.method.values.weeklyBaseline}</dt>
							<dd>{f.precise(current.calculation.weeklyBaselineEurL)}</dd>
						</div>
						<div>
							<dt>{t.method.values.weeklyEffect}</dt>
							<dd>{f.precise(current.components.weeklyPrice ?? 0)}</dd>
						</div>
					{/if}
					<div>
						<dt>
							{usesWeekly ? t.method.values.weeklyBenchmark : t.method.values.anchorBenchmark}
						</dt>
						<dd>{f.precise(fromBenchmark)}</dd>
					</div>
					<div>
						<dt>{t.method.values.currentBenchmark}</dt>
						<dd>{f.precise(current.calculation.currentBenchmarkEurL)}</dd>
					</div>
					<div>
						<dt>{t.method.values.movement}</dt>
						<dd>{f.precise(current.calculation.currentBenchmarkEurL - fromBenchmark)}</dd>
					</div>
					<div>
						<dt>{t.method.values.beta}</dt>
						<dd>{f.number(current.calculation.beta, 2)}</dd>
					</div>
					<div>
						<dt>{t.method.values.vat}</dt>
						<dd>{f.percent(current.calculation.vatRate, 1)}</dd>
					</div>
					<div>
						<dt>{t.method.values.market}</dt>
						<dd>{f.precise(current.components.market)}</dd>
					</div>
					<div>
						<dt>{t.method.values.tax}</dt>
						<dd>{f.precise(current.components.tax)}</dd>
					</div>
					<div>
						<dt>{t.method.values.result}</dt>
						<dd>
							{f.precise(
								current.calculation.anchorPriceEurL +
									(current.components.weeklyPrice ?? 0) +
									current.components.market +
									current.components.tax
							)}
						</dd>
					</div>
				</dl>
				<p>
					{t.method.footer(
						t.method.methodNames[current.model.method] ?? current.model.method,
						current.model.version
					)}
				</p>
			</details>

			<details>
				<summary>{t.details.sources.heading}</summary>
				<dl>
					<div>
						<dt>{t.details.sources.official}</dt>
						<dd>{sourceName(current.official.source)}</dd>
					</div>
					<div>
						<dt>{t.details.sources.benchmark}</dt>
						<dd>{sourceName(current.model.benchmark)}</dd>
					</div>
					<div>
						<dt>{t.details.sources.quality}</dt>
						<dd>{t.details.sources.qualities[current.model.benchmarkQuality]}</dd>
					</div>
					<div>
						<dt>{t.details.sources.fx}</dt>
						<dd>{t.details.sources.fxValue}</dd>
					</div>
					{#if usesWeekly}<div>
							<dt>{t.details.sources.weekly}</dt>
							<dd>{t.details.sources.weeklyValue}</dd>
						</div>{/if}
					<div>
						<dt>{t.details.sources.taxes}</dt>
						<dd>{t.details.sources.taxesValue}</dd>
					</div>
				</dl>
			</details>

			<details>
				<summary>{t.details.updates.heading}</summary>
				<p>{t.details.updates.schedule}</p>
				<ul>
					<li>{t.details.updates.official}</li>
					<li>{t.details.updates.weekly}</li>
					<li>{t.details.updates.benchmark}</li>
					<li>{t.details.updates.fx}</li>
					<li>{t.details.updates.taxes}</li>
				</ul>
				<p>{t.details.updates.drift}</p>
			</details>
		</section>
	{:else}
		<section role="status" class="unavailable">
			<h2>{t.unavailable.heading}</h2>
			<p>{t.unavailable.body}</p>
			{#if selected.error}<p><small>{t.unavailable.detail(selected.error)}</small></p>{/if}
		</section>
	{/if}
</main>

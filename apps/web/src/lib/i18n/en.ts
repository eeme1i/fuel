import type { Confidence, Fuel } from '$lib/types';
import { rich, symbols as s } from './rich';

/** Values arrive already formatted for the locale; messages only arrange them. */
export const en = {
	meta: {
		title: 'Finnish fuel price estimate',
		description: 'Daily market-based estimates of average petrol and diesel prices in Finland.'
	},
	language: 'Language',
	fuelType: 'Fuel type',
	fuels: { '95E10': '95E10 petrol', DIESEL: 'Diesel' } satisfies Record<Fuel, string>,
	confidence: { high: 'high', medium: 'medium', low: 'low' } satisfies Record<Confidence, string>,
	days: (n: number) => (n === 1 ? '1 day' : `${n} days`),

	summary: {
		heading: 'Estimated national average',
		range: (coverage: string, low: string, high: string) => `${coverage} range ${low} – ${high}`,
		sinceOfficial: (change: string) => `${change} since the latest official average`,
		confidence: 'Confidence',
		officialPrice: 'Latest official average',
		officialDate: 'Official data',
		age: (days: string) => `${days} old`,
		marketAge: 'Market data age',
		calculated: 'Calculated',
		typicalError: 'Typical monthly error',
		typicalErrorValue: (mae: string, naive: string) => `${mae} (no-change baseline: ${naive})`
	},

	details: {
		heading: 'How this estimate works',
		disclaimer:
			'An estimated national average: the latest official monthly price, carried forward with weekly Finnish pump prices and a US wholesale fuel benchmark. Not a price observed at filling stations.',
		change: {
			heading: 'Change since the official average',
			weekly: 'Weekly pump prices since the official month',
			product: 'Wholesale fuel price',
			currency: 'Exchange rate',
			tax: 'Tax changes',
			total: 'Estimated pump price change'
		},
		sources: {
			heading: 'Data sources',
			official: 'Official Finnish price',
			benchmark: 'Wholesale benchmark',
			quality: 'Benchmark quality',
			qualities: {
				preferred: 'Preferred series',
				proxy: 'Proxy: a US series standing in for European prices'
			},
			fx: 'Exchange rate',
			fxValue: 'European Central Bank EUR/USD reference rate',
			weekly: 'Weekly pump prices',
			weeklyValue: 'European Commission Weekly Oil Bulletin, Finland (prices with taxes)',
			taxes: 'Taxes',
			taxesValue: 'Finnish Tax Administration fuel tax rates by effective date',
			/** Display names for source identifiers from the API; unknown ones are shown as-is. */
			names: { statistics_finland: 'Statistics Finland' } as Record<string, string>
		},
		updates: {
			heading: 'When data is updated',
			schedule:
				'The estimate is recalculated every weekday evening, Finnish time. At weekends the page shows the latest weekday calculation.',
			official: 'Official Finnish price: monthly averages, published around the end of the month',
			weekly:
				'Weekly pump prices: prices in force on Monday, published by the European Commission on Thursday',
			benchmark:
				'Wholesale benchmark: published by the EIA several days after trading; the market data age above shows how recent it is',
			fx: 'Exchange rate: every ECB working day',
			taxes: 'Taxes: updated by hand when rates change',
			drift:
				'The benchmark window moves forward one day with each calculation. The estimate can therefore change slightly even when no new market data has arrived, as the oldest prices drop out of the window.'
		}
	},

	method: {
		heading: 'Model methodology',
		mathLabels: { product: 'product', tax: 'tax' },
		intro: rich`This is an anchored model, not a survey of filling stations. It starts from the latest official monthly average ${s.anchorPrice} and estimates the change since then:`,
		symbols: rich`Here ${s.estimate} is the estimated pump price, ${s.beta} the fitted pass-through coefficient, ${s.vat} the VAT rate, ${s.tax} the total excise tax per litre and ${s.benchmark} the normalized wholesale benchmark. Subscript ${s.anchor} denotes the anchor month and ${s.current} the current date.`,
		symbolsWeekly: rich`Here ${s.estimate} is the estimated pump price, ${s.weekly} the recent weekly pump price, ${s.weeklyBaseline} the weekly price level that matches the anchor, ${s.beta} the fitted pass-through coefficient, ${s.vat} the VAT rate, ${s.tax} the total excise tax per litre and ${s.benchmark} the normalized wholesale benchmark. Subscript ${s.anchor} denotes the anchor month, ${s.week} the latest published week and ${s.current} the current date.`,
		weeklyHeading: 'Weekly pump prices',
		weeklyMean: rich`The European Commission's Weekly Oil Bulletin reports Finnish pump prices, taxes included, in force each Monday, and publishes them on Thursday. Single Monday readings swing by up to 20 cents and back, so ${s.weekly} is the mean of the two latest published weeks:`,
		weeklyBaseline: rich`The bulletin is a different survey from Statistics Finland, so its level differs from the official average by a few cents, and the gap shifts from month to month. Only its change is used: the baseline ${s.weeklyBaseline} subtracts the official-minus-weekly gap averaged over the last six official months, where ${s.weeklyMonth} is the mean weekly price in month m:`,
		weeklyBenchmark:
			'The wholesale benchmark then covers only the days since the latest weekly price, from its value on that Monday.',
		benchmarkHeading: 'Benchmark normalization and smoothing',
		conversion:
			'The US dollar price per gallon is converted to euros per litre with the ECB EUR/USD rate for each market day:',
		rolling: (window: number, lag: number) =>
			rich`Pump prices follow wholesale prices with a delay. The benchmark for day ${s.current} is the mean of weekday observations in a ${window}-day window ending ${lag} days earlier (${s.window} and ${s.lag}):`,
		anchorBenchmark:
			'The anchor benchmark is the mean of this lagged benchmark over the days of the anchor month, so both sides describe the same kind of average.',
		fitHeading: 'Fitting β',
		fit: (samples: number | undefined) =>
			rich`${s.beta} is fitted by least squares on consecutive official months (${samples ? `${samples} month pairs` : 'all available month pairs'}):`,
		selection:
			'The lag and window lengths were chosen by how well each option predicted the next official month from 2016 onwards. Before the stored tax records begin, months that usually carry tax changes (January, July, August) are excluded from the fit.',
		backtest: (
			mae: string,
			samples: number,
			from: string,
			to: string,
			naive: string,
			bound: string
		) =>
			`Predicting each official month from the previous one, using only data from earlier months, gives a mean absolute error of ${mae} over ${samples} months (${from} to ${to}), against ${naive} when assuming no change. 80% of errors were within ${bound}.`,
		attributionHeading: 'Attribution and confidence',
		attribution:
			'The product and currency components split the same benchmark movement; they are not additional terms. The 80% range is the historical out-of-sample error bound, widened by the square root of the time since the anchor month. Confidence follows the width of that range and drops one level if the official anchor is more than two months old, the benchmark window is missing recent data, or the benchmark moved more than 15% within the window.',
		values: {
			anchorPrice: 'Official anchor price',
			weeklyPrice: (date: string) => `Weekly pump price, two weeks to ${date}`,
			weeklyBaseline: 'Weekly baseline',
			weeklyEffect: 'Weekly price change',
			weeklyBenchmark: 'Smoothed benchmark on the latest weekly date',
			anchorBenchmark: 'Smoothed benchmark in anchor month',
			currentBenchmark: 'Current smoothed benchmark',
			movement: 'Benchmark movement',
			beta: 'Pass-through β',
			vat: 'VAT',
			market: 'Market effect incl. VAT',
			tax: 'Tax adjustment',
			result: 'Unrounded model result'
		},
		/** Translations of the API's method description; unknown ones are shown as-is. */
		methodNames: {} as Record<string, string>,
		footer: (method: string, version: string) => `Method: ${method}. Model version: ${version}.`
	},

	unavailable: {
		heading: 'No estimate available yet',
		body: 'An estimate is published once official prices, market data, exchange rates and tax records are all available.',
		detail: (error: string) => `Details: ${error}`
	},

	chart: {
		intro:
			'Daily model estimates against the official monthly average, plotted mid-month. Past points are reconstructed using only the official months and weekly prices published by that day; calculations stored by the current model version replace them where available. The weekly price comes from a different survey, so its level can differ from the official average; the model uses only its change. Click a legend item to show or hide it.',
		controls: 'Chart controls',
		months: (n: number) => `${n} months`,
		smoothing: 'Smoothing',
		smoothingOff: 'Off',
		smoothingValue: (days: number) => `${days}-day average`,
		legend: 'Chart legend',
		dailyEstimate: 'Daily model estimate',
		smoothedEstimate: (days: number) => `Model estimate, ${days}-day centered average`,
		official: 'Official monthly average',
		weekly: 'Weekly pump price (EU Oil Bulletin)',
		title: 'Model estimate and official Finnish fuel prices',
		description:
			'Daily model estimates, reconstructed and stored, with official monthly prices in euros per litre.',
		xAxis: 'Date',
		yAxis: 'Price (€/L)',
		officialPoint: (date: string, price: string) => `${date}: ${price} official`,
		weeklyPoint: (date: string, price: string) =>
			`${date}: ${price} weekly bulletin (prices in force that Monday)`,
		estimatePoint: (date: string, price: string, confidence: string, stored: boolean) =>
			`${date}: ${price} estimate, ${confidence} confidence (${stored ? 'stored calculation' : 'historical reconstruction'})`,
		latest: (price: string, date: string, confidence: string) =>
			`Latest daily estimate: ${price} as of ${date} · ${confidence} confidence.`,
		comparisons: 'Model versus official average',
		columns: {
			month: 'Month',
			estimate: 'Model estimate',
			official: 'Official average',
			error: 'Error',
			confidence: 'Confidence',
			anchor: 'Anchor €/L',
			anchorBenchmark: 'Anchor benchmark €/L',
			monthBenchmark: 'Month benchmark €/L',
			vat: 'VAT',
			taxChange: 'Tax change €/L'
		},
		noComparisons: 'Not enough market or exchange-rate history to reconstruct past estimates.',
		inputs: 'Calculation inputs by month',
		empty: 'No historical estimates yet.'
	}
};

export type Messages = typeof en;

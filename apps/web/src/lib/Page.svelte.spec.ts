import { page } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from '../routes/+page.svelte';
import { i18n } from './i18n/index.svelte';

const current = {
	fuel: '95E10' as const,
	country: 'FI' as const,
	currency: 'EUR' as const,
	unit: 'litre' as const,
	estimate: {
		price: 1.87,
		changeSinceAnchor: 0.062,
		range: { low: 1.82, high: 1.92, coverage: 0.8 },
		confidence: 'medium' as const,
		timestamp: '2026-09-21T12:00:00Z'
	},
	official: { price: 1.81, date: '2026-08-31', source: 'statistics_finland', ageDays: 21 },
	components: { refinedProduct: 0.073, currency: -0.011, market: 0.062, tax: 0 },
	marketDataAgeDays: 2,
	calculation: {
		anchorPriceEurL: 1.81,
		anchorBenchmarkEurL: 0.6,
		currentBenchmarkEurL: 0.6494,
		vatRate: 0.255,
		beta: 1,
		formula: 'anchor + market + tax'
	},
	model: {
		version: '1.0.0',
		benchmark: 'EIA gasoline',
		benchmarkQuality: 'proxy' as const,
		method: 'anchored refined-product pass-through'
	},
	disclaimer: 'Estimated average.'
};

const data = {
	fuels: {
		'95E10': {
			current,
			history: {
				fuel: '95E10',
				unit: 'EUR/litre',
				backtest: {
					samples: 81,
					from: '2018-11-30',
					to: '2026-08-31',
					mae: 0.034,
					rmse: 0.047,
					bias: -0.005,
					errorBound80: 0.056,
					directionAccuracy: 0.68,
					naiveMae: 0.048,
					skill: 0.29
				},
				estimates: [
					{
						timestamp: '2026-09-20T12:00:00Z',
						price: 1.86,
						confidence: 'medium',
						model_version: '1.0.1'
					},
					{
						timestamp: '2026-09-21T12:00:00Z',
						price: 1.87,
						confidence: 'medium',
						model_version: '1.0.1'
					}
				],
				official: [],
				comparisons: []
			}
		},
		DIESEL: { current: null, history: null, error: 'Unavailable' }
	}
} as never;

describe('fuel page', () => {
	afterEach(() => i18n.set('en'));

	it('shows the headline estimate and methodology layer', async () => {
		render(Page, { data });
		await expect.element(page.getByText('€1.87', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByText('How this estimate works')).toBeInTheDocument();
		await expect.element(page.getByText(/80% range €1\.82 – €1\.92/)).toBeInTheDocument();
		await expect
			.element(page.getByText('3.4 c/L (no-change baseline: 4.8 c/L)'))
			.toBeInTheDocument();
		await expect
			.element(page.getByText('Daily model estimate', { exact: true }))
			.toBeInTheDocument();
		await expect.element(page.getByText(/Latest daily estimate: €1\.87\/L/)).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '3 months' })).toBeInTheDocument();
		await expect
			.element(page.getByText('Benchmark normalization and smoothing'))
			.toBeInTheDocument();
	});

	it('switches to Finnish and remembers the choice', async () => {
		render(Page, { data });
		await page.getByRole('button', { name: 'Suomi' }).click();
		await expect.element(page.getByText('Näin arvio lasketaan')).toBeInTheDocument();
		await expect.element(page.getByText('1,87 €', { exact: true })).toBeInTheDocument();
		await expect
			.element(page.getByText(/80\s%:n vaihteluväli 1,82\s€ – 1,92\s€/))
			.toBeInTheDocument();
		await expect.element(page.getByText('Tilastokeskus')).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '3 kk' })).toBeInTheDocument();
		expect(localStorage.getItem('locale')).toBe('fi');
		expect(document.documentElement.lang).toBe('fi');
	});
});

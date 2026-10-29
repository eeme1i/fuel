import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import type { Fuel, FuelPageData, FuelResponse, HistoryResponse } from '$lib/types';
import type { PageServerLoad } from './$types';

const routes: Record<Fuel, string> = { '95E10': '95e10', DIESEL: 'diesel' };
const DEV_API_URL = 'http://127.0.0.1:8787';

type ApiFetch = (path: string) => Promise<Response>;

/**
 * Production uses the `API` service binding (no public API route needed). `API_BASE_URL`
 * overrides it, e.g. to point at a remote API; local development falls back to `wrangler dev`.
 */
function apiFetcher(fetcher: typeof fetch, platform: App.Platform | undefined): ApiFetch | null {
	const baseUrl = env.API_BASE_URL?.replace(/\/$/, '');
	if (baseUrl) return (path) => fetcher(`${baseUrl}${path}`);
	const binding = platform?.env?.API;
	if (binding) return (path) => binding.fetch(`https://fuel-api${path}`);
	if (dev) return (path) => fetcher(`${DEV_API_URL}${path}`);
	return null;
}

async function loadFuel(api: ApiFetch, fuel: Fuel): Promise<FuelPageData> {
	try {
		const route = routes[fuel];
		const [currentResponse, historyResponse] = await Promise.all([
			api(`/api/v1/fuel/${route}`),
			api(`/api/v1/fuel/${route}/history`)
		]);
		const current = currentResponse.ok ? ((await currentResponse.json()) as FuelResponse) : null;
		const history = historyResponse.ok ? ((await historyResponse.json()) as HistoryResponse) : null;
		return {
			current,
			history,
			error: current ? undefined : `Estimate unavailable (${currentResponse.status})`
		};
	} catch (error) {
		return {
			current: null,
			history: null,
			error: error instanceof Error ? error.message : 'API unavailable'
		};
	}
}

export const load: PageServerLoad = async ({ fetch, platform, setHeaders }) => {
	const api = apiFetcher(fetch, platform);
	if (!api) {
		const error = 'API not configured: add the API service binding or set API_BASE_URL';
		const missing = { current: null, history: null, error };
		return { fuels: { '95E10': missing, DIESEL: missing } };
	}
	const [petrol, diesel] = await Promise.all([loadFuel(api, '95E10'), loadFuel(api, 'DIESEL')]);
	// Estimates change once a day; only cache complete pages so an outage is not cached.
	if (petrol.current && diesel.current)
		setHeaders({ 'cache-control': 'public, max-age=300, stale-while-revalidate=3600' });
	return { fuels: { '95E10': petrol, DIESEL: diesel } };
};

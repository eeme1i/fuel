export type Fuel = '95E10' | 'DIESEL';
export type Confidence = 'high' | 'medium' | 'low';

export interface FuelResponse {
	fuel: Fuel;
	country: 'FI';
	currency: 'EUR';
	unit: 'litre';
	estimate: {
		price: number;
		changeSinceAnchor: number;
		/** 80% range from out-of-sample monthly errors; null for snapshots before model 2.0. */
		range?: { low: number; high: number; coverage: number } | null;
		confidence: Confidence;
		timestamp: string;
	};
	official: { price: number; date: string; source: string; ageDays: number };
	components: {
		/** Change carried in from weekly pump prices; null before model 2.1. */
		weeklyPrice?: number | null;
		refinedProduct: number;
		currency: number;
		market: number;
		tax: number;
	};
	calculation: {
		anchorPriceEurL: number;
		anchorBenchmarkEurL: number;
		currentBenchmarkEurL: number;
		vatRate: number;
		beta: number;
		lagDays?: number;
		windowDays?: number;
		calibrationSamples?: number;
		backtestMae?: number;
		backtestNaiveMae?: number;
		/** Weekly pump-price inputs (model 2.1+); null when the estimate used none. */
		weeklyDate?: string | null;
		weeklyPriceEurL?: number | null;
		weeklyBaselineEurL?: number | null;
		weeklyBenchmarkEurL?: number | null;
		formula: string;
	};
	marketDataAgeDays: number;
	model: {
		version: string;
		benchmark: string;
		benchmarkQuality: 'preferred' | 'proxy';
		method: string;
	};
	disclaimer: string;
}

export interface BacktestMetrics {
	samples: number;
	from: string | null;
	to: string | null;
	mae: number;
	rmse: number;
	bias: number;
	errorBound80: number;
	directionAccuracy: number;
	naiveMae: number;
	skill: number;
}

export interface HistoryResponse {
	backtest?: BacktestMetrics | null;
	reconstructedDaily?: Array<{
		date: string;
		price: number;
		low?: number;
		high?: number;
		confidence: Confidence;
		anchor_date: string;
		kind: 'reconstructed';
	}>;
	reconstructed?: Array<{
		date: string;
		official_price: number;
		estimated_price: number;
		error: number;
		naive_error?: number;
		beta?: number;
		confidence: Confidence;
		estimate_timestamp: string;
		anchor_price: number;
		anchor_date: string;
		anchor_benchmark: number;
		current_benchmark: number;
		vat_rate: number;
		tax_adjustment: number;
	}>;
	fuel: Fuel;
	unit: string;
	/** Model version of the reconstruction (API 2.1+). */
	modelVersion?: string;
	estimates: Array<{
		timestamp: string;
		price: number;
		confidence: Confidence;
		model_version: string;
	}>;
	official: Array<{ date: string; price: number; source: string }>;
	/** Finnish weekly pump prices (EU Weekly Oil Bulletin), in force on each Monday. */
	weekly?: Array<{ date: string; price: number; source: string }>;
	comparisons: Array<{
		date: string;
		official_price: number;
		estimated_price: number;
		confidence: Confidence;
		estimate_timestamp: string;
		error: number;
	}>;
}

export interface FuelPageData {
	current: FuelResponse | null;
	history: HistoryResponse | null;
	error?: string;
}

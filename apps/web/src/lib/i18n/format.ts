import type { Locale } from './index.svelte';

/** Number and date formatting that follows the reader's language (decimal comma, unit symbols). */
function createFormat(tag: string, litre: string, cent: string) {
	const numbers: Record<string, Intl.NumberFormat> = {};
	const nf = (digits: number, style: 'decimal' | 'currency' | 'percent' = 'decimal') =>
		(numbers[`${style}${digits}`] ??= new Intl.NumberFormat(tag, {
			style,
			currency: 'EUR',
			minimumFractionDigits: digits,
			maximumFractionDigits: digits
		}));
	const day = new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', year: 'numeric' });
	const dayTime = new Intl.DateTimeFormat(tag, {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: 'Europe/Helsinki'
	});
	const month = new Intl.DateTimeFormat(tag, { month: 'short', year: '2-digit', timeZone: 'UTC' });
	const centsAbs = (value: number) => `${nf(1).format(Math.abs(value * 100))} ${cent}`;
	return {
		litre,
		number: (value: number, digits: number) => nf(digits).format(value),
		percent: (value: number, digits = 0) => nf(digits, 'percent').format(value),
		euros: (value: number, digits = 2) => nf(digits, 'currency').format(value),
		perLitre: (value: number, digits = 2) => `${nf(digits, 'currency').format(value)}/${litre}`,
		/** Price with four decimals, for the calculation breakdown. */
		precise: (value: number) => `${nf(4).format(value)} €/${litre}`,
		cents: (value: number) => `${value >= 0 ? '+' : '−'}${centsAbs(value)}`,
		centsAbs,
		date: (value: string) => day.format(new Date(value)),
		/** Date and time in Finnish time, for calculation timestamps. */
		dateTime: (value: string) => dayTime.format(new Date(value)),
		monthTick: (time: number) => month.format(time)
	};
}

export type Format = ReturnType<typeof createFormat>;

export const formats: Record<Locale, Format> = {
	en: createFormat('en-IE', 'L', 'c/L'),
	fi: createFormat('fi-FI', 'l', 'snt/l')
};

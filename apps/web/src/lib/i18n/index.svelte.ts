import { tick } from 'svelte';
import { en, type Messages } from './en';
import { fi } from './fi';
import { formats } from './format';

export type Locale = 'en' | 'fi';
export const locales: Locale[] = ['en', 'fi'];
export const STORAGE_KEY = 'locale';

const messages: Record<Locale, Messages> = { en, fi };
const isLocale = (value: unknown): value is Locale => locales.includes(value as Locale);

// The server always renders English. The inline script in app.html picks the stored or browser
// language before first paint, writes it to <html lang>, and hides the page until init() runs.
let current = $state<Locale>('en');

export const i18n = {
	get locale() {
		return current;
	},
	get t() {
		return messages[current];
	},
	get format() {
		return formats[current];
	},
	set(locale: Locale) {
		current = locale;
		document.documentElement.lang = locale;
		try {
			localStorage.setItem(STORAGE_KEY, locale);
		} catch {
			// Storage can be unavailable (private mode, blocked site data); the choice lasts the visit.
		}
	},
	/** Applies the language chosen by the app.html script, then reveals the page. */
	async init() {
		const chosen = document.documentElement.lang;
		if (isLocale(chosen)) current = chosen;
		await tick();
		document.documentElement.classList.remove('i18n-pending');
	}
};

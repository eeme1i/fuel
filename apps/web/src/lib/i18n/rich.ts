/** Text with inline formulas: strings render as text, `{ tex }` parts through KaTeX. */
export type Rich = Array<string | { tex: string }>;

export const tex = (formula: string) => ({ tex: formula });

/** Tagged template that keeps `tex()` interpolations as formulas and stringifies the rest. */
export function rich(
	strings: TemplateStringsArray,
	...values: Array<string | number | { tex: string }>
): Rich {
	return strings.flatMap((text, i) => {
		if (i >= values.length) return [text];
		const value = values[i];
		return [text, typeof value === 'object' ? value : String(value)];
	});
}

export const symbols = {
	anchorPrice: tex('P_a'),
	estimate: tex('\\widehat{P}_t'),
	beta: tex('\\beta'),
	vat: tex('v'),
	tax: tex('\\tau'),
	benchmark: tex('\\overline{B}'),
	anchor: tex('a'),
	current: tex('t'),
	window: tex('W'),
	lag: tex('L'),
	weekly: tex('\\overline{W}_t'),
	weeklyBaseline: tex('W^{*}_a'),
	week: tex('w'),
	weeklyMonth: tex('\\overline{w}_m')
};

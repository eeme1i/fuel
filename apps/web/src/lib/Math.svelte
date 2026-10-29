<script lang="ts">
	import katex from 'katex';
	import 'katex/dist/katex.min.css';

	let { formula, display = false }: { formula: string; display?: boolean } = $props();
	let rendered = $derived(
		katex.renderToString(formula, {
			displayMode: display,
			output: 'htmlAndMathml',
			throwOnError: false,
			trust: false
		})
	);
</script>

<!-- KaTeX escapes untrusted commands and formula is supplied by this application. -->
<!-- eslint-disable-next-line svelte/no-at-html-tags -->
<span class:display>{@html rendered}</span>

<style>
	.display {
		display: block;
		overflow-x: auto;
		overflow-y: hidden;
		padding: 0.75rem 0;
	}
</style>

<script lang="ts">
	import MathFormula from '$lib/Math.svelte';
	import type { Rich } from './rich';

	let { parts }: { parts: Rich } = $props();
</script>

{#each parts as part, index (index)}{#if typeof part === 'string'}{part}{:else}<MathFormula
			formula={part.tex}
		/>{/if}{/each}

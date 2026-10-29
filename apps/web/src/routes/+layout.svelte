<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { i18n } from '$lib/i18n/index.svelte';
	import { onMount } from 'svelte';

	let { children } = $props();

	onMount(() => {
		i18n.init();
	});
</script>

<svelte:head
	><link rel="icon" href={favicon} /><title>{i18n.t.meta.title}</title><meta
		name="description"
		content={i18n.t.meta.description}
	/></svelte:head
>
{@render children()}

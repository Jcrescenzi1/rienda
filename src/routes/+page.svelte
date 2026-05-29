<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';

	let estado = $state('Conectando con la base de datos...');
	let tablas = $state<string[]>([]);

	onMount(async () => {
		try {
			const filas = await query(
				"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
			);
			tablas = filas.map((f: any) => f.name);
			estado = `Base de datos OK. Tablas creadas: ${tablas.length}`;
		} catch (e: any) {
			estado = 'Error: ' + (e?.message ?? String(e));
		}
	});
</script>

<h1>Rienda</h1>
<p>{estado}</p>

{#if tablas.length > 0}
	<ul>
		{#each tablas as t(t)}
			<li>{t}</li>
		{/each}
	</ul>
{/if}
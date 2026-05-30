<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';

	let estado = $state('Cargando... (la primera vez migra 2.059 gastos, tarda unos segundos)');
	let r = $state<any>({});
	let porCat = $state<any[]>([]);

	onMount(async () => {
		try {
			const t = await query('SELECT COUNT(*) AS n FROM tarjeta WHERE perfil_id=1');
			const c = await query('SELECT COUNT(*) AS n FROM categoria WHERE perfil_id=1');
			const s = await query('SELECT COUNT(*) AS n FROM subcategoria WHERE perfil_id=1');
			const m = await query('SELECT COUNT(*) AS n FROM mapeo_detalle WHERE perfil_id=1');
			const g = await query(
				'SELECT COUNT(*) AS n, COALESCE(SUM(monto),0) AS total, MIN(fecha) AS desde, MAX(fecha) AS hasta FROM gasto WHERE perfil_id=1'
			);
			r = {
				tarjetas: t[0].n, categorias: c[0].n, subcategorias: s[0].n, mapeos: m[0].n,
				gastos: g[0].n, total: g[0].total, desde: g[0].desde, hasta: g[0].hasta
			};
			porCat = await query(
				'SELECT c.nombre, COUNT(*) AS n, SUM(g.monto) AS total FROM gasto g JOIN categoria c ON c.id=g.categoria_id WHERE g.perfil_id=1 GROUP BY c.nombre ORDER BY total DESC'
			);
			estado = 'Migración completa ✅';
		} catch (e: any) {
			estado = 'Error: ' + (e?.message ?? String(e));
		}
	});

	const pesos = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
</script>

<h1>Rienda</h1>
<p><strong>{estado}</strong></p>

{#if r.gastos}
	<p>{r.tarjetas} tarjetas · {r.categorias} categorías · {r.subcategorias} subcategorías · {r.mapeos} mapeos</p>
	<p><strong>{r.gastos} gastos</strong> · total {pesos(r.total)} · del {r.desde} al {r.hasta}</p>

	<h2>Gastos por categoría</h2>
	<table>
		<thead><tr><th>Categoría</th><th>Cant.</th><th>Total</th></tr></thead>
		<tbody>
			{#each porCat as row (row.nombre)}
				<tr><td>{row.nombre}</td><td>{row.n}</td><td>{pesos(row.total)}</td></tr>
			{/each}
		</tbody>
	</table>
{/if}

<style>
	table { border-collapse: collapse; margin-top: 8px; }
	th, td { border: 1px solid #ccc; padding: 4px 10px; }
	td:nth-child(2), td:nth-child(3) { text-align: right; }
</style>
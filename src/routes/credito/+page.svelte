<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';

	let meses = $state<string[]>([]);
	let tarjetas = $state<string[]>([]);
	let matriz = $state<Record<string, Record<string, number>>>({});
	let totalMes = $state<Record<string, number>>({});
	let detallePorMes = $state<Record<string, any[]>>({});
	let cargando = $state(true);

	const CTE = `
		WITH RECURSIVE serie(gasto_id, tarjeta_id, detalle, total, cuotas, n, inicio) AS (
			SELECT id, tarjeta_id, detalle, monto, cuotas, 0, mes_inicio_pago
			FROM gasto WHERE perfil_id=1 AND medio='credito'
			UNION ALL
			SELECT gasto_id, tarjeta_id, detalle, total, cuotas, n+1, inicio
			FROM serie WHERE n+1 < cuotas
		)
		SELECT strftime('%Y-%m', date(inicio, '+'||n||' months')) AS mes,
		       t.nombre AS tarjeta, total*1.0/cuotas AS cuota,
		       serie.detalle, n+1 AS nro, serie.cuotas
		FROM serie JOIN tarjeta t ON t.id = serie.tarjeta_id
		ORDER BY mes, tarjeta`;

	onMount(async () => {
		const filas = (await query(CTE)) as any[];
		const mSet = new Set<string>();
		const tSet = new Set<string>();
		const mat: Record<string, Record<string, number>> = {};
		const tot: Record<string, number> = {};
		const det: Record<string, any[]> = {};
		for (const f of filas) {
			mSet.add(f.mes);
			tSet.add(f.tarjeta);
			mat[f.mes] ??= {};
			mat[f.mes][f.tarjeta] = (mat[f.mes][f.tarjeta] ?? 0) + f.cuota;
			tot[f.mes] = (tot[f.mes] ?? 0) + f.cuota;
			(det[f.mes] ??= []).push(f);
		}
		meses = [...mSet].sort();
		tarjetas = [...tSet].sort();
		matriz = mat;
		totalMes = tot;
		detallePorMes = det;
		cargando = false;
	});

	let mesAbierto = $state<string | null>(null);
	const peso = (n: number | undefined) => (n ? '$' + Math.round(n).toLocaleString('es-AR') : '—');
</script>

<h1>Vista de crédito</h1>
<p class="sub">Cada gasto en crédito se reparte (total ÷ cuotas) desde su mes de inicio. El total por mes suma todas las cuotas vigentes.</p>

{#if cargando}
	<p>Cargando…</p>
{:else if meses.length === 0}
	<p>Todavía no hay gastos en crédito. Cargá uno desde "Cargar gasto" (elegí Crédito) y volvé acá.</p>
{:else}
	<table>
		<thead>
			<tr><th>Mes</th>{#each tarjetas as t (t)}<th>{t}</th>{/each}<th>Total</th></tr>
		</thead>
		<tbody>
			{#each meses as m (m)}
				<tr class="mes" onclick={() => (mesAbierto = mesAbierto === m ? null : m)}>
					<td>{mesAbierto === m ? '▾' : '▸'} {m}</td>
					{#each tarjetas as t (t)}<td class="num">{peso(matriz[m]?.[t])}</td>{/each}
					<td class="num total">{peso(totalMes[m])}</td>
				</tr>
				{#if mesAbierto === m}
					<tr class="detalle">
						<td colspan={tarjetas.length + 2}>
							<ul>
								{#each detallePorMes[m] as d (d.gasto_id)}
									<li>{d.detalle} — {d.tarjeta} — cuota {d.nro}/{d.cuotas} — {peso(d.cuota)}</li>
								{/each}
							</ul>
						</td>
					</tr>
				{/if}
			{/each}
		</tbody>
	</table>
	<p class="sub">Clic en un mes para ver el detalle de cuotas.</p>
{/if}

<style>
	:global(body) { font-family: system-ui, sans-serif; max-width: 820px; margin: 0 auto; padding: 16px; }
	.sub { font-size: 0.85rem; color: #666; }
	table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 0.9rem; }
	th, td { border: 1px solid #ddd; padding: 5px 8px; text-align: left; }
	td.num { text-align: right; white-space: nowrap; }
	td.total { font-weight: 700; }
	tr.mes { cursor: pointer; }
	tr.mes:hover { background: #f5f8ff; }
	tr.detalle ul { margin: 4px 0; padding-left: 18px; }
	tr.detalle li { font-size: 0.85rem; color: #444; }
</style>
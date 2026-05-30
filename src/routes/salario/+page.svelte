<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';

	let sueldos: Record<string, number> = {};
	let infl: Record<string, number> = {};
	let dolar: Record<string, number> = {};
	let anios = $state<string[]>([]);
	let anio = $state('');
	let filas = $state<any[]>([]);
	let resumen = $state<any>({});
	let resumenAnios = $state<any[]>([]);
	let cargando = $state(true);

	function calcularAnio(y: string) {
		const periodos = Object.keys(sueldos)
			.filter((p) => p.startsWith(y))
			.sort();
		if (periodos.length === 0) return { filas: [], resumen: {} };
		const base = sueldos[periodos[0]];
		let acum = 1;
		const rows = periodos.map((p, i) => {
			if (i > 0) acum *= 1 + (infl[p] ?? 0);
			const teorico = base * acum;
			const rep = sueldos[p];
			const d = dolar[p];
			return {
				periodo: p,
				infl: infl[p] ?? null,
				acum,
				reportado: rep,
				teorico,
				poder: (rep / teorico) * 100,
				usd: d ? rep / d : null
			};
		});
		const inflAcum = acum - 1;
		const varNominal = sueldos[periodos[periodos.length - 1]] / sueldos[periodos[0]] - 1;
		return {
			filas: rows,
			resumen: { inflAcum, varNominal, gano: varNominal >= inflAcum, desde: periodos[0], hasta: periodos[periodos.length - 1] }
		};
	}

	function recomputar() {
		const r = calcularAnio(anio);
		filas = r.filas;
		resumen = r.resumen;
	}

	onMount(async () => {
		const s = (await query("SELECT periodo, SUM(monto) AS m FROM ingreso WHERE perfil_id=1 AND tipo='Sueldo' AND periodo IS NOT NULL GROUP BY periodo")) as any[];
		for (const x of s) sueldos[x.periodo] = x.m;
		const inf = (await query('SELECT periodo, valor FROM inflacion WHERE perfil_id=1')) as any[];
		for (const x of inf) infl[x.periodo] = x.valor;
		const dol = (await query('SELECT substr(fecha,1,7) AS p, valor FROM cotizacion_dolar WHERE perfil_id=1')) as any[];
		for (const x of dol) dolar[x.p] = x.valor;

		anios = [...new Set(Object.keys(sueldos).map((p) => p.slice(0, 4)))].sort();
		anio = anios[anios.length - 1] ?? '';

		resumenAnios = anios.map((y) => ({ anio: y, ...calcularAnio(y).resumen }));
		recomputar();
		cargando = false;
	});

	const peso = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-AR');
	const usd = (n: number | null) => (n == null ? '—' : 'U$D ' + Math.round(n).toLocaleString('es-AR'));
	const pct = (n: number | null, dec = 1) => (n == null ? '—' : (n * 100).toFixed(dec) + '%');
	let maxUsd = $derived(Math.max(1, ...filas.map((f) => f.usd ?? 0)));
</script>

<h1>Salario</h1>

{#if cargando}
	<p>Cargando…</p>
{:else}
	<label class="sel">Año:
		<select bind:value={anio} onchange={recomputar}>
			{#each anios as y (y)}<option value={y}>{y}</option>{/each}
		</select>
	</label>

	<div class="resumen">
		<div class="card"><span>Inflación acum. {resumen.desde}→{resumen.hasta}</span><strong>{pct(resumen.inflAcum)}</strong></div>
		<div class="card"><span>Variación nominal sueldo</span><strong>{pct(resumen.varNominal)}</strong></div>
		<div class="card" class:ok={resumen.gano} class:bad={!resumen.gano}>
			<span>Resultado real</span><strong>{resumen.gano ? 'Le ganó a la inflación' : 'Perdió contra inflación'}</strong>
		</div>
	</div>

	<h2>Poder adquisitivo {anio}</h2>
	<table>
		<thead>
			<tr><th>Período</th><th>Inflación</th><th>Acum.</th><th>Reportado</th><th>Teórico</th><th>Poder adq.</th><th>En USD</th></tr>
		</thead>
		<tbody>
			{#each filas as f (f.periodo)}
				<tr>
					<td>{f.periodo}</td>
					<td class="num">{pct(f.infl)}</td>
					<td class="num">{f.acum.toFixed(3)}</td>
					<td class="num">{peso(f.reportado)}</td>
					<td class="num">{peso(f.teorico)}</td>
					<td class="num" class:ok={f.poder >= 100} class:bad={f.poder < 100}>{f.poder.toFixed(0)}%</td>
					<td class="num">{usd(f.usd)}</td>
				</tr>
			{/each}
		</tbody>
	</table>

	<h2>Sueldo en dólares (moneda dura)</h2>
	<div class="bars">
		{#each filas as f (f.periodo)}
			<div class="barrow">
				<span class="lbl">{f.periodo}</span>
				<div class="track"><div class="bar" style="width:{((f.usd ?? 0) / maxUsd) * 100}%"></div></div>
				<span class="val">{usd(f.usd)}</span>
			</div>
		{/each}
	</div>

	<h2>Resumen por año</h2>
	<table>
		<thead><tr><th>Año</th><th>Inflación acum.</th><th>Var. nominal sueldo</th><th>Resultado</th></tr></thead>
		<tbody>
			{#each resumenAnios as r (r.anio)}
				<tr>
					<td>{r.anio}</td>
					<td class="num">{pct(r.inflAcum)}</td>
					<td class="num">{pct(r.varNominal)}</td>
					<td class:ok={r.gano} class:bad={!r.gano}>{r.gano ? 'Ganó' : 'Perdió'}</td>
				</tr>
			{/each}
		</tbody>
	</table>
	<p class="nota">El "teórico" parte del primer sueldo del año y se ajusta por la inflación acumulada de cada mes (enero = base, resetea cada año). El poder adquisitivo compara tu sueldo reportado contra ese teórico.</p>
{/if}

<style>
	:global(body) { font-family: system-ui, sans-serif; max-width: 820px; margin: 0 auto; padding: 16px; }
	.sel { font-size: 0.9rem; display: inline-flex; gap: 8px; align-items: center; }
	h2 { font-size: 1.1rem; margin-top: 22px; }
	.resumen { display: flex; gap: 10px; flex-wrap: wrap; margin: 12px 0; }
	.card { border: 1px solid #ddd; border-radius: 8px; padding: 8px 14px; display: flex; flex-direction: column; min-width: 150px; }
	.card span { font-size: 0.72rem; color: #777; }
	.card strong { font-size: 1.05rem; }
	.card.ok { background: #eafaf0; border-color: #b6e6c8; }
	.card.bad { background: #fdeceb; border-color: #f3c2bf; }
	table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
	th, td { border: 1px solid #ddd; padding: 5px 8px; text-align: left; }
	td.num { text-align: right; white-space: nowrap; }
	td.ok { color: #137333; font-weight: 600; }
	td.bad { color: #c5221f; font-weight: 600; }
	.bars { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
	.barrow { display: flex; align-items: center; gap: 8px; font-size: 0.82rem; }
	.lbl { width: 64px; color: #555; }
	.track { flex: 1; background: #f0f0f0; border-radius: 4px; height: 16px; overflow: hidden; }
	.bar { height: 100%; background: #1a73e8; }
	.val { width: 90px; text-align: right; color: #333; }
	.nota { font-size: 0.8rem; color: #777; margin-top: 12px; }
</style>
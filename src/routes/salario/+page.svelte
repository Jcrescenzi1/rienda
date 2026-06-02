<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';

	let sueldos: Record<string, number> = {};
	let infl: Record<string, number> = {};
	let dolar: Record<string, number> = {};
	let periodosTodos: string[] = [];

	let vista = $state<'historico' | 'ult12' | 'anio'>('historico');
	let anio = $state('');
	let anios = $state<string[]>([]);
	let cargando = $state(true);

	onMount(async () => {
		const s = (await query("SELECT periodo, SUM(monto) AS m FROM ingreso WHERE perfil_id=1 AND tipo='Sueldo' AND periodo IS NOT NULL GROUP BY periodo")) as any[];
		for (const x of s) sueldos[x.periodo] = x.m;
		const inf = (await query('SELECT periodo, valor FROM inflacion WHERE perfil_id=1')) as any[];
		for (const x of inf) infl[x.periodo] = x.valor;
		const dol = (await query('SELECT substr(fecha,1,7) AS p, valor FROM cotizacion_dolar WHERE perfil_id=1')) as any[];
		for (const x of dol) dolar[x.p] = x.valor;
		periodosTodos = Object.keys(sueldos).sort();
		anios = [...new Set(periodosTodos.map((p) => p.slice(0, 4)))].sort();
		anio = anios[anios.length - 1] ?? '';
		cargando = false;
	});

	// Períodos de la ventana elegida
	let periodos = $derived.by(() => {
		if (vista === 'historico') return periodosTodos;
		if (vista === 'anio') return periodosTodos.filter((p) => p.startsWith(anio));
		// últimos 12
		return periodosTodos.slice(-12);
	});

	// Serie base 100: salario (var nominal acum) e inflación (acum hasta mes anterior)
	let serie = $derived.by(() => {
		const ps = periodos;
		if (ps.length === 0) return [];
		const base = sueldos[ps[0]];
		let idxInfl = 1;
		return ps.map((p, i) => {
			if (i > 0) idxInfl *= 1 + (infl[ps[i - 1]] ?? 0);
			return {
				periodo: p,
				salario: (sueldos[p] / base) * 100,
				inflacion: idxInfl * 100,
				usd: dolar[p] ? sueldos[p] / dolar[p] : null
			};
		});
	});

	let ultimo = $derived(serie.length ? serie[serie.length - 1] : null);
	let brechaActual = $derived(ultimo ? ultimo.salario / ultimo.inflacion - 1 : 0);

	// Resumen para tarjetas
	let resumen = $derived.by(() => {
		if (!serie.length) return { inflAcum: 0, varNominal: 0, gano: true, desde: '', hasta: '' };
		const u = serie[serie.length - 1];
		return {
			inflAcum: u.inflacion / 100 - 1,
			varNominal: u.salario / 100 - 1,
			gano: u.salario >= u.inflacion,
			desde: serie[0].periodo,
			hasta: u.periodo
		};
	});

	// Gráfico
	const W = 720, H = 320, P = { l: 44, r: 70, t: 16, b: 28 };
	let chart = $derived.by(() => {
		if (serie.length < 2) return null;
		const allV = serie.flatMap((s) => [s.salario, s.inflacion]);
		let minY = Math.min(...allV), maxY = Math.max(...allV);
		const padY = (maxY - minY) * 0.08 || 1; minY -= padY; maxY += padY;
		const n = serie.length;
		const px = (i: number) => P.l + (i / (n - 1)) * (W - P.l - P.r);
		const py = (y: number) => H - P.b - ((y - minY) / (maxY - minY)) * (H - P.t - P.b);
		const linea = (key: 'salario' | 'inflacion') =>
			serie.map((s, i) => (i ? 'L' : 'M') + px(i).toFixed(1) + ',' + py(s[key]).toFixed(1)).join(' ');
		const yticks = Array.from({ length: 4 }, (_, k) => {
			const v = minY + ((maxY - minY) * k) / 3;
			return { y: py(v), label: v.toFixed(0) };
		});
		const step = Math.max(1, Math.floor(n / 8));
		const xticks = serie.map((s, i) => ({ i, p: s.periodo })).filter((_, i) => i % step === 0)
			.map((o) => ({ x: px(o.i), label: o.p.slice(2) }));
		return {
			salario: linea('salario'), inflacion: linea('inflacion'), yticks, xticks,
			ptsS: serie.map((s, i) => ({ x: px(i), y: py(s.salario) })),
			ptsI: serie.map((s, i) => ({ x: px(i), y: py(s.inflacion) })),
			finS: { x: px(n - 1), y: py(serie[n - 1].salario) },
			finI: { x: px(n - 1), y: py(serie[n - 1].inflacion) }
		};
	});

	const pct = (n: number, dec = 1) => (n >= 0 ? '+' : '') + (n * 100).toFixed(dec) + '%';
</script>

<h1>Salario</h1>

{#if cargando}
	<p>Cargando…</p>
{:else}
	<div class="resumen">
		<div class="card"><span>Inflación acum. {resumen.desde}→{resumen.hasta}</span><strong>{pct(resumen.inflAcum)}</strong></div>
		<div class="card"><span>Variación nominal sueldo</span><strong>{pct(resumen.varNominal)}</strong></div>
		<div class="card" class:ok={resumen.gano} class:bad={!resumen.gano}>
			<span>Poder adquisitivo vs base</span><strong>{pct(brechaActual)}</strong>
		</div>
	</div>

	<div class="vistas">
		<button class:activo={vista === 'historico'} onclick={() => (vista = 'historico')}>Histórico</button>
		<button class:activo={vista === 'ult12'} onclick={() => (vista = 'ult12')}>Últimos 12 meses</button>
		<button class:activo={vista === 'anio'} onclick={() => (vista = 'anio')}>Año calendario</button>
		{#if vista === 'anio'}
			<select bind:value={anio}>{#each anios as y (y)}<option value={y}>{y}</option>{/each}</select>
		{/if}
	</div>

	<div class="leyenda">
		<span class="leg"><span class="sw sw-sal"></span> Salario</span>
		<span class="leg"><span class="sw sw-inf"></span> Inflación</span>
		<span class="aclara">Ambas en base 100 al inicio de la ventana. Si Salario va por encima, le ganás a la inflación.</span>
	</div>

	{#if chart}
		<svg viewBox="0 0 {W} {H}" class="chart">
			{#each chart.yticks as t}
				<line x1={P.l} y1={t.y} x2={W - P.r} y2={t.y} class="grid" />
				<text x={P.l - 6} y={t.y + 3} class="ylbl">{t.label}</text>
			{/each}
			{#each chart.xticks as t}<text x={t.x} y={H - 8} class="xlbl">{t.label}</text>{/each}
			<path d={chart.inflacion} class="line-inf" />
			<path d={chart.salario} class="line-sal" />
			{#each chart.ptsI as p}<circle cx={p.x} cy={p.y} r="2" class="dot-inf" />{/each}
			{#each chart.ptsS as p}<circle cx={p.x} cy={p.y} r="2" class="dot-sal" />{/each}
			<text x={chart.finS.x + 5} y={chart.finS.y + 3} class="endlbl sal">{serie[serie.length-1].salario.toFixed(0)}</text>
			<text x={chart.finI.x + 5} y={chart.finI.y + 3} class="endlbl inf">{serie[serie.length-1].inflacion.toFixed(0)}</text>
		</svg>
	{:else}
		<p class="nota">No hay suficientes meses en esta ventana para graficar.</p>
	{/if}

	<p class="nota">El salario del período N se compara contra la inflación acumulada hasta el mes anterior (la inflación de un mes impacta el sueldo del mes siguiente). La brecha entre las líneas es tu poder adquisitivo respecto al inicio de la ventana.</p>
{/if}

<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	.resumen { display: flex; gap: 10px; flex-wrap: wrap; margin: 12px 0; }
	.card { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 8px 14px; display: flex; flex-direction: column; min-width: 150px; }
	.card span { font-size: 0.72rem; color: var(--text-dim); }
	.card strong { font-size: 1.05rem; }
	.card.ok { background: rgba(74, 222, 128, 0.10); border-color: rgba(74, 222, 128, 0.35); }
	.card.bad { background: rgba(248, 113, 113, 0.10); border-color: rgba(248, 113, 113, 0.35); }
	.vistas { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0; align-items: center; }
	.vistas button { padding: 5px 12px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); border-radius: 20px; cursor: pointer; font-size: 0.82rem; }
	.vistas button.activo { background: var(--accent); color: #fff; border-color: var(--accent); }
	.vistas select { padding: 5px 8px; }
	.leyenda { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; font-size: 0.8rem; color: var(--text-dim); margin: 6px 0; }
	.leg { display: inline-flex; align-items: center; gap: 5px; }
	.sw { width: 16px; height: 3px; border-radius: 2px; display: inline-block; }
	.sw-sal { background: var(--accent); }
	.sw-inf { background: #e8975b; }
	.aclara { color: var(--text-dim); }
	.chart { width: 100%; height: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
	.grid { stroke: var(--border); stroke-width: 1; }
	.ylbl { font-size: 10px; fill: var(--text-dim); text-anchor: end; }
	.xlbl { font-size: 10px; fill: var(--text-dim); text-anchor: middle; }
	.line-sal { fill: none; stroke: var(--accent); stroke-width: 2.5; }
	.line-inf { fill: none; stroke: #e8975b; stroke-width: 2.5; }
	.dot-sal { fill: var(--accent); } .dot-inf { fill: #e8975b; }
	.endlbl { font-size: 11px; font-weight: 700; }
	.endlbl.sal { fill: var(--accent); } .endlbl.inf { fill: #e8975b; }
	.nota { font-size: 0.8rem; color: var(--text-dim); margin-top: 12px; }
</style>

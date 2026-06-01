<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';

	let cargando = $state(true);
	let snaps = $state<any[]>([]);
	let modo = $state<'twr' | 'valor'>('twr');

	onMount(async () => {
		const rows = (await query(
			'SELECT fecha, valor_usd, flujo_usd, valor_ars, dolar FROM snapshot WHERE perfil_id=1 ORDER BY fecha'
		)) as any[];
		// índice TWR base 100 y retorno por período
		let idx = 100;
		let prev: number | null = null;
		snaps = rows.map((s) => {
			let r = 0;
			if (prev !== null && prev > 0) {
				r = (s.valor_usd - s.flujo_usd) / prev - 1;
				idx *= 1 + r;
			}
			prev = s.valor_usd;
			return { ...s, ret: r, idx };
		});
		cargando = false;
	});

	const usd = (n: number, d = 0) => 'U$D ' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
	const ars = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
	const pct = (n: number) => (n >= 0 ? '+' : '') + (n * 100).toFixed(1) + '%';
	const mesCorto = (f: string) => {
		const [y, m] = f.split('-');
		return ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][+m] + " '" + y.slice(2);
	};

	// Métricas
	let actual = $derived(snaps.length ? snaps[snaps.length - 1] : null);
	let twrInicio = $derived(actual ? actual.idx / 100 - 1 : 0);
	let twrMes = $derived(snaps.length > 1 ? snaps[snaps.length - 1].ret : 0);
	let flujoTotal = $derived(snaps.reduce((s, x) => s + x.flujo_usd, 0));
	let twrYTD = $derived.by(() => {
		if (!actual) return 0;
		const anioAct = actual.fecha.slice(0, 4);
		// base = índice del último snapshot del año anterior
		let base = 100;
		for (const s of snaps) {
			if (s.fecha.slice(0, 4) < anioAct) base = s.idx;
		}
		return actual.idx / base - 1;
	});

	// Gráfico SVG
	const W = 720, H = 300, P = { l: 52, r: 16, t: 16, b: 28 };
	let chart = $derived.by(() => {
		if (snaps.length < 2) return null;
		const vals = snaps.map((s) => (modo === 'twr' ? s.idx : s.valor_usd));
		const xs = snaps.map((s) => new Date(s.fecha).getTime());
		const minX = xs[0], maxX = xs[xs.length - 1];
		let minY = Math.min(...vals), maxY = Math.max(...vals);
		const padY = (maxY - minY) * 0.1 || 1;
		minY -= padY; maxY += padY;
		const px = (x: number) => P.l + ((x - minX) / (maxX - minX)) * (W - P.l - P.r);
		const py = (y: number) => H - P.b - ((y - minY) / (maxY - minY)) * (H - P.t - P.b);
		const pts = snaps.map((s, i) => ({ x: px(xs[i]), y: py(vals[i]) }));
		const line = pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
		const area = line + ` L${pts[pts.length - 1].x.toFixed(1)},${H - P.b} L${pts[0].x.toFixed(1)},${H - P.b} Z`;
		// ticks Y (4)
		const yticks = Array.from({ length: 4 }, (_, i) => {
			const v = minY + ((maxY - minY) * i) / 3;
			return { y: py(v), label: modo === 'twr' ? v.toFixed(0) : Math.round(v / 1000) + 'k' };
		});
		// ticks X (~6)
		const step = Math.max(1, Math.floor(snaps.length / 6));
		const xticks = snaps.filter((_, i) => i % step === 0).map((s) => ({ x: px(new Date(s.fecha).getTime()), label: mesCorto(s.fecha) }));
		return { line, area, pts, yticks, xticks };
	});
</script>

<h1>Evolución de cartera</h1>

{#if cargando}
	<p>Cargando…</p>
{:else if snaps.length < 2}
	<p>Necesitás al menos 2 fotos para ver evolución.</p>
{:else}
	<div class="resumen">
		<div class="card"><span>Valor actual</span><strong>{usd(actual.valor_usd)}</strong></div>
		<div class="card"><span>TWR desde inicio</span><strong class={twrInicio >= 0 ? 'pos' : 'neg'}>{pct(twrInicio)}</strong></div>
		<div class="card"><span>TWR {actual.fecha.slice(0, 4)} (YTD)</span><strong class={twrYTD >= 0 ? 'pos' : 'neg'}>{pct(twrYTD)}</strong></div>
		<div class="card"><span>TWR último período</span><strong class={twrMes >= 0 ? 'pos' : 'neg'}>{pct(twrMes)}</strong></div>
		<div class="card"><span>Aportes netos</span><strong>{usd(flujoTotal)}</strong></div>
	</div>

	<div class="toggle">
		<button class:activo={modo === 'twr'} onclick={() => (modo = 'twr')}>Rendimiento (base 100)</button>
		<button class:activo={modo === 'valor'} onclick={() => (modo = 'valor')}>Valor (USD)</button>
	</div>

	{#if chart}
		<svg viewBox="0 0 {W} {H}" class="chart">
			{#each chart.yticks as t}
				<line x1={P.l} y1={t.y} x2={W - P.r} y2={t.y} class="grid" />
				<text x={P.l - 6} y={t.y + 3} class="ylbl">{t.label}</text>
			{/each}
			{#each chart.xticks as t}
				<text x={t.x} y={H - 8} class="xlbl">{t.label}</text>
			{/each}
			<path d={chart.area} class="area" />
			<path d={chart.line} class="line" />
			{#each chart.pts as p}<circle cx={p.x} cy={p.y} r="2.5" class="dot" />{/each}
		</svg>
	{/if}

	<h2>Detalle por foto</h2>
	<table>
		<thead><tr><th>Fecha</th><th class="num">Valor USD</th><th class="num">Valor ARS</th><th class="num">Flujo USD</th><th class="num">Rend. período</th><th class="num">Índice</th></tr></thead>
		<tbody>
			{#each [...snaps].reverse() as s (s.fecha)}
				<tr>
					<td>{s.fecha}</td>
					<td class="num">{usd(s.valor_usd)}</td>
					<td class="num">{ars(s.valor_ars)}</td>
					<td class="num {s.flujo_usd >= 0 ? 'pos' : 'neg'}">{usd(s.flujo_usd)}</td>
					<td class="num {s.ret >= 0 ? 'pos' : 'neg'}">{pct(s.ret)}</td>
					<td class="num">{s.idx.toFixed(1)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
	<p class="nota">TWR (time-weighted return): rendimiento de la estrategia neutralizando aportes y retiros. Valores en USD al dólar de cada foto.</p>
{/if}

<style>
	:global(body) { font-family: system-ui, sans-serif; max-width: 820px; margin: 0 auto; padding: 16px; }
	h2 { font-size: 1.05rem; margin-top: 24px; }
	.resumen { display: flex; gap: 10px; flex-wrap: wrap; margin: 12px 0; }
	.card { border: 1px solid #ddd; border-radius: 8px; padding: 8px 14px; display: flex; flex-direction: column; min-width: 130px; }
	.card span { font-size: 0.72rem; color: #777; }
	.card strong { font-size: 1.05rem; }
	.toggle { display: flex; gap: 6px; margin: 8px 0; }
	.toggle button { padding: 5px 12px; border: 1px solid #bbb; background: #fff; border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
	.toggle button.activo { background: #1a73e8; color: #fff; border-color: #1a73e8; }
	.chart { width: 100%; height: auto; border: 1px solid #eee; border-radius: 8px; background: #fafbff; }
	.grid { stroke: #e8e8e8; stroke-width: 1; }
	.ylbl { font-size: 10px; fill: #999; text-anchor: end; }
	.xlbl { font-size: 10px; fill: #999; text-anchor: middle; }
	.area { fill: rgba(26, 115, 232, 0.08); stroke: none; }
	.line { fill: none; stroke: #1a73e8; stroke-width: 2; }
	.dot { fill: #1a73e8; }
	table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
	th, td { border: 1px solid #ddd; padding: 5px 7px; text-align: left; }
	td.num, th.num { text-align: right; }
	.pos { color: #137333; }
	.neg { color: #c5221f; }
	.nota { font-size: 0.8rem; color: #777; margin-top: 12px; }
</style>
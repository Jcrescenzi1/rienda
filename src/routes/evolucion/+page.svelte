<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import { fechaISO, hoyISO, parseNum, formatNum, soloNum } from '$lib/format';
	import { calcularFIFO, calcularFoto, guardarSnapshot } from '$lib/cartera';
	import Guia from '$lib/Guia.svelte';

	let cargando = $state(true);
	let snaps = $state<any[]>([]);
	let modo = $state<'twr' | 'valor'>('twr');
	let periodo = $state<'total' | '1a' | '6m' | '3m' | '1m' | '1s'>('total');
	const periodos: [string, string][] = [['total', 'Total'], ['1a', '1 año'], ['6m', '6 meses'], ['3m', '3 meses'], ['1m', '1 mes'], ['1s', '1 semana']];

	let showFoto = $state(false);
	let realizadoMes = $state<any[]>([]);
	let fFlujo = $state(''); let fValorUSD = $state(0); let fValorARS = $state(0); let fDolar = $state(1);
	let fFecha = $state(hoyISO());
	let fMsg = $state(''); let calculando = $state(false);

	async function cargar() {
		const rows = (await query('SELECT fecha, valor_usd, flujo_usd, valor_ars, dolar FROM snapshot WHERE perfil_id=1 ORDER BY fecha')) as any[];
		let idx = 100; let prev: number | null = null;
		snaps = rows.map((s) => {
			let r = 0;
			if (prev !== null && prev > 0) { r = (s.valor_usd - s.flujo_usd) / prev - 1; idx *= 1 + r; }
			prev = s.valor_usd;
			return { ...s, ret: r, idx };
		});
		// Ganancia realizada por mes (USD) — FIFO compartido con Inversiones
		const { realPorMes } = await calcularFIFO();
		realizadoMes = Object.keys(realPorMes).sort().reverse().map((m) => ({ mes: m, valor: realPorMes[m] }));
		cargando = false;
	}
	onMount(cargar);

	// Foto de cartera — cálculo compartido con Inversiones
	async function prepararFoto() {
		calculando = true; fMsg = '';
		try {
			const f = await calcularFoto();
			fDolar = f.dolar;
			fValorUSD = f.valorUSD;
			fValorARS = f.valorARS;
			fFlujo = formatNum(f.flujo, 2);
			showFoto = true;
		} catch (e: any) { fMsg = 'Error: ' + (e?.message ?? String(e)); }
		calculando = false;
	}

	async function guardarFoto() {
		try {
			const flujo = parseNum(fFlujo);
			await guardarSnapshot(fFecha, fValorUSD, Number.isFinite(flujo) ? flujo : 0, fDolar, fValorARS);
			showFoto = false; fMsg = ''; await cargar();
		} catch (e: any) { fMsg = 'Error: ' + (e?.message ?? String(e)); }
	}

	const usd = (n: number, d = 0) => 'U$D ' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
	const ars = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
	const pct = (n: number) => (n >= 0 ? '+' : '') + (n * 100).toFixed(1) + '%';
	const mesCorto = (f: string) => {
		const [y, m] = f.split('-');
		return ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][+m] + " '" + y.slice(2);
	};

	let actual = $derived(snaps.length ? snaps[snaps.length - 1] : null);

	// Corte por período: fecha de inicio de la ventana
	let cutoff = $derived.by(() => {
		const d = new Date();
		if (periodo === '1a') d.setFullYear(d.getFullYear() - 1);
		else if (periodo === '6m') d.setMonth(d.getMonth() - 6);
		else if (periodo === '3m') d.setMonth(d.getMonth() - 3);
		else if (periodo === '1m') d.setMonth(d.getMonth() - 1);
		else if (periodo === '1s') d.setDate(d.getDate() - 7);
		else return null;
		return fechaISO(d);
	});
	// snapshot base = el último en/antes del corte (o el primero)
	let baseSnap = $derived.by(() => {
		if (!snaps.length) return null;
		if (!cutoff) return snaps[0];
		let base = snaps[0];
		for (const s of snaps) if (s.fecha <= cutoff) base = s;
		return base;
	});
	// snaps de la ventana, con índice re-basado a 100 al inicio
	let vsnaps = $derived.by(() => {
		if (!baseSnap) return [];
		return snaps.filter((s) => s.fecha >= baseSnap.fecha).map((s) => ({ ...s, cidx: (s.idx / baseSnap.idx) * 100 }));
	});
	let twrVentana = $derived(vsnaps.length ? vsnaps[vsnaps.length - 1].cidx / 100 - 1 : 0);
	let flujoVentana = $derived(vsnaps.slice(1).reduce((s, x) => s + x.flujo_usd, 0));

	const W = 720, H = 300, P = { l: 52, r: 16, t: 16, b: 28 };
	let chart = $derived.by(() => {
		if (vsnaps.length < 2) return null;
		const vals = vsnaps.map((s) => (modo === 'twr' ? s.cidx : s.valor_usd));
		const xs = vsnaps.map((s) => new Date(s.fecha).getTime());
		const minX = xs[0], maxX = xs[xs.length - 1];
		let minY = Math.min(...vals), maxY = Math.max(...vals);
		const padY = (maxY - minY) * 0.1 || 1; minY -= padY; maxY += padY;
		const px = (x: number) => P.l + ((x - minX) / (maxX - minX || 1)) * (W - P.l - P.r);
		const py = (y: number) => H - P.b - ((y - minY) / (maxY - minY || 1)) * (H - P.t - P.b);
		const pts = vsnaps.map((s, i) => ({ x: px(xs[i]), y: py(vals[i]) }));
		const line = pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
		const area = line + ` L${pts[pts.length - 1].x.toFixed(1)},${H - P.b} L${pts[0].x.toFixed(1)},${H - P.b} Z`;
		const yticks = Array.from({ length: 4 }, (_, i) => {
			const v = minY + ((maxY - minY) * i) / 3;
			return { y: py(v), label: modo === 'twr' ? v.toFixed(0) : Math.round(v / 1000) + 'k' };
		});
		const step = Math.max(1, Math.floor(vsnaps.length / 6));
		const xticks = vsnaps.filter((_, i) => i % step === 0).map((s) => ({ x: px(new Date(s.fecha).getTime()), label: mesCorto(s.fecha) }));
		return { line, area, pts, yticks, xticks };
	});
</script>

<div class="titulo-guia">
	<h1>Evolución de cartera</h1>
	<Guia clave="evolucion" texto="La historia de tu cartera, foto a foto. El TWR mide el rendimiento de tu estrategia sin que aportes o retiros lo distorsionen. Sacá una foto por mes para que la curva diga algo." />
</div>

<button class="foto" onclick={prepararFoto} disabled={calculando}>{calculando ? 'Calculando…' : '📸 Guardar foto'}</button>

{#if showFoto}
	<div class="fotoform">
		<h3>Nueva foto — {fFecha}</h3>
		<label>Fecha<input type="date" bind:value={fFecha} /></label>
		<p class="calc">Valor calculado: <strong>{usd(fValorUSD)}</strong> ({ars(fValorARS)} · dólar {fDolar})</p>
		<label>Flujo neto desde la última foto (USD)<input type="text" inputmode="decimal" use:soloNum bind:value={fFlujo} /></label>
		<p class="hint">Calculado de tus Ingresos/Retiros. Editalo si hace falta.</p>
		<div class="botones"><button class="guardar" onclick={guardarFoto}>Guardar foto</button><button class="cancelar" onclick={() => (showFoto = false)}>Cancelar</button></div>
		{#if fMsg}<p class="msg">{fMsg}</p>{/if}
	</div>
{/if}

{#if cargando}
	<p>Cargando…</p>
{:else if snaps.length < 2}
	<p>Necesitás al menos 2 fotos para ver evolución.</p>
{:else}
	<div class="periodos">
		{#each periodos as [k, lbl]}
			<button class:activo={periodo === k} onclick={() => (periodo = k as any)}>{lbl}</button>
		{/each}
	</div>

	<div class="resumen">
		<div class="card big"><span>TWR del período</span><strong class={twrVentana >= 0 ? 'pos' : 'neg'}>{pct(twrVentana)}</strong></div>
		<div class="card"><span>Valor actual</span><strong>{usd(actual.valor_usd)}</strong></div>
		<div class="card"><span>Aportes netos (período)</span><strong>{usd(flujoVentana)}</strong></div>
		<div class="card"><span>Desde</span><strong>{baseSnap.fecha}</strong></div>
	</div>

	<div class="toggle">
		<button class:activo={modo === 'twr'} onclick={() => (modo = 'twr')}>Rendimiento (base 100)</button>
		<button class:activo={modo === 'valor'} onclick={() => (modo = 'valor')}>Valor (USD)</button>
	</div>

	{#if chart}
		<svg viewBox="0 0 {W} {H}" class="chart">
			{#each chart.yticks as t}<line x1={P.l} y1={t.y} x2={W - P.r} y2={t.y} class="grid" /><text x={P.l - 6} y={t.y + 3} class="ylbl">{t.label}</text>{/each}
			{#each chart.xticks as t}<text x={t.x} y={H - 8} class="xlbl">{t.label}</text>{/each}
			<path d={chart.area} class="area" /><path d={chart.line} class="line" />
			{#each chart.pts as p}<circle cx={p.x} cy={p.y} r="2.5" class="dot" />{/each}
		</svg>
	{:else}
		<p class="nota">No hay suficientes fotos en este período para graficar.</p>
	{/if}

	<h2>Ganancia realizada por mes (USD)</h2>
	{#if realizadoMes.length}
		<table class="chica">
			<thead><tr><th>Mes</th><th class="num">Realizado</th></tr></thead>
			<tbody>
				{#each realizadoMes as r (r.mes)}
					<tr><td>{r.mes}</td><td class="num {r.valor >= 0 ? 'pos' : 'neg'}">{usd(r.valor, 2)}</td></tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<p class="nota">Todavía no hay ventas registradas.</p>
	{/if}

	<p class="nota">TWR: rendimiento de la estrategia neutralizando aportes y retiros. El gráfico y el TWR de arriba se ajustan al período elegido (re-basado a 100 al inicio de la ventana).</p>
{/if}

<style>
:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	h2 { font-size: 1.05rem; margin-top: 24px; }
	h3 { margin: 0 0 4px; font-size: 1rem; }
	.foto { background: var(--pos); color: #06281a; font-weight: 600; border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer; font-size: 0.95rem; margin-bottom: 10px; }
	.foto:disabled { opacity: 0.6; }
	.fotoform { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 14px; margin-bottom: 14px; display: flex; flex-direction: column; gap: 9px; max-width: 420px; }
	.calc { margin: 0; font-size: 0.9rem; }
	label { display: flex; flex-direction: column; font-size: 0.82rem; color: var(--text-dim); gap: 3px; }
	input { padding: 6px; font-size: 0.95rem; }
	.hint { font-size: 0.78rem; color: var(--text-dim); margin: 0; }
	.botones { display: flex; gap: 8px; }
	.guardar { padding: 8px 14px; background: var(--pos); color: #06281a; font-weight: 600; border: none; border-radius: 6px; cursor: pointer; }
	.cancelar { padding: 8px 14px; background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
	.msg { font-weight: 600; margin: 0; }
	.periodos { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0 12px; }
	.periodos button { padding: 5px 12px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); border-radius: 20px; cursor: pointer; font-size: 0.82rem; }
	.periodos button.activo { background: var(--accent); color: #fff; border-color: var(--accent); }
	.resumen { display: flex; gap: 10px; flex-wrap: wrap; margin: 12px 0; }
	.card { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 8px 14px; display: flex; flex-direction: column; min-width: 130px; }
	.card.big strong { font-size: 1.5rem; }
	.card span { font-size: 0.72rem; color: var(--text-dim); }
	.card strong { font-size: 1.05rem; }
	.toggle { display: flex; gap: 6px; margin: 8px 0; }
	.toggle button { padding: 5px 12px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
	.toggle button.activo { background: var(--accent); color: #fff; border-color: var(--accent); }
	.chart { width: 100%; height: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
	.grid { stroke: var(--border); stroke-width: 1; }
	.ylbl { font-size: 10px; fill: var(--text-dim); text-anchor: end; }
	.xlbl { font-size: 10px; fill: var(--text-dim); text-anchor: middle; }
	.area { fill: rgba(91, 157, 255, 0.10); stroke: none; }
	.line { fill: none; stroke: var(--accent); stroke-width: 2; }
	.dot { fill: var(--accent); }
	table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
	th, td { padding: 5px 7px; text-align: left; }
	td.num, th.num { text-align: right; }
	table.chica { width: auto; min-width: 240px; }
	.nota { font-size: 0.8rem; color: var(--text-dim); margin-top: 12px; }
</style>
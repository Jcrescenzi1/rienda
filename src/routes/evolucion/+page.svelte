<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import { fechaISO, pesos, mesCorto, fmtFecha } from '$lib/format';
	import { calcularFIFO } from '$lib/cartera';
	import Guia from '$lib/Guia.svelte';
	import Skeleton from '$lib/Skeleton.svelte';
	import CountUp from '$lib/CountUp.svelte';
	import { progresoReplay } from '$lib/anim';

	let cargando = $state(true);
	let snaps = $state<any[]>([]);
	let periodo = $state<'total' | '1a' | '6m' | '3m' | '1m' | '1s'>('total');
	const periodos: [string, string][] = [['total', 'Total'], ['1a', '1 año'], ['6m', '6 meses'], ['3m', '3 meses'], ['1m', '1 mes'], ['1s', '1 semana']];

	let realizadoMes = $state<any[]>([]);

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

	// Alias locales al helper único de format.ts (ver Brief H / A1).
	const usd = (n: number, d = 0) => pesos(n, 'USD', d);
	const pct = (n: number) => (n >= 0 ? '+' : '') + (n * 100).toFixed(1) + '%';
	// mesCorto viene de $lib/format (helper único, Brief H / A2).

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

	// Selección por tap/drag sobre el gráfico: mientras se mantiene el toque, las
	// tarjetas muestran el valor del punto tocado; al soltar, vuelven al último
	// valor del período. `tocando` distingue "presionado" de "índice ya resuelto"
	// para que pointermove solo reaccione mientras el dedo/mouse está abajo.
	let tocando = $state(false);
	let puntoTacto = $state<number | null>(null);
	let snapTacto = $derived(puntoTacto != null ? vsnaps[puntoTacto] : null);
	let valorMostrado = $derived(snapTacto ? snapTacto.valor_usd : actual?.valor_usd ?? 0);
	let twrMostrado = $derived(snapTacto ? snapTacto.cidx / 100 - 1 : twrVentana);
	let aportesMostrado = $derived(
		snapTacto && puntoTacto != null ? vsnaps.slice(1, puntoTacto + 1).reduce((s, x) => s + x.flujo_usd, 0) : flujoVentana
	);

	function indiceMasCercano(xViewBox: number): number | null {
		if (!chart) return null;
		let best = 0, bestD = Infinity;
		chart.ptsValor.forEach((p, i) => { const d = Math.abs(p.x - xViewBox); if (d < bestD) { bestD = d; best = i; } });
		return best;
	}
	function actualizarTacto(e: PointerEvent) {
		const svg = e.currentTarget as SVGSVGElement;
		const rect = svg.getBoundingClientRect();
		const x = ((e.clientX - rect.left) / rect.width) * W;
		puntoTacto = indiceMasCercano(x);
	}
	function iniciarTacto(e: PointerEvent) {
		tocando = true;
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		actualizarTacto(e);
	}
	function moverTacto(e: PointerEvent) {
		if (!tocando) return;
		actualizarTacto(e);
	}
	function soltarTacto() {
		tocando = false;
		puntoTacto = null;
	}

	// Gráfico de doble eje: Valor de cartera USD (eje izq.) + TWR base 100 (eje der.).
	// Escalas independientes — un cruce visual entre las curvas no significa nada.
	const W = 720, H = 300, P = { l: 52, r: 56, t: 16, b: 28 };
	let chart = $derived.by(() => {
		if (vsnaps.length < 2) return null;
		const n = vsnaps.length;
		const xs = vsnaps.map((s) => new Date(s.fecha).getTime());
		const minX = xs[0], maxX = xs[xs.length - 1];
		const px = (x: number) => P.l + ((x - minX) / (maxX - minX || 1)) * (W - P.l - P.r);

		const vVal = vsnaps.map((s) => s.valor_usd);
		let minL = Math.min(...vVal), maxL = Math.max(...vVal);
		const padL = (maxL - minL) * 0.1 || 1; minL -= padL; maxL += padL;
		const pyL = (y: number) => H - P.b - ((y - minL) / (maxL - minL || 1)) * (H - P.t - P.b);

		const vTwr = vsnaps.map((s) => s.cidx);
		let minR = Math.min(...vTwr), maxR = Math.max(...vTwr);
		const padR = (maxR - minR) * 0.1 || 1; minR -= padR; maxR += padR;
		const pyR = (y: number) => H - P.b - ((y - minR) / (maxR - minR || 1)) * (H - P.t - P.b);

		const ptsValor = vsnaps.map((s, i) => ({ x: px(xs[i]), y: pyL(s.valor_usd) }));
		const ptsTwr = vsnaps.map((s, i) => ({ x: px(xs[i]), y: pyR(s.cidx) }));
		const lineaValor = ptsValor.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
		const lineaTwr = ptsTwr.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
		const areaValor = lineaValor + ` L${ptsValor[n - 1].x.toFixed(1)},${H - P.b} L${ptsValor[0].x.toFixed(1)},${H - P.b} Z`;

		const yticksL = Array.from({ length: 4 }, (_, i) => {
			const v = minL + ((maxL - minL) * i) / 3;
			return { y: pyL(v), label: Math.round(v).toLocaleString('es-AR') };
		});
		const yticksR = Array.from({ length: 4 }, (_, i) => {
			const v = minR + ((maxR - minR) * i) / 3;
			return { y: pyR(v), label: pct(v / 100 - 1) };
		});
		const step = Math.max(1, Math.floor(n / 6));
		const xticks = vsnaps.filter((_, i) => i % step === 0).map((s) => ({ x: px(new Date(s.fecha).getTime()), label: mesCorto(s.fecha) }));
		return { lineaValor, lineaTwr, areaValor, ptsValor, ptsTwr, yticksL, yticksR, xticks };
	});

	// Reveal de izquierda a derecha al montar y en cada cambio de período.
	let sigChart = $derived(chart ? chart.ptsValor.map((p) => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ') : '');
	const { p: pArea, replay: replayArea } = progresoReplay();
	$effect(() => { sigChart; replayArea(); });

	// Ganancia realizada agrupada por año, con detalle mensual desplegable in-place
	// (mismo patrón tap-expande que usa Categorías con sus subcategorías).
	let realizadoPorAnio = $derived.by(() => {
		const porAnio = new Map<string, { total: number; meses: { mes: string; valor: number }[] }>();
		for (const r of realizadoMes) {
			const anio = r.mes.slice(0, 4);
			let a = porAnio.get(anio);
			if (!a) { a = { total: 0, meses: [] }; porAnio.set(anio, a); }
			a.total += r.valor;
			a.meses.push(r);
		}
		return [...porAnio.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([anio, d]) => ({ anio, total: d.total, meses: d.meses }));
	});
	let anioExpandido = $state<string | null>(null);
</script>

<div class="titulo-guia">
	<h1>Evolución de cartera</h1>
	<Guia clave="evolucion" texto="La historia de tu cartera, foto a foto. El TWR mide el rendimiento de tu estrategia sin que aportes o retiros lo distorsionen. Sacá una foto por mes desde Tenencia para que la curva diga algo." />
</div>

<h2>Valor y rendimiento (TWR)</h2>

{#if cargando}
	<div class="resumen">
		<div class="card sk-card"><Skeleton w="68%" h="0.62rem" /><Skeleton w="80%" h="1.1rem" /></div>
		<div class="card sk-card"><Skeleton w="68%" h="0.62rem" /><Skeleton w="80%" h="1.1rem" /></div>
		<div class="card sk-card"><Skeleton w="68%" h="0.62rem" /><Skeleton w="80%" h="1.1rem" /></div>
	</div>
	<div class="sk-chart"><Skeleton w="100%" h="clamp(150px, 42vw, 300px)" /></div>
{:else if snaps.length < 2}
	<p>Necesitás al menos 2 fotos para ver evolución.</p>
{:else}
	<div class="resumen">
		<div class="card destacado"><span>Cartera total{snapTacto ? ` · ${fmtFecha(snapTacto.fecha)}` : ''}</span><strong><CountUp value={valorMostrado} format={usd} /></strong></div>
		<div class="card"><span>Aportes netos{snapTacto ? ` · hasta ${fmtFecha(snapTacto.fecha)}` : ' (período)'}</span><strong><CountUp value={aportesMostrado} format={usd} /></strong></div>
		<div class="card big destacado"><span>TWR{snapTacto ? ` · ${fmtFecha(snapTacto.fecha)}` : ' del período'}</span><strong class={twrMostrado >= 0 ? 'pos' : 'neg'}><CountUp value={twrMostrado} format={pct} /></strong></div>
	</div>

	<div class="periodos">
		{#each periodos as [k, lbl]}
			<button class:activo={periodo === k} onclick={() => (periodo = k as any)}>{lbl}</button>
		{/each}
	</div>

	{#if chart}
		<div class="leyenda">
			<span class="leg"><span class="sw sw-valor"></span> Valor de cartera (USD, eje izq.)</span>
			<span class="leg"><span class="sw sw-twr"></span> TWR (%, eje der.)</span>
		</div>
		<svg viewBox="0 0 {W} {H}" class="chart tacto"
			onpointerdown={iniciarTacto} onpointermove={moverTacto} onpointerup={soltarTacto} onpointercancel={soltarTacto}>
			<defs><clipPath id="reveal-cartera"><rect x="0" y="0" width={W * $pArea} height={H} /></clipPath></defs>
			{#each chart.yticksL as t}<line x1={P.l} y1={t.y} x2={W - P.r} y2={t.y} class="grid" /><text x={P.l - 6} y={t.y + 3} class="ylbl">{t.label}</text>{/each}
			{#each chart.yticksR as t}<text x={W - P.r + 6} y={t.y + 3} class="ylbl-r">{t.label}</text>{/each}
			{#each chart.xticks as t}<text x={t.x} y={H - 8} class="xlbl">{t.label}</text>{/each}
			<g clip-path="url(#reveal-cartera)">
				<path d={chart.areaValor} class="area" />
				<path d={chart.lineaValor} class="line" />
				<path d={chart.lineaTwr} class="line-twr" />
				{#each chart.ptsValor as p}<circle cx={p.x} cy={p.y} r="2.5" class="dot" />{/each}
				{#each chart.ptsTwr as p}<circle cx={p.x} cy={p.y} r="2" class="dot-twr" />{/each}
			</g>
			{#if puntoTacto != null}
				<line x1={chart.ptsValor[puntoTacto].x} y1={P.t} x2={chart.ptsValor[puntoTacto].x} y2={H - P.b} class="guia-tacto" />
				<circle cx={chart.ptsValor[puntoTacto].x} cy={chart.ptsValor[puntoTacto].y} r="5" class="dot-tacto" />
				<circle cx={chart.ptsTwr[puntoTacto].x} cy={chart.ptsTwr[puntoTacto].y} r="4.5" class="dot-tacto-twr" />
			{/if}
		</svg>
		<details class="nota-colapsable">
			<summary>Descripción de la visual: Valor de cartera y TWR</summary>
			<p class="nota">
				<strong>Valor de cartera:</strong> valuación de tu cartera en el período correspondiente — incluyendo ingreso/retiro de liquidez.<br />
				<strong>TWR (Time-Weighted Return):</strong> crecimiento de tu cartera de valores — no afectado por ingreso/retiro de liquidez.
			</p>
		</details>
	{:else}
		<p class="nota">Sin datos suficientes en este rango.</p>
	{/if}

	<h2>Ganancia realizada por año (USD)</h2>
	{#if realizadoPorAnio.length}
		<div class="real-lista">
			{#each realizadoPorAnio as a (a.anio)}
				<button type="button" class="real-row real-click" class:abierto={anioExpandido === a.anio}
						aria-expanded={anioExpandido === a.anio}
						onclick={() => (anioExpandido = anioExpandido === a.anio ? null : a.anio)}>
					<span class="real-lbl"><span class="real-caret">{anioExpandido === a.anio ? '▾' : '▸'}</span>{a.anio}</span>
					<span class="real-valor {a.total >= 0 ? 'pos' : 'neg'}">{usd(a.total, 2)}</span>
				</button>
				{#if anioExpandido === a.anio}
					<div class="real-desglose">
						{#each a.meses as r (r.mes)}
							<div class="real-row sub">
								<span class="real-lbl">{r.mes}</span>
								<span class="real-valor {r.valor >= 0 ? 'pos' : 'neg'}">{usd(r.valor, 2)}</span>
							</div>
						{/each}
					</div>
				{/if}
			{/each}
		</div>
	{:else}
		<p class="nota">Todavía no hay ventas registradas.</p>
	{/if}

	<details class="nota-colapsable">
		<summary>Descripción de la visual: Ganancia realizada</summary>
		<p class="nota">"Realizada" es la ganancia o pérdida que quedó fija al vender un activo (método FIFO) — no incluye la valorización de lo que todavía tenés en cartera y no vendiste (esa es ganancia no realizada, en papel, y ya está reflejada en el Valor de cartera de arriba).</p>
	</details>
{/if}

<style>
:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	h2 { font-size: 1.02rem; margin-top: 26px; border-left: 3px solid var(--accent); padding-left: 12px; }
	.periodos { display: flex; gap: 6px; flex-wrap: wrap; margin: 12px 0 4px; }
	.sk-chart { margin-top: 12px; }
	.leyenda { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; font-size: 0.8rem; color: var(--text-dim); margin: 6px 0; }
	.leg { display: inline-flex; align-items: center; gap: 5px; }
	/* Texto descriptivo de la visual, colapsado por defecto (mismo patrón que /inversiones) */
	.nota-colapsable { margin: 6px 0 12px; }
	.nota-colapsable summary { cursor: pointer; font-size: 0.82rem; color: var(--text-dim); }
	.nota-colapsable .nota { margin-top: 6px; }
	.sw { width: 16px; height: 3px; border-radius: 2px; display: inline-block; flex-shrink: 0; }
	.sw-valor { background: var(--accent); }
	.sw-twr { background: #e8975b; }
	.chart { width: 100%; height: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
	.chart.tacto { touch-action: none; cursor: crosshair; }
	.grid { stroke: var(--border); stroke-width: 1; }
	.ylbl { font-size: 10px; fill: var(--text-dim); text-anchor: end; }
	.ylbl-r { font-size: 10px; fill: var(--text-dim); text-anchor: start; }
	.xlbl { font-size: 10px; fill: var(--text-dim); text-anchor: middle; }
	.area { fill: rgba(91, 157, 255, 0.10); stroke: none; }
	.line { fill: none; stroke: var(--accent); stroke-width: 2; }
	.line-twr { fill: none; stroke: #e8975b; stroke-width: 2; stroke-dasharray: 5 3; }
	.dot { fill: var(--accent); }
	.dot-twr { fill: #e8975b; }
	.guia-tacto { stroke: var(--text-dim); stroke-width: 1; stroke-dasharray: 3 2; pointer-events: none; }
	.dot-tacto { fill: var(--accent); stroke: var(--surface); stroke-width: 2; pointer-events: none; }
	.dot-tacto-twr { fill: #e8975b; stroke: var(--surface); stroke-width: 2; pointer-events: none; }
	.real-lista { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
	.real-row { display: flex; justify-content: space-between; align-items: center; padding: 7px 4px; }
	.real-click { background: none; border: none; width: 100%; text-align: left; cursor: pointer; font: inherit; color: inherit; border-radius: 6px; }
	.real-click:hover .real-lbl { color: var(--accent); }
	.real-caret { color: var(--text-dim); font-size: 0.7rem; margin-right: 6px; display: inline-block; width: 10px; }
	.real-lbl { font-size: 0.88rem; font-weight: 600; }
	.real-valor { font-size: 0.88rem; font-weight: 600; }
	.real-desglose { padding-left: 16px; border-left: 2px solid var(--border); margin: -2px 0 4px; display: flex; flex-direction: column; }
	.real-row.sub .real-lbl { font-weight: 400; color: var(--text-dim); font-size: 0.82rem; }
	.real-row.sub .real-valor { font-weight: 400; font-size: 0.82rem; }
	.nota { font-size: 0.8rem; color: var(--text-dim); margin-top: 12px; }
</style>
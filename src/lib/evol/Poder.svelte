<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import { dolarDeFecha } from '$lib/moneda';
	import Guia from '$lib/Guia.svelte';
	import NotaVisual from '$lib/NotaVisual.svelte';
	import Skeleton from '$lib/Skeleton.svelte';
	import { progresoReplay } from '$lib/anim';
	import { mesCorto } from '$lib/format';
	import type { Snippet } from 'svelte';

	// Ver Gastos.svelte: `nav` se renderiza debajo del título (Brief H / B5).
	let { nav }: { nav?: Snippet } = $props();

	// Ingreso Primario regular (internamente tipo='Sueldo', categoría 'Ingreso Principal')
	// analizado contra inflación y contra el dólar bolsa. Estos dos análisis tienen
	// marco fijo (base 100 vs IPC; USD + ARS doble eje), por eso no llevan el toggle
	// de moneda de las demás visuales.
	let sueldos = $state<Record<string, number>>({});
	let sueldoFecha = $state<Record<string, string>>({}); // fecha representativa del sueldo por período (para el dólar del día)
	let infl = $state<Record<string, number>>({});
	let dolarSerie = $state<{ fecha: string; valor: number }[]>([]);
	let periodosTodos = $state<string[]>([]);

	let vista = $state<'historico' | 'ult12' | 'anio'>('ult12');
	let anio = $state('');
	let anios = $state<string[]>([]);
	let cargando = $state(true);

	onMount(async () => {
		const [s, inf, dolDia] = (await Promise.all([
			query("SELECT periodo, SUM(monto) AS m, MIN(fecha) AS fecha FROM ingreso WHERE perfil_id=1 AND tipo='Sueldo' AND categoria='Ingreso Principal' AND periodo IS NOT NULL GROUP BY periodo"),
			query('SELECT periodo, valor FROM inflacion WHERE perfil_id=1'),
			query("SELECT fecha, valor FROM cotizacion_dolar WHERE perfil_id=1 AND casa='bolsa' ORDER BY fecha")
		])) as any[];
		for (const x of s) { sueldos[x.periodo] = x.m; sueldoFecha[x.periodo] = x.fecha; }
		for (const x of inf) infl[x.periodo] = x.valor;
		dolarSerie = dolDia.map((d: any) => ({ fecha: d.fecha, valor: d.valor }));
		periodosTodos = Object.keys(sueldos).sort();
		anios = [...new Set(periodosTodos.map((p) => p.slice(0, 4)))].sort();
		anio = anios[anios.length - 1] ?? '';
		cargando = false;
	});

	let periodos = $derived.by(() => {
		if (vista === 'historico') return periodosTodos;
		if (vista === 'anio') return periodosTodos.filter((p) => p.startsWith(anio));
		return periodosTodos.slice(-12);
	});

	// Serie base 100: ingreso primario (var nominal acum) e inflación (acum hasta mes anterior)
	let serie = $derived.by(() => {
		const ps = periodos;
		if (ps.length === 0) return [];
		const base = sueldos[ps[0]];
		let idxInfl = 1;
		return ps.map((p, i) => {
			if (i > 0) idxInfl *= 1 + (infl[ps[i - 1]] ?? 0);
			return {
				periodo: p,
				ingreso: (sueldos[p] / base) * 100,
				inflacion: idxInfl * 100
			};
		});
	});

	let ultimo = $derived(serie.length ? serie[serie.length - 1] : null);
	let brechaActual = $derived(ultimo ? ultimo.ingreso / ultimo.inflacion - 1 : 0);

	let resumen = $derived.by(() => {
		if (!serie.length) return { inflAcum: 0, varNominal: 0, gano: true, desde: '', hasta: '' };
		const u = serie[serie.length - 1];
		return {
			inflAcum: u.inflacion / 100 - 1,
			varNominal: u.ingreso / 100 - 1,
			gano: u.ingreso >= u.inflacion,
			desde: serie[0].periodo,
			hasta: u.periodo
		};
	});

	const W = 720, H = 320, P = { l: 44, r: 70, t: 16, b: 28 };

	// ===== Gráfico vs Inflación (base 100) =====
	let chart = $derived.by(() => {
		if (serie.length < 2) return null;
		const allV = serie.flatMap((s) => [s.ingreso, s.inflacion]);
		let minY = Math.min(...allV), maxY = Math.max(...allV);
		const padY = (maxY - minY) * 0.08 || 1; minY -= padY; maxY += padY;
		const n = serie.length;
		const px = (i: number) => P.l + (i / (n - 1)) * (W - P.l - P.r);
		const py = (y: number) => H - P.b - ((y - minY) / (maxY - minY)) * (H - P.t - P.b);
		const linea = (key: 'ingreso' | 'inflacion') =>
			serie.map((s, i) => (i ? 'L' : 'M') + px(i).toFixed(1) + ',' + py(s[key]).toFixed(1)).join(' ');
		const yticks = Array.from({ length: 4 }, (_, k) => {
			const v = minY + ((maxY - minY) * k) / 3;
			return { y: py(v), label: v.toFixed(0) };
		});
		const step = Math.max(1, Math.floor(n / 8));
		const xticks = serie.map((s, i) => ({ i, p: s.periodo })).filter((_, i) => i % step === 0)
			.map((o) => ({ x: px(o.i), label: mesCorto(o.p) }));
		return {
			ingreso: linea('ingreso'), inflacion: linea('inflacion'), yticks, xticks,
			ptsS: serie.map((s, i) => ({ x: px(i), y: py(s.ingreso) })),
			ptsI: serie.map((s, i) => ({ x: px(i), y: py(s.inflacion) })),
			finS: { x: px(n - 1), y: py(serie[n - 1].ingreso) },
			finI: { x: px(n - 1), y: py(serie[n - 1].inflacion) }
		};
	});

	// ===== Gráfico vs Dólar (doble eje) =====
	let serieIngresoUSD = $derived.by(() => {
		return periodos.map((p) => {
			// Dólar de la fecha real del sueldo de ese período (sirve en modo sueldo y calendario).
			const f = sueldoFecha[p];
			const dolarP = f ? dolarDeFecha(dolarSerie, f) : null;
			const ingresoUSD = (sueldos[p] != null && dolarP) ? sueldos[p] / dolarP : null;
			return { periodo: p, ingresoUSD, dolar: dolarP };
		}).filter((x) => x.ingresoUSD != null && x.dolar != null);
	});

	let chartUSD = $derived.by(() => {
		const s = serieIngresoUSD;
		if (s.length < 2) return null;
		const n = s.length;
		const px = (i: number) => P.l + (i / (n - 1)) * (W - P.l - P.r);

		const vIng = s.map((d) => d.ingresoUSD as number);
		let minL = Math.min(...vIng), maxL = Math.max(...vIng);
		const padL = (maxL - minL) * 0.1 || 1; minL -= padL; maxL += padL;
		const pyL = (y: number) => H - P.b - ((y - minL) / (maxL - minL)) * (H - P.t - P.b);

		const vDolar = s.map((d) => d.dolar as number);
		let minR = Math.min(...vDolar), maxR = Math.max(...vDolar);
		const padR = (maxR - minR) * 0.1 || 1; minR -= padR; maxR += padR;
		const pyR = (y: number) => H - P.b - ((y - minR) / (maxR - minR)) * (H - P.t - P.b);

		const lineaIngreso = s.map((d, i) => (i ? 'L' : 'M') + px(i).toFixed(1) + ',' + pyL(d.ingresoUSD as number).toFixed(1)).join(' ');
		const lineaDolar = s.map((d, i) => (i ? 'L' : 'M') + px(i).toFixed(1) + ',' + pyR(d.dolar as number).toFixed(1)).join(' ');

		const yticksL = Array.from({ length: 4 }, (_, k) => {
			const v = minL + ((maxL - minL) * k) / 3;
			return { y: pyL(v), label: Math.round(v) };
		});
		const yticksR = Array.from({ length: 4 }, (_, k) => {
			const v = minR + ((maxR - minR) * k) / 3;
			return { y: pyR(v), label: Math.round(v) };
		});
		const step = Math.max(1, Math.floor(n / 8));
		const xticks = s.map((d, i) => ({ i, p: d.periodo })).filter((_, i) => i % step === 0)
			.map((o) => ({ x: px(o.i), label: mesCorto(o.p) }));

		return {
			lineaIngreso, lineaDolar, yticksL, yticksR, xticks,
			ptsS: s.map((d, i) => ({ x: px(i), y: pyL(d.ingresoUSD as number) })),
			ptsD: s.map((d, i) => ({ x: px(i), y: pyR(d.dolar as number) }))
		};
	});

	// Reveal izquierda→derecha de los dos gráficos al montar y en cada cambio de ventana.
	let sigPoder = $derived(chart ? chart.ptsS.map((p) => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ') : '');
	const { p: pA1, replay: replayA1 } = progresoReplay();
	$effect(() => { sigPoder; replayA1(); });
	let sigPoderUSD = $derived(chartUSD ? chartUSD.ptsS.map((p) => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ') : '');
	const { p: pA2, replay: replayA2 } = progresoReplay();
	$effect(() => { sigPoderUSD; replayA2(); });

	const pct = (n: number, dec = 1) => (n >= 0 ? '+' : '') + (n * 100).toFixed(dec) + '%';
</script>

<div class="titulo-guia">
	<h1>Poder adquisitivo</h1>
	<Guia
		clave="ingreso-primario"
		para="Saber si tu sueldo le gana a los precios y al dólar."
		uso="Elegí la ventana arriba: todo se compara contra el inicio de esa ventana, así que cambiarla cambia la brecha que ves."
	/>
</div>
{@render nav?.()}


{#if cargando}
	<div class="sk-vistas">
		<Skeleton w="92px" h="30px" radius="6px" />
		<Skeleton w="122px" h="30px" radius="6px" />
		<Skeleton w="112px" h="30px" radius="6px" />
	</div>
	<div class="resumen">
		<div class="card sk-card"><Skeleton w="72%" h="0.62rem" /><Skeleton w="88%" h="1.05rem" /></div>
		<div class="card sk-card"><Skeleton w="72%" h="0.62rem" /><Skeleton w="88%" h="1.05rem" /></div>
		<div class="card sk-card"><Skeleton w="72%" h="0.62rem" /><Skeleton w="88%" h="1.05rem" /></div>
	</div>
	<div class="sk-chart"><Skeleton w="100%" h="clamp(150px, 42vw, 300px)" /></div>
{:else}
	<div class="vistas">
		<button class:activo={vista === 'historico'} onclick={() => (vista = 'historico')}>Histórico</button>
		<button class:activo={vista === 'ult12'} onclick={() => (vista = 'ult12')}>Últimos 12 meses</button>
		<button class:activo={vista === 'anio'} onclick={() => (vista = 'anio')}>Año calendario</button>
		{#if vista === 'anio'}
			<select bind:value={anio}>{#each anios as y (y)}<option value={y}>{y}</option>{/each}</select>
		{/if}
	</div>

	<h2>Ingreso Primario regular vs Inflación</h2>
	<div class="resumen">
		<div class="card"><span>Inflación acum. {mesCorto(resumen.desde)}→{mesCorto(resumen.hasta)}</span><strong>{pct(resumen.inflAcum)}</strong></div>
		<div class="card"><span>Variación nominal ingreso</span><strong>{pct(resumen.varNominal)}</strong></div>
		<div class="card" class:ok={resumen.gano} class:bad={!resumen.gano}>
			<span>Poder adquisitivo vs base</span><strong>{pct(brechaActual)}</strong>
		</div>
	</div>
	<div class="leyenda">
		<span class="leg"><span class="sw sw-ing"></span> Ingreso Primario</span>
		<span class="leg"><span class="sw sw-inf"></span> Inflación</span>
	</div>
	{#if chart}
		<svg viewBox="0 0 {W} {H}" class="chart">
			<defs><clipPath id="reveal-poder1"><rect x="0" y="0" width={W * $pA1} height={H} /></clipPath></defs>
			{#each chart.yticks as t}
				<line x1={P.l} y1={t.y} x2={W - P.r} y2={t.y} class="grid" />
				<text x={P.l - 6} y={t.y + 3} class="ylbl">{t.label}</text>
			{/each}
			{#each chart.xticks as t}<text x={t.x} y={H - 8} class="xlbl">{t.label}</text>{/each}
			<g clip-path="url(#reveal-poder1)">
				<path d={chart.inflacion} class="line-inf" />
				<path d={chart.ingreso} class="line-ing" />
				{#each chart.ptsI as p}<circle cx={p.x} cy={p.y} r="2" class="dot-inf" />{/each}
				{#each chart.ptsS as p}<circle cx={p.x} cy={p.y} r="2" class="dot-ing" />{/each}
				<text x={chart.finS.x + 5} y={chart.finS.y + 3} class="endlbl ing">{serie[serie.length-1].ingreso.toFixed(0)}</text>
				<text x={chart.finI.x + 5} y={chart.finI.y + 3} class="endlbl inf">{serie[serie.length-1].inflacion.toFixed(0)}</text>
			</g>
		</svg>
		<NotaVisual objetivo="Si tu sueldo le gana a los precios">
			{#snippet muestra()}Tu ingreso principal regular y la inflación, las dos en <strong>base 100</strong> al inicio de la ventana.{/snippet}
			{#snippet leer()}Base 100 significa que las dos arrancan en el mismo punto, así se comparan aunque midan cosas distintas. Si el ingreso va por encima de la inflación, le estás ganando; si va por debajo, perdiste poder de compra desde el arranque de la ventana.{/snippet}
			{#snippet usar()}Saber si tus aumentos siguieron el ritmo de los precios, y desde cuándo se abrió la brecha.{/snippet}
		</NotaVisual>
	{:else}
		<p class="nota">No hay suficientes meses en esta ventana para graficar.</p>
	{/if}

	<h2>Ingreso Primario regular en USD vs Dólar</h2>
	<div class="leyenda">
		<span class="leg"><span class="sw sw-ing"></span> Ingreso Primario (USD, eje izq.)</span>
		<span class="leg"><span class="sw sw-dolar"></span> Dólar bolsa (ARS, eje der.)</span>
	</div>
	{#if chartUSD}
		<svg viewBox="0 0 {W} {H}" class="chart">
			<defs><clipPath id="reveal-poder2"><rect x="0" y="0" width={W * $pA2} height={H} /></clipPath></defs>
			{#each chartUSD.yticksL as t}
				<line x1={P.l} y1={t.y} x2={W - P.r} y2={t.y} class="grid" />
				<text x={P.l - 6} y={t.y + 3} class="ylbl">{t.label}</text>
			{/each}
			{#each chartUSD.yticksR as t}
				<text x={W - P.r + 6} y={t.y + 3} class="ylbl-r">{t.label}</text>
			{/each}
			{#each chartUSD.xticks as t}<text x={t.x} y={H - 8} class="xlbl">{t.label}</text>{/each}
			<g clip-path="url(#reveal-poder2)">
				<path d={chartUSD.lineaDolar} class="line-dolar" />
				<path d={chartUSD.lineaIngreso} class="line-ing" />
				{#each chartUSD.ptsD as p}<circle cx={p.x} cy={p.y} r="2" class="dot-dolar" />{/each}
				{#each chartUSD.ptsS as p}<circle cx={p.x} cy={p.y} r="2" class="dot-ing" />{/each}
			</g>
		</svg>
		<NotaVisual objetivo="Cuánto vale tu sueldo medido en dólares">
			{#snippet muestra()}Tu ingreso principal convertido a dólares (eje izquierdo) y el dólar bolsa (eje derecho), sobre el mismo período.{/snippet}
			{#snippet leer()}Son dos ejes distintos, así que importa la forma de cada línea, no cuál está más arriba. Si el ingreso en dólares cae mientras el dólar sube, el golpe vino del tipo de cambio y no de tu sueldo.{/snippet}
			{#snippet usar()}Distinguir una caída real de tu ingreso de una devaluación, antes de sacar conclusiones.{/snippet}
		</NotaVisual>
	{:else}
		<p class="nota">No hay suficientes meses en esta ventana para graficar.</p>
	{/if}

	<NotaVisual objetivo="Cómo se calculan los dos gráficos de arriba" glosario="poder">
		{#snippet muestra()}El criterio común de las dos comparaciones de esta pantalla.{/snippet}
		{#snippet leer()}El ingreso de un período se compara contra la inflación acumulada <strong>hasta el mes anterior</strong>: la inflación de un mes te pega en el sueldo del mes siguiente. La brecha entre las líneas es tu poder adquisitivo respecto del inicio de la ventana, no respecto de hoy.{/snippet}
		{#snippet usar()}Tener presente que cambiar la ventana cambia el punto de partida, y con eso cambia la brecha que ves.{/snippet}
	</NotaVisual>
{/if}

<style>
	h2 { font-size: 1.02rem; margin-top: 26px; border-left: 3px solid var(--accent); padding-left: 12px; }
	.vistas { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0; align-items: center; }
	.sk-vistas { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0; }
	.sk-chart { margin-top: 12px; }
	.vistas select { padding: 5px 8px; }
	.leyenda { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; font-size: 0.8rem; color: var(--text-dim); margin: 6px 0; }
	.leg { display: inline-flex; align-items: center; gap: 5px; }
	.sw { width: 16px; height: 3px; border-radius: 2px; display: inline-block; }
	.sw-ing { background: var(--accent); }
	.sw-inf { background: #e8975b; }
	.sw-dolar { background: #e8975b; }

	.chart { width: 100%; height: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
	.grid { stroke: var(--border); stroke-width: 1; }
	.ylbl { font-size: 10px; fill: var(--text-dim); text-anchor: end; }
	.ylbl-r { font-size: 10px; fill: var(--text-dim); text-anchor: start; }
	.xlbl { font-size: 10px; fill: var(--text-dim); text-anchor: middle; }
	.line-ing { fill: none; stroke: var(--accent); stroke-width: 2.5; }
	.line-inf { fill: none; stroke: #e8975b; stroke-width: 2.5; }
	.line-dolar { fill: none; stroke: #e8975b; stroke-width: 2.5; }
	.dot-ing { fill: var(--accent); }
	.dot-inf { fill: #e8975b; }
	.dot-dolar { fill: #e8975b; }
	.endlbl { font-size: 11px; font-weight: 700; }
	.endlbl.ing { fill: var(--accent); }
	.endlbl.inf { fill: #e8975b; }
	.nota { font-size: 0.8rem; color: var(--text-dim); margin-top: 12px; }
</style>

<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import { cargarModo, cargarCortes, crearAsignador, type ModoPeriodo } from '$lib/periodo';

	// Todos $state: si en el futuro se recargan después del primer render,
	// los $derived y gráficos que dependen de ellos se actualizan solos.
	let sueldos = $state<Record<string, number>>({});
	let infl = $state<Record<string, number>>({});
	let dolarSerie = $state<{ fecha: string; valor: number }[]>([]);  // serie diaria ordenada, para conversión por día

	function dolarDeFecha(fecha: string): number | null {
		let elegido: number | null = null;
		for (const d of dolarSerie) {
			if (d.fecha <= fecha) elegido = d.valor;
			else break;
		}
		return elegido;
	}
	let ingresosPeriodo = $state<Record<string, number>>({});
	let gastosPeriodo = $state<Record<string, number>>({});
	let cortes = $state<{ fecha: string; periodo: string }[]>([]);
	let periodosTodos = $state<string[]>([]);

	let vista = $state<'historico' | 'ult12' | 'anio'>('historico');
	let anio = $state('');
	let anios = $state<string[]>([]);
	let cargando = $state(true);

	onMount(async () => {
		const modo: ModoPeriodo = await cargarModo();
		cortes = modo === 'sueldo' ? await cargarCortes() : [];
		const asignar = crearAsignador(modo, cortes);

		const s = (await query("SELECT periodo, SUM(monto) AS m FROM ingreso WHERE perfil_id=1 AND tipo='Sueldo' AND categoria='Ingreso Principal' AND periodo IS NOT NULL GROUP BY periodo")) as any[];
		for (const x of s) sueldos[x.periodo] = x.m;
		const inf = (await query('SELECT periodo, valor FROM inflacion WHERE perfil_id=1')) as any[];
		for (const x of inf) infl[x.periodo] = x.valor;
		const dolDia = (await query("SELECT fecha, valor FROM cotizacion_dolar WHERE perfil_id=1 AND casa='bolsa' ORDER BY fecha")) as any[];
		dolarSerie = dolDia.map((d) => ({ fecha: d.fecha, valor: d.valor }));
		periodosTodos = Object.keys(sueldos).sort();
		anios = [...new Set(periodosTodos.map((p) => p.slice(0, 4)))].sort();
		anio = anios[anios.length - 1] ?? '';

		// Ingresos por periodo, en USD (dólar del día del ingreso)
		const ing = (await query("SELECT periodo, fecha, monto, moneda FROM ingreso WHERE perfil_id=1 AND periodo IS NOT NULL")) as any[];
		for (const x of ing) {
			const d = dolarDeFecha(x.fecha);
			const usd = x.moneda === 'USD' ? x.monto : (d ? x.monto / d : null);
			if (usd != null) ingresosPeriodo[x.periodo] = (ingresosPeriodo[x.periodo] ?? 0) + usd;
		}

		// Gastos asignados a periodo según el modo, en USD (dólar del día del gasto)
		const gas = (await query("SELECT fecha, monto, moneda FROM gasto WHERE perfil_id=1")) as any[];
		for (const x of gas) {
			const per = asignar(x.fecha);
			if (!per) continue;
			const d = dolarDeFecha(x.fecha);
			const usd = x.moneda === 'USD' ? x.monto : (d ? x.monto / d : null);
			if (usd != null) gastosPeriodo[per] = (gastosPeriodo[per] ?? 0) + usd;
		}
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
	let periodosIG = $derived.by(() => {
		const todos = [...new Set([...Object.keys(ingresosPeriodo), ...Object.keys(gastosPeriodo)])].sort();
		if (vista === 'historico') return todos;
		if (vista === 'anio') return todos.filter((p) => p.startsWith(anio));
		return todos.slice(-12);
	});

	let serieIG = $derived.by(() =>
		periodosIG.map((p) => ({
			periodo: p,
			ingreso: ingresosPeriodo[p] ?? 0,
			gasto: gastosPeriodo[p] ?? 0,
			balance: (ingresosPeriodo[p] ?? 0) - (gastosPeriodo[p] ?? 0)
		}))
	);

	let chartIG = $derived.by(() => {
		if (serieIG.length < 1) return null;
		const allV = serieIG.flatMap((s) => [s.ingreso, s.gasto]);
		let minY = Math.min(0, ...allV), maxY = Math.max(...allV, 1);
		const padY = (maxY - minY) * 0.08 || 1; maxY += padY;
		const n = serieIG.length;
		const innerW = W - P.l - P.r;
		const grupoW = innerW / n;
		const barW = Math.min(18, (grupoW * 0.8) / 2);
		const py = (y: number) => H - P.b - ((y - minY) / (maxY - minY)) * (H - P.t - P.b);
		const y0 = py(0);
		const barras = serieIG.map((s, i) => {
			const cx = P.l + grupoW * i + grupoW / 2;
			return {
				ing: { x: cx - barW - 1, y: py(s.ingreso), h: Math.abs(y0 - py(s.ingreso)) },
				gas: { x: cx + 1, y: py(s.gasto), h: Math.abs(y0 - py(s.gasto)) },
				periodo: s.periodo
			};
		});
		const yticks = Array.from({ length: 4 }, (_, k) => {
			const v = minY + ((maxY - minY) * k) / 3;
			return { y: py(v), label: v.toFixed(0) };
		});
		const step = Math.max(1, Math.floor(n / 8));
		const xticks = barras.filter((_, i) => i % step === 0).map((b) => ({ x: b.ing.x + barW, label: b.periodo.slice(2) }));
		return { barras, yticks, xticks, barW };
	});

	// Serie sueldo en USD + dólar bolsa (doble eje), por periodo de sueldo
	let serieSueldoUSD = $derived.by(() => {
		return periodos.map((p) => {
			// dólar del día del corte de ese periodo
			const corte = cortes.find((c) => c.periodo === p);
			const dolarP = corte ? dolarDeFecha(corte.fecha) : null;
			const sueldoUSD = (sueldos[p] != null && dolarP) ? sueldos[p] / dolarP : null;
			return { periodo: p, sueldoUSD, dolar: dolarP };
		}).filter((x) => x.sueldoUSD != null && x.dolar != null);
	});

	let chartSueldoUSD = $derived.by(() => {
		const s = serieSueldoUSD;
		if (s.length < 2) return null;
		const n = s.length;
		const px = (i: number) => P.l + (i / (n - 1)) * (W - P.l - P.r);

		// Eje izquierdo: sueldo USD
		const vSueldo = s.map((d) => d.sueldoUSD as number);
		let minL = Math.min(...vSueldo), maxL = Math.max(...vSueldo);
		const padL = (maxL - minL) * 0.1 || 1; minL -= padL; maxL += padL;
		const pyL = (y: number) => H - P.b - ((y - minL) / (maxL - minL)) * (H - P.t - P.b);

		// Eje derecho: dólar
		const vDolar = s.map((d) => d.dolar as number);
		let minR = Math.min(...vDolar), maxR = Math.max(...vDolar);
		const padR = (maxR - minR) * 0.1 || 1; minR -= padR; maxR += padR;
		const pyR = (y: number) => H - P.b - ((y - minR) / (maxR - minR)) * (H - P.t - P.b);

		const lineaSueldo = s.map((d, i) => (i ? 'L' : 'M') + px(i).toFixed(1) + ',' + pyL(d.sueldoUSD as number).toFixed(1)).join(' ');
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
			.map((o) => ({ x: px(o.i), label: o.p.slice(2) }));

		return {
			lineaSueldo, lineaDolar, yticksL, yticksR, xticks,
			ptsS: s.map((d, i) => ({ x: px(i), y: pyL(d.sueldoUSD as number) })),
			ptsD: s.map((d, i) => ({ x: px(i), y: pyR(d.dolar as number) }))
		};
	});

	let resumenIG = $derived.by(() => {
		const tIng = serieIG.reduce((s, x) => s + x.ingreso, 0);
		const tGas = serieIG.reduce((s, x) => s + x.gasto, 0);
		return { tIng, tGas, balance: tIng - tGas };
	});

	const usd0 = (n: number) => 'U$D ' + Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });

	const pct = (n: number, dec = 1) => (n >= 0 ? '+' : '') + (n * 100).toFixed(dec) + '%';
</script>

<h1>Ingresos</h1>

<a href="/carga-ingresos" class="btn-carga">➕ Cargar ingreso</a>

{#if cargando}
	<p>Cargando…</p>
{:else}
	
	<div class="vistas">
		<button class:activo={vista === 'historico'} onclick={() => (vista = 'historico')}>Histórico</button>
		<button class:activo={vista === 'ult12'} onclick={() => (vista = 'ult12')}>Últimos 12 meses</button>
		<button class:activo={vista === 'anio'} onclick={() => (vista = 'anio')}>Año calendario</button>
		{#if vista === 'anio'}
			<select bind:value={anio}>{#each anios as y (y)}<option value={y}>{y}</option>{/each}</select>
		{/if}
	</div>

	<h2>Ingresos vs Gastos (USD)</h2>
	<div class="resumen">
		<div class="card"><span>Ingresos totales</span><strong>{usd0(resumenIG.tIng)}</strong></div>
		<div class="card"><span>Gastos totales</span><strong>{usd0(resumenIG.tGas)}</strong></div>
		<div class="card" class:ok={resumenIG.balance >= 0} class:bad={resumenIG.balance < 0}>
			<span>Balance</span><strong>{usd0(resumenIG.balance)}</strong>
		</div>
	</div>
	<div class="leyenda">
		<span class="leg"><span class="sw sw-ing"></span> Ingresos</span>
		<span class="leg"><span class="sw sw-gas"></span> Gastos</span>
		<span class="aclara">Por período, en USD. Los gastos se asignan al período según el modo elegido en tu perfil.</span>
	</div>
	{#if chartIG}
		<svg viewBox="0 0 {W} {H}" class="chart">
			{#each chartIG.yticks as t}
				<line x1={P.l} y1={t.y} x2={W - P.r} y2={t.y} class="grid" />
				<text x={P.l - 6} y={t.y + 3} class="ylbl">{t.label}</text>
			{/each}
			{#each chartIG.xticks as t}<text x={t.x} y={H - 8} class="xlbl">{t.label}</text>{/each}
			{#each chartIG.barras as b}
				<rect x={b.ing.x} y={b.ing.y} width={chartIG.barW} height={b.ing.h} class="bar-ing" />
				<rect x={b.gas.x} y={b.gas.y} width={chartIG.barW} height={b.gas.h} class="bar-gas" />
			{/each}
		</svg>
	{:else}
		<p class="nota">No hay datos para esta ventana.</p>
	{/if}

	<h2>Salario vs Inflación</h2>
	<div class="resumen">
		<div class="card"><span>Inflación acum. {resumen.desde}→{resumen.hasta}</span><strong>{pct(resumen.inflAcum)}</strong></div>
		<div class="card"><span>Variación nominal sueldo</span><strong>{pct(resumen.varNominal)}</strong></div>
		<div class="card" class:ok={resumen.gano} class:bad={!resumen.gano}>
			<span>Poder adquisitivo vs base</span><strong>{pct(brechaActual)}</strong>
		</div>
	</div>
	<div class="leyenda">
		<span class="leg"><span class="sw sw-sal"></span> Salario</span>	<span class="leg"><span class="sw sw-inf"></span> Inflación</span>
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
	
	<h2>Sueldo en USD vs Dólar</h2>
	<div class="leyenda">
		<span class="leg"><span class="sw sw-sueldo"></span> Sueldo (USD, eje izq.)</span>
		<span class="leg"><span class="sw sw-dolar"></span> Dólar bolsa (ARS, eje der.)</span>
		<span class="aclara">Si el sueldo en USD cae mientras el dólar sube, el golpe vino del tipo de cambio, no de tu sueldo real.</span>
	</div>
	{#if chartSueldoUSD}
		<svg viewBox="0 0 {W} {H}" class="chart">
			{#each chartSueldoUSD.yticksL as t}
				<line x1={P.l} y1={t.y} x2={W - P.r} y2={t.y} class="grid" />
				<text x={P.l - 6} y={t.y + 3} class="ylbl">{t.label}</text>
			{/each}
			{#each chartSueldoUSD.yticksR as t}
				<text x={W - P.r + 6} y={t.y + 3} class="ylbl-r">{t.label}</text>
			{/each}
			{#each chartSueldoUSD.xticks as t}<text x={t.x} y={H - 8} class="xlbl">{t.label}</text>{/each}
			<path d={chartSueldoUSD.lineaDolar} class="line-dolar" />
			<path d={chartSueldoUSD.lineaSueldo} class="line-sueldo" />
			{#each chartSueldoUSD.ptsD as p}<circle cx={p.x} cy={p.y} r="2" class="dot-dolar" />{/each}
			{#each chartSueldoUSD.ptsS as p}<circle cx={p.x} cy={p.y} r="2" class="dot-sueldo" />{/each}
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
	.btn-carga { display: inline-block; background: var(--accent); color: #fff; text-decoration: none; padding: 7px 14px; border-radius: 6px; font-weight: 600; font-size: 0.9rem; margin: 4px 0 12px; }
	.sw-ing { background: var(--pos); }
	.sw-gas { background: var(--neg); }
	.bar-ing { fill: var(--pos); }
	.bar-gas { fill: var(--neg); }
	.ylbl-r { font-size: 10px; fill: var(--text-dim); text-anchor: start; }
	.line-sueldo { fill: none; stroke: var(--accent); stroke-width: 2.5; }
	.line-dolar { fill: none; stroke: #e8975b; stroke-width: 2.5; }
	.dot-sueldo { fill: var(--accent); }
	.dot-dolar { fill: #e8975b; }
	.sw-sueldo { background: var(--accent); }
	.sw-dolar { background: #e8975b; }
</style>
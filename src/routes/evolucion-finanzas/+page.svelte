<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import { cargarModo, cargarCortes, crearAsignador, type ModoPeriodo } from '$lib/periodo';
	import {
		cargarDolarSerie,
		cargarIPC,
		convertir,
		fmtMoneda,
		type DolarSerie,
		type IPC
	} from '$lib/moneda';
	import { moneda } from '$lib/moneda.svelte';
	import ToggleMoneda from '$lib/ToggleMoneda.svelte';
	import Guia from '$lib/Guia.svelte';
	import Gastos from '$lib/evol/Gastos.svelte';
	import Ingresos from '$lib/evol/Ingresos.svelte';
	import Poder from '$lib/evol/Poder.svelte';
	import Skeleton from '$lib/Skeleton.svelte';
	import { progresoReplay } from '$lib/anim';

	let ingresosRaw = $state<{ periodo: string; fecha: string; monto: number; moneda: string }[]>([]);
	let gastosRaw = $state<{ fecha: string; monto: number; moneda: string }[]>([]);
	let dolarSerie = $state<DolarSerie>([]);
	let ipc = $state<IPC>({ indice: {}, ultimoPeriodo: null, factorAHoy: () => 1 });
	let asignar = $state<(fecha: string) => string | null>(() => null);
	let modoPeriodo = $state<ModoPeriodo>('sueldo');
	let tab = $state<'resumen' | 'gastos' | 'ingresos' | 'poder'>('resumen');

	let vista = $state<'historico' | 'ult12' | 'anio'>('ult12');
	let anio = $state('');
	let cargando = $state(true);

	onMount(async () => {
		await moneda.cargar();
		modoPeriodo = await cargarModo();
		const cortes = modoPeriodo === 'sueldo' ? await cargarCortes() : [];
		asignar = crearAsignador(modoPeriodo, cortes);
		dolarSerie = await cargarDolarSerie();
		ipc = await cargarIPC();
		ingresosRaw = (await query(
			"SELECT periodo, fecha, monto, moneda FROM ingreso WHERE perfil_id=1 AND periodo IS NOT NULL"
		)) as any[];
		gastosRaw = (await query('SELECT fecha, monto, moneda FROM gasto WHERE perfil_id=1')) as any[];
		cargando = false;
	});

	// Ingresos por período, en el modo de moneda elegido (dólar/IPC del día del ingreso).
	let ingresosPeriodo = $derived.by(() => {
		const acc: Record<string, number> = {};
		for (const x of ingresosRaw) {
			const v = convertir(x.monto, x.moneda, x.fecha, moneda.modo, dolarSerie, ipc);
			if (v != null) acc[x.periodo] = (acc[x.periodo] ?? 0) + v;
		}
		return acc;
	});

	// Gastos asignados a período según el modo, en el modo de moneda elegido.
	let gastosPeriodo = $derived.by(() => {
		const acc: Record<string, number> = {};
		for (const x of gastosRaw) {
			const per = asignar(x.fecha);
			if (!per) continue;
			const v = convertir(x.monto, x.moneda, x.fecha, moneda.modo, dolarSerie, ipc);
			if (v != null) acc[per] = (acc[per] ?? 0) + v;
		}
		return acc;
	});

	let periodosTodos = $derived(
		[...new Set([...Object.keys(ingresosPeriodo), ...Object.keys(gastosPeriodo)])].sort()
	);
	let anios = $derived([...new Set(periodosTodos.map((p) => p.slice(0, 4)))].sort());

	$effect(() => {
		if (!anio && anios.length) anio = anios[anios.length - 1];
	});

	let periodosIG = $derived.by(() => {
		if (vista === 'historico') return periodosTodos;
		if (vista === 'anio') return periodosTodos.filter((p) => p.startsWith(anio));
		return periodosTodos.slice(-12);
	});

	let serieIG = $derived.by(() =>
		periodosIG.map((p) => ({
			periodo: p,
			ingreso: ingresosPeriodo[p] ?? 0,
			gasto: gastosPeriodo[p] ?? 0,
			balance: (ingresosPeriodo[p] ?? 0) - (gastosPeriodo[p] ?? 0)
		}))
	);

	const W = 720, H = 320, P = { l: 52, r: 16, t: 16, b: 28 };
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
			return { y: py(v), label: fmtNum(v) };
		});
		const step = Math.max(1, Math.floor(n / 8));
		const xticks = barras.filter((_, i) => i % step === 0).map((b) => ({ x: b.ing.x + barW, label: b.periodo.slice(2) }));
		return { barras, yticks, xticks, barW };
	});

	let resumenIG = $derived.by(() => {
		const tIng = serieIG.reduce((s, x) => s + x.ingreso, 0);
		const tGas = serieIG.reduce((s, x) => s + x.gasto, 0);
		return { tIng, tGas, balance: tIng - tGas };
	});

	// Barras: crecen desde la base al montar y en cada cambio de estado. La firma usa
	// valores absolutos, así también anima al togglear moneda.
	let sigIG = $derived(serieIG.map((s) => s.periodo + ':' + s.ingreso + ':' + s.gasto).join('|'));
	const { p: pIG, replay: replayIG } = progresoReplay();
	$effect(() => { sigIG; replayIG(); });

	// Etiquetas de eje Y en miles con separador (8.725.000 -> "8.725m", 500.000 -> "500m").
	function fmtNum(v: number): string {
		const a = Math.abs(v);
		if (a >= 1000) return Math.round(v / 1000).toLocaleString('es-AR') + 'm';
		return Math.round(v).toString();
	}
</script>

<div class="titulo-guia">
	<h1>Evolución</h1>
	<Guia clave="evolucion-finanzas" texto="Tu evolución financiera: ingresos vs gastos por período, y adentro la evolución de gastos, de ingresos y tu poder adquisitivo. Las cargas de registros se hacen desde Cuenta Corriente." />
</div>

<div class="tabs">
	<button class:activo={tab === 'gastos'} onclick={() => (tab = 'gastos')}>Evolución de Gastos</button>
	<button class:activo={tab === 'ingresos'} onclick={() => (tab = 'ingresos')}>Evolución de Ingresos</button>
	<button class:activo={tab === 'resumen'} onclick={() => (tab = 'resumen')}>Ingresos vs Gastos</button>
	<button class:activo={tab === 'poder'} onclick={() => (tab = 'poder')}>Poder adquisitivo</button>
</div>

{#if tab === 'resumen'}
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
	<div class="sk-chart"><Skeleton w="100%" h="clamp(150px, 42vw, 320px)" /></div>
{:else}
	<div class="titulo-guia">
		<h1>Ingresos vs Gastos</h1>
		<Guia clave="resumen-evolucion" texto="Comparación período a período entre los ingresos y los gastos reportados. Verde: ingresos, roja: gastos, por cada período. El Balance es la diferencia entre ingresos y gastos de todo el rango visible. El selector de moneda (USD / pesos reales / nominales) solo cambia la unidad de lectura, no los datos." />
	</div>
	<div class="vistas">
		<button class:activo={vista === 'historico'} onclick={() => (vista = 'historico')}>Histórico</button>
		<button class:activo={vista === 'ult12'} onclick={() => (vista = 'ult12')}>Últimos 12 meses</button>
		<button class:activo={vista === 'anio'} onclick={() => (vista = 'anio')}>Año calendario</button>
		{#if vista === 'anio'}
			<select bind:value={anio}>{#each anios as y (y)}<option value={y}>{y}</option>{/each}</select>
		{/if}
	</div>
	<ToggleMoneda />
	<div class="resumen">
		<div class="card"><span>Ingresos totales</span><strong>{fmtMoneda(resumenIG.tIng, moneda.modo)}</strong></div>
		<div class="card"><span>Gastos totales</span><strong>{fmtMoneda(resumenIG.tGas, moneda.modo)}</strong></div>
		<div class="card" class:ok={resumenIG.balance >= 0} class:bad={resumenIG.balance < 0}>
			<span>Balance</span><strong>{fmtMoneda(resumenIG.balance, moneda.modo)}</strong>
		</div>
	</div>
	<div class="leyenda">
		<span class="leg"><span class="sw sw-ing"></span> Ingresos</span>
		<span class="leg"><span class="sw sw-gas"></span> Gastos</span>
		<span class="aclara">
			Por período {modoPeriodo === 'sueldo' ? 'de sueldo' : 'calendario'}. Los gastos se asignan al período según el modo elegido en tu perfil.
			{#if moneda.modo === 'real' && ipc.ultimoPeriodo}Pesos de {ipc.ultimoPeriodo} (último mes de inflación cargado).{/if}
		</span>
	</div>
	{#if chartIG}
		<svg viewBox="0 0 {W} {H}" class="chart">
			{#each chartIG.yticks as t}
				<line x1={P.l} y1={t.y} x2={W - P.r} y2={t.y} class="grid" />
				<text x={P.l - 6} y={t.y + 3} class="ylbl">{t.label}</text>
			{/each}
			{#each chartIG.xticks as t}<text x={t.x} y={H - 8} class="xlbl">{t.label}</text>{/each}
			{#each chartIG.barras as b}
				<rect x={b.ing.x} y={b.ing.y + b.ing.h * (1 - $pIG)} width={chartIG.barW} height={b.ing.h * $pIG} class="bar-ing" />
				<rect x={b.gas.x} y={b.gas.y + b.gas.h * (1 - $pIG)} width={chartIG.barW} height={b.gas.h * $pIG} class="bar-gas" />
			{/each}
		</svg>
	{:else}
		<p class="nota">No hay datos para esta ventana.</p>
	{/if}
{/if}
{:else if tab === 'gastos'}
	<Gastos />
{:else if tab === 'ingresos'}
	<Ingresos />
{:else if tab === 'poder'}
	<Poder />
{/if}

<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	.resumen { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 12px 0; }
	.card { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 8px 9px; display: flex; flex-direction: column; min-width: 0; }
	.card span { font-size: clamp(0.58rem, 2.4vw, 0.72rem); color: var(--text-dim); }
	.card strong { font-size: clamp(0.82rem, 3.4vw, 1.05rem); white-space: nowrap; }
	.card.ok { background: rgba(74, 222, 128, 0.10); border-color: rgba(74, 222, 128, 0.35); }
	.card.bad { background: rgba(248, 113, 113, 0.10); border-color: rgba(248, 113, 113, 0.35); }
	.vistas { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0; align-items: center; }
	.sk-vistas { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0; }
	.sk-card { gap: 6px; }
	.sk-chart { margin-top: 12px; }
	.vistas select { padding: 5px 8px; }
	.leyenda { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; font-size: 0.8rem; color: var(--text-dim); margin: 6px 0; }
	.leg { display: inline-flex; align-items: center; gap: 5px; }
	.sw { width: 16px; height: 3px; border-radius: 2px; display: inline-block; }
	.aclara { color: var(--text-dim); }
	.chart { width: 100%; height: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
	.grid { stroke: var(--border); stroke-width: 1; }
	.ylbl { font-size: 10px; fill: var(--text-dim); text-anchor: end; }
	.xlbl { font-size: 10px; fill: var(--text-dim); text-anchor: middle; }
	.nota { font-size: 0.8rem; color: var(--text-dim); margin-top: 12px; }
	.tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 4px 0 16px; }
	.tabs button { padding: 8px 12px; font-size: 0.9rem; line-height: 1.15; }
	.sw-ing { background: var(--pos); }
	.sw-gas { background: var(--neg); }
	.bar-ing { fill: var(--pos); }
	.bar-gas { fill: var(--neg); }
</style>

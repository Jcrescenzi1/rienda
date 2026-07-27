<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import { cargarModo, cargarCortes, crearAsignador, secuenciaPeriodos, type ModoPeriodo } from '$lib/periodo';
	import {
		cargarDolarSerie,
		cargarIPC,
		convertir,
		fmtMoneda,
		type DolarSerie,
		type IPC,
		type ModoMoneda
	} from '$lib/moneda';
	import Guia from '$lib/Guia.svelte';
	import Skeleton from '$lib/Skeleton.svelte';

	// Callback del padre (evolucion-finanzas): salta a Evolución de Gastos con una
	// subcategoría pre-filtrada. Ver el handshake por sessionStorage en Gastos.svelte.
	let { irAGastos = (_scid: number) => {} }: { irAGastos?: (scid: number) => void } = $props();

	type Gasto = { fecha: string; monto: number; moneda: string; categoria_id: number; categoria: string; scid: number | null };

	let cargando = $state(true);
	let gastos = $state<Gasto[]>([]);
	let subcategorias = $state<{ id: number; nombre: string }[]>([]);
	// Ingresos regulares (misma def que Brief 1): base del corte a "Otros" en Visual 1.
	let ingresosReg = $state<{ periodo: string; fecha: string; monto: number; moneda: string }[]>([]);
	let dolarSerie = $state<DolarSerie>([]);
	let ipc = $state<IPC>({ indice: {}, ultimoPeriodo: null, factorAHoy: () => 1 });
	let asignar = $state<(fecha: string) => string | null>(() => null);
	let modoPeriodo = $state<ModoPeriodo>('sueldo');
	let cortePeriodos = $state<string[]>([]);

	// Toggle propio real/nominal (default real). No usa el store global de moneda:
	// esta hoja no tiene lente USD (los % de composición son sobre pesos).
	let modoLocal = $state<ModoMoneda>('real');

	onMount(async () => {
		const [, cortes, ds, ic, g, sub, ir] = await Promise.all([
			(async () => {})(),
			(async () => { modoPeriodo = await cargarModo(); return modoPeriodo === 'sueldo' ? await cargarCortes() : []; })(),
			cargarDolarSerie(),
			cargarIPC(),
			query(
				`SELECT g.fecha, g.monto, g.moneda, g.categoria_id, c.nombre AS categoria,
				        COALESCE(g.subcategoria_id, m.subcategoria_id) AS scid
				 FROM gasto g
				 JOIN categoria c ON c.id = g.categoria_id
				 LEFT JOIN mapeo_detalle m ON m.perfil_id = g.perfil_id AND m.detalle = g.detalle
				 WHERE g.perfil_id = 1 ORDER BY g.fecha`
			),
			query('SELECT id, nombre FROM subcategoria WHERE perfil_id=1'),
			query(
				`SELECT periodo, fecha, monto, moneda FROM ingreso
				 WHERE perfil_id=1 AND tipo='Sueldo'
				   AND categoria IN ('Ingreso Principal','Ingresos Secundarios') AND periodo IS NOT NULL`
			)
		]);
		asignar = crearAsignador(modoPeriodo, cortes as any);
		cortePeriodos = (cortes as any[]).map((c) => c.periodo);
		dolarSerie = ds; ipc = ic;
		gastos = g as any[]; subcategorias = sub as any[]; ingresosReg = ir as any[];
		cargando = false;
	});

	const MESES = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
	const mesCorto = (p: string) => { const [y, m] = p.split('-'); return MESES[+m] + " '" + y.slice(2); };

	let subName = $derived(new Map(subcategorias.map((s) => [s.id, s.nombre])));
	let catName = $derived.by(() => { const m = new Map<number, string>(); for (const g of gastos) m.set(g.categoria_id, g.categoria); return m; });

	// Períodos con gasto (para acotar "histórico" por abajo) y ventana base = últimos
	// 12 del enumerador de la app (respeta modo sueldo/calendario, no new Date()).
	let periodosTodos = $derived.by(() => {
		const s = new Set<string>();
		for (const g of gastos) { const p = asignar(g.fecha); if (p) s.add(p); }
		return [...s].sort();
	});
	let mesActualCalc = $derived(periodosTodos.length ? periodosTodos[periodosTodos.length - 1] : '');
	let periodosBase = $derived.by(() => {
		if (!periodosTodos.length) return [] as string[];
		return secuenciaPeriodos('ult12', {
			modo: modoPeriodo,
			cortePeriodos,
			primerDato: periodosTodos[0] ?? null,
			actual: mesActualCalc,
			anio: mesActualCalc.slice(0, 4)
		});
	});
	let ventana6 = $derived(periodosBase.slice(-6));
	let setVentana = $derived(new Set(ventana6));

	// Agregados por período (categoría / subcategoría / total), en el modo elegido.
	let agg = $derived.by(() => {
		const catByPeriod = new Map<string, Map<number, number>>();
		const subByPeriod = new Map<string, Map<string, number>>();
		const totalByPeriod = new Map<string, number>();
		for (const g of gastos) {
			const per = asignar(g.fecha);
			if (!per || !setVentana.has(per)) continue;
			const v = convertir(g.monto, g.moneda, g.fecha, modoLocal, dolarSerie, ipc);
			if (v == null || v <= 0) continue;
			let cm = catByPeriod.get(per); if (!cm) { cm = new Map(); catByPeriod.set(per, cm); }
			cm.set(g.categoria_id, (cm.get(g.categoria_id) ?? 0) + v);
			const sk = g.scid == null ? 'null' : String(g.scid);
			let sm = subByPeriod.get(per); if (!sm) { sm = new Map(); subByPeriod.set(per, sm); }
			sm.set(sk, (sm.get(sk) ?? 0) + v);
			totalByPeriod.set(per, (totalByPeriod.get(per) ?? 0) + v);
		}
		return { catByPeriod, subByPeriod, totalByPeriod };
	});

	// Ingreso regular por período (en el modo elegido) para el corte a "Otros".
	let ingRegPeriodo = $derived.by(() => {
		const acc = new Map<string, number>();
		for (const r of ingresosReg) {
			const v = convertir(r.monto, r.moneda, r.fecha, modoLocal, dolarSerie, ipc);
			if (v == null) continue;
			acc.set(r.periodo, (acc.get(r.periodo) ?? 0) + v);
		}
		return acc;
	});

	// ===== Visual 1: barras agrupadas por categoría (% del gasto de su período) =====
	let v1 = $derived.by(() => {
		const ps = periodosBase.slice(-3); // ascendente [n-2, n-1, n]
		if (!ps.length) return null;
		const cur = ps[ps.length - 1];
		const { catByPeriod, totalByPeriod } = agg;
		const curMap = catByPeriod.get(cur) ?? new Map<number, number>();
		const allCats = new Set<number>();
		for (const p of ps) { const m = catByPeriod.get(p); if (m) for (const k of m.keys()) allCats.add(k); }
		const ranked = [...allCats].sort((a, b) => (curMap.get(b) ?? 0) - (curMap.get(a) ?? 0));
		const ingReg = ingRegPeriodo.get(cur) ?? 0;
		const top8 = new Set(ranked.slice(0, 8));
		// ≥10% del ingreso regular del mes actual → siempre individual (además del top 8).
		const shown = ranked.filter((id) => top8.has(id) || (ingReg > 0 && (curMap.get(id) ?? 0) >= 0.10 * ingReg));
		const shownSet = new Set(shown);
		const rows = shown.map((id) => ({
			catId: id,
			nombre: catName.get(id) ?? '?',
			barras: ps.map((p) => { const t = totalByPeriod.get(p) ?? 0; const v = catByPeriod.get(p)?.get(id) ?? 0; return t > 0 ? (v / t) * 100 : 0; })
		}));
		const otros = ps.map((p) => {
			const t = totalByPeriod.get(p) ?? 0; if (t <= 0) return 0;
			let s = 0; const m = catByPeriod.get(p); if (m) for (const [k, v] of m) if (!shownSet.has(k)) s += v;
			return (s / t) * 100;
		});
		return { periodos: ps, rows, otros: otros.some((x) => x > 0.05) ? otros : null };
	});

	// ===== Visual 2: matriz de composición (categorías × últimos 5, 100% por columna) =====
	let v2 = $derived.by(() => {
		const ps = periodosBase.slice(-5);
		if (!ps.length) return null;
		const { catByPeriod, totalByPeriod } = agg;
		const allCats = new Set<number>();
		const catTotal = new Map<number, number>();
		for (const p of ps) { const m = catByPeriod.get(p); if (m) for (const [k, v] of m) { allCats.add(k); catTotal.set(k, (catTotal.get(k) ?? 0) + v); } }
		const rows = [...allCats].sort((a, b) => (catTotal.get(b) ?? 0) - (catTotal.get(a) ?? 0)).map((id) => ({
			nombre: catName.get(id) ?? '?',
			celdas: ps.map((p) => { const t = totalByPeriod.get(p) ?? 0; const v = catByPeriod.get(p)?.get(id) ?? 0; return t > 0 ? (v / t) * 100 : null; })
		}));
		return { periodos: ps, rows };
	});

	// ===== Visual 3: movers de subcategoría (últimos 3 vs 3 previos) =====
	let v3 = $derived.by(() => {
		const ps = periodosBase.slice(-6);
		if (ps.length < 6) return { insuficiente: true as const };
		const prev3 = ps.slice(0, 3), last3 = ps.slice(3);
		const lastSet = new Set(last3);
		const { subByPeriod } = agg;
		const sumLast = new Map<string, number>(), sumPrev = new Map<string, number>(), sum6 = new Map<string, number>();
		let total6 = 0;
		for (const p of ps) {
			const m = subByPeriod.get(p); if (!m) continue;
			const inLast = lastSet.has(p);
			for (const [k, v] of m) {
				sum6.set(k, (sum6.get(k) ?? 0) + v); total6 += v;
				if (inLast) sumLast.set(k, (sumLast.get(k) ?? 0) + v);
				else sumPrev.set(k, (sumPrev.get(k) ?? 0) + v);
			}
		}
		const piso = 0.05 * total6; // relativo: subcat ≥5% del gasto de la ventana
		const movers = [...sum6.keys()].filter((k) => (sum6.get(k) ?? 0) >= piso).map((k) => {
			const l = sumLast.get(k) ?? 0, pv = sumPrev.get(k) ?? 0;
			return {
				scid: k === 'null' ? null : Number(k),
				nombre: k === 'null' ? '(sin subcategoría)' : (subName.get(Number(k)) ?? ('#' + k)),
				delta: l - pv, prev: pv, acc: pv > 0 ? (l - pv) / pv : null
			};
		});
		const crec = movers.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 8);
		const caida = movers.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 8);
		const acel = movers.filter((m) => m.acc != null).sort((a, b) => (b.acc as number) - (a.acc as number)).slice(0, 8);
		return { insuficiente: false as const, crec, caida, acel, prev3, last3 };
	});

	let acelAbierto = $state(false);
	const pct = (n: number) => n.toFixed(1) + '%';
	const signo = (n: number) => (n >= 0 ? '+' : '−') + fmtMoneda(Math.abs(n), modoLocal);
	// Paleta por barra de período (n-2, n-1, n): de tenue a acento.
	const BAR = ['#94a0b8', '#5b9dff', '#e8975b'];
</script>

<div class="titulo-guia">
	<h1>Análisis por categoría</h1>
	<Guia clave="analisis-categoria" texto="Compará tus categorías de gasto entre sí y en el tiempo: qué pesa más este mes, cómo se movió la composición en los últimos meses, y qué subcategorías crecieron o cayeron. En pesos reales (ajustados por inflación) o nominales." />
</div>

{#if cargando}
	<div class="sk-chart"><Skeleton w="100%" h="clamp(150px, 42vw, 300px)" /></div>
{:else}
	<div class="toggle-modo">
		<button class:activo={modoLocal === 'real'} onclick={() => (modoLocal = 'real')}>Pesos reales</button>
		<button class:activo={modoLocal === 'nominal'} onclick={() => (modoLocal = 'nominal')}>Pesos nominales</button>
	</div>

	<!-- Visual 1 -->
	<h2>Peso de cada categoría</h2>
	<p class="aclara">Cada barra es el % que la categoría representó del gasto total de ese período. Ordenadas por peso del mes actual.</p>
	{#if v1 && v1.rows.length}
		<div class="leyenda-periodos">
			{#each v1.periodos as p, i (p)}<span class="leg"><span class="sw" style="background:{BAR[i]}"></span>{mesCorto(p)}</span>{/each}
		</div>
		<div class="v1">
			{#each v1.rows as r (r.catId)}
				<div class="v1-row">
					<span class="v1-cat">{r.nombre}</span>
					<div class="v1-bars">
						{#each r.barras as b, i}
							<div class="v1-bar-wrap"><div class="v1-bar" style="width:{Math.max(b, 0)}%; background:{BAR[i]}"></div><span class="v1-pct">{pct(b)}</span></div>
						{/each}
					</div>
				</div>
			{/each}
			{#if v1.otros}
				<div class="v1-row otros">
					<span class="v1-cat">Otros</span>
					<div class="v1-bars">
						{#each v1.otros as b, i}
							<div class="v1-bar-wrap"><div class="v1-bar" style="width:{Math.max(b, 0)}%; background:{BAR[i]}; opacity:0.55"></div><span class="v1-pct">{pct(b)}</span></div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{:else}
		<p class="nota">No hay gastos en los últimos períodos.</p>
	{/if}

	<!-- Visual 2 -->
	<h2>Composición en el tiempo</h2>
	<p class="aclara">% de cada categoría sobre el gasto total del período. Cada columna suma 100%.</p>
	{#if v2 && v2.rows.length}
		<div class="tabla-scroll">
			<table>
				<thead><tr><th>Categoría</th>{#each v2.periodos as p (p)}<th>{mesCorto(p)}</th>{/each}</tr></thead>
				<tbody>
					{#each v2.rows as r (r.nombre)}
						<tr><td><strong>{r.nombre}</strong></td>{#each r.celdas as c}<td class="num">{c == null ? '—' : pct(c)}</td>{/each}</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<p class="nota">No hay gastos en los últimos períodos.</p>
	{/if}

	<!-- Visual 3 -->
	<h2>Subcategorías que más se movieron</h2>
	<p class="aclara">Últimos 3 períodos vs. los 3 previos, en {modoLocal === 'real' ? 'pesos reales' : 'pesos nominales'}. Tocá una para verla en Evolución de Gastos.</p>
	{#if v3.insuficiente}
		<p class="nota">Hacen falta al menos 6 períodos con gasto para comparar 3 contra 3.</p>
	{:else}
		<div class="movers">
			<div class="mov-col">
				<h3 class="mov-tit up">▲ Mayor crecimiento</h3>
				{#if v3.crec.length}
					{#each v3.crec as m (m.nombre)}
						<button class="mov" class:click={m.scid != null} onclick={() => m.scid != null && irAGastos(m.scid)}>
							<span class="mov-nom">{m.nombre}</span><span class="mov-delta up">{signo(m.delta)}</span>
						</button>
					{/each}
				{:else}<p class="nota">Sin subcategorías relevantes al alza.</p>{/if}
			</div>
			<div class="mov-col">
				<h3 class="mov-tit down">▼ Mayor caída</h3>
				{#if v3.caida.length}
					{#each v3.caida as m (m.nombre)}
						<button class="mov" class:click={m.scid != null} onclick={() => m.scid != null && irAGastos(m.scid)}>
							<span class="mov-nom">{m.nombre}</span><span class="mov-delta down">{signo(m.delta)}</span>
						</button>
					{/each}
				{:else}<p class="nota">Sin subcategorías relevantes a la baja.</p>{/if}
			</div>
		</div>
		<button class="acel-toggle" onclick={() => (acelAbierto = !acelAbierto)}>{acelAbierto ? '▾' : '▸'} Mayor aceleración %</button>
		{#if acelAbierto}
			<div class="acel">
				{#each v3.acel as m (m.nombre)}
					<button class="mov" class:click={m.scid != null} onclick={() => m.scid != null && irAGastos(m.scid)}>
						<span class="mov-nom">{m.nombre}</span><span class="mov-delta {m.acc! >= 0 ? 'up' : 'down'}">{m.acc! >= 0 ? '+' : ''}{(m.acc! * 100).toFixed(0)}%</span>
					</button>
				{/each}
				{#if !v3.acel.length}<p class="nota">Sin datos de aceleración (falta gasto previo).</p>{/if}
			</div>
		{/if}
	{/if}
{/if}

<style>
	h2 { font-size: 1.02rem; margin-top: 26px; border-left: 3px solid var(--accent); padding-left: 12px; }
	h3 { font-size: 0.9rem; margin: 0 0 8px; }
	.aclara { font-size: 0.8rem; color: var(--text-dim); margin: 4px 0 10px; }
	.nota { font-size: 0.8rem; color: var(--text-dim); margin-top: 8px; }
	.sk-chart { margin-top: 12px; }
	.toggle-modo { display: flex; gap: 6px; margin: 8px 0 4px; }
	.toggle-modo button { padding: 5px 10px; font-size: 0.82rem; border: 1px solid var(--border); background: var(--surface); border-radius: 6px; color: var(--text); cursor: pointer; }
	.toggle-modo button.activo { border-color: var(--accent); color: var(--accent); }
	.leyenda-periodos { display: flex; gap: 14px; flex-wrap: wrap; font-size: 0.78rem; color: var(--text-dim); margin: 4px 0 10px; }
	.leyenda-periodos .leg { display: inline-flex; align-items: center; gap: 5px; }
	.leyenda-periodos .sw { width: 14px; height: 3px; border-radius: 2px; display: inline-block; }

	.v1 { display: flex; flex-direction: column; gap: 12px; }
	.v1-row { display: grid; grid-template-columns: 34% 1fr; gap: 8px; align-items: center; }
	.v1-cat { font-size: 0.85rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.v1-row.otros .v1-cat { color: var(--text-dim); font-weight: 400; }
	.v1-bars { display: flex; flex-direction: column; gap: 3px; }
	.v1-bar-wrap { display: flex; align-items: center; gap: 6px; }
	.v1-bar { height: 10px; border-radius: 3px; min-width: 1px; transition: width 0.4s ease; }
	.v1-pct { font-size: 0.72rem; color: var(--text-dim); white-space: nowrap; }

	.tabla-scroll { overflow-x: auto; }
	table { border-collapse: collapse; width: 100%; font-size: 0.85rem; margin-bottom: 8px; }
	th, td { padding: 6px; text-align: left; }
	th:not(:first-child), td:not(:first-child) { text-align: right; white-space: nowrap; }
	tbody tr:nth-child(odd) td { background: var(--surface); }

	.movers { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 4px; }
	.mov-col { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
	.mov-tit.up { color: var(--pos); }
	.mov-tit.down { color: var(--neg); }
	.mov { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; width: 100%; text-align: left; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 6px 9px; color: var(--text); font: inherit; cursor: default; }
	.mov.click { cursor: pointer; }
	.mov.click:hover { border-color: var(--accent); }
	.mov-nom { font-size: 0.82rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.mov-delta { font-size: 0.82rem; font-weight: 600; white-space: nowrap; }
	.mov-delta.up { color: var(--pos); }
	.mov-delta.down { color: var(--neg); }
	.acel-toggle { margin-top: 12px; background: none; border: none; color: var(--accent); font-size: 0.84rem; cursor: pointer; padding: 0; }
	.acel { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; }
	@media (max-width: 520px) { .movers { grid-template-columns: 1fr; } .v1-row { grid-template-columns: 40% 1fr; } }
</style>

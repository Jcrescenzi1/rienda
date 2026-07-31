<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import { cargarModo, cargarCortes, crearAsignador, secuenciaPeriodos, type ModoPeriodo } from '$lib/periodo';
	import {
		cargarDolarSerie,
		cargarIPC,
		convertir,
		type DolarSerie,
		type IPC,
		type ModoMoneda
	} from '$lib/moneda';
	import Guia from '$lib/Guia.svelte';
	import Skeleton from '$lib/Skeleton.svelte';
	import { mesCorto } from '$lib/format';

	// Callback del padre (evolucion-finanzas): salta a Evolución de Gastos con una
	// subcategoría pre-filtrada. Ver el handshake por sessionStorage en Gastos.svelte.
	import type { Snippet } from 'svelte';
	// Ver Gastos.svelte: `nav` se renderiza debajo del título (Brief H / B5).
	let { irAGastos = (_scid: number) => {}, nav }: { irAGastos?: (scid: number) => void; nav?: Snippet } = $props();

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

	// mesCorto viene de $lib/format (helper único, Brief H / A2).

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
	// Ventana de agregación: últimos 11 períodos. Visual 1 usa sus últimos 3; los
	// movers (Visual 2) necesitan 2 recientes + 9 de baseline = 11.
	let ventanaAgg = $derived(periodosBase.slice(-11));
	let setVentana = $derived(new Set(ventanaAgg));

	// Agregados por período (categoría / subcategoría / total), en el modo elegido.
	let agg = $derived.by(() => {
		const catByPeriod = new Map<string, Map<number, number>>();
		const subByPeriod = new Map<string, Map<string, number>>();
		// Desglose por categoría → subcategoría efectiva dentro de cada período (para
		// el despliegue in-place de la Visual 1).
		const catSubByPeriod = new Map<string, Map<number, Map<string, number>>>();
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
			let csm = catSubByPeriod.get(per); if (!csm) { csm = new Map(); catSubByPeriod.set(per, csm); }
			let sub2 = csm.get(g.categoria_id); if (!sub2) { sub2 = new Map(); csm.set(g.categoria_id, sub2); }
			sub2.set(sk, (sub2.get(sk) ?? 0) + v);
			totalByPeriod.set(per, (totalByPeriod.get(per) ?? 0) + v);
		}
		return { catByPeriod, subByPeriod, catSubByPeriod, totalByPeriod };
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

	// Despliegue in-place de la Visual 1: categoría expandida (una a la vez, patrón
	// tap-despliega/tap-colapsa como la matriz de Crédito). null = ninguna.
	let expandido = $state<number | null>(null);
	// Subcategorías de la categoría expandida, con su % del GASTO TOTAL del período
	// (mismo denominador que la barra madre → las subcats suman exacto al % de la
	// categoría). Orden por peso.
	let desglose = $derived.by(() => {
		if (expandido == null || !v1) return null;
		const ps = v1.periodos;
		const { catSubByPeriod, totalByPeriod } = agg;
		const subs = new Set<string>();
		const subTotal = new Map<string, number>();
		for (const p of ps) {
			const m = catSubByPeriod.get(p)?.get(expandido);
			if (m) for (const [k, v] of m) { subs.add(k); subTotal.set(k, (subTotal.get(k) ?? 0) + v); }
		}
		return [...subs].sort((a, b) => (subTotal.get(b) ?? 0) - (subTotal.get(a) ?? 0)).map((k) => ({
			nombre: k === 'null' ? '(sin subcategoría)' : (subName.get(Number(k)) ?? ('#' + k)),
			barras: ps.map((p) => {
				const tot = totalByPeriod.get(p) ?? 0;
				const v = catSubByPeriod.get(p)?.get(expandido as number)?.get(k) ?? 0;
				return tot > 0 ? (v / tot) * 100 : 0;
			})
		}));
	});

	// ===== Visual 2 — Movers: detector de anomalía (reciente vs mediana móvil) =====
	// Reciente = promedio de los 2 últimos períodos. Baseline = mediana de los 9
	// inmediatamente anteriores (excluye los 2 recientes para que el pico no se
	// autocancele). Ratio = reciente/baseline; rankea por ratio. Piso de ruido 3% del
	// gasto total del período reciente sobre max(reciente,baseline). Guard: ≥11 períodos.
	let v3 = $derived.by(() => {
		const ps = periodosBase;
		if (ps.length < 11) return { insuficiente: true as const };
		const newestFirst = [...ps.slice(-11)].reverse(); // P0 (más nuevo) .. P10
		const P0 = newestFirst[0];
		const { subByPeriod, totalByPeriod } = agg;
		const piso = 0.03 * (totalByPeriod.get(P0) ?? 0);
		const keys = new Set<string>();
		for (const p of newestFirst) { const m = subByPeriod.get(p); if (m) for (const k of m.keys()) keys.add(k); }
		const val = (p: string, k: string) => subByPeriod.get(p)?.get(k) ?? 0;
		type Mover = { scid: number | null; nombre: string; ratio: number; pct: number | null; nuevo: boolean };
		const movers: Mover[] = [];
		for (const k of keys) {
			const reciente = (val(newestFirst[0], k) + val(newestFirst[1], k)) / 2;
			const base = newestFirst.slice(2, 11).map((p) => val(p, k)).sort((a, b) => a - b);
			const baseline = base[4]; // mediana de 9
			if (Math.max(reciente, baseline) < piso) continue;
			let ratio: number, pct: number | null, nuevo = false;
			if (baseline > 0) { ratio = reciente / baseline; pct = (ratio - 1) * 100; }
			else if (reciente > 0) { ratio = Infinity; pct = null; nuevo = true; }
			else continue;
			movers.push({
				scid: k === 'null' ? null : Number(k),
				nombre: k === 'null' ? '(sin subcategoría)' : (subName.get(Number(k)) ?? ('#' + k)),
				ratio, pct, nuevo
			});
		}
		const subas = movers.filter((m) => m.ratio > 1).sort((a, b) => b.ratio - a.ratio).slice(0, 10);
		const bajas = movers.filter((m) => m.ratio < 1).sort((a, b) => a.ratio - b.ratio).slice(0, 10);
		return { insuficiente: false as const, subas, bajas };
	});

	const pct = (n: number) => n.toFixed(1) + '%';
	// Etiqueta del mover: variación relativa reciente vs baseline, o "nuevo" si el
	// baseline era cero (apareció desde base nula).
	const fmtRatio = (m: { pct: number | null; nuevo: boolean }) =>
		m.nuevo ? 'nuevo' : (m.pct! >= 0 ? '+' : '') + m.pct!.toFixed(1) + '%';
	// Paleta por barra de período (n-2, n-1, n): de tenue a acento.
	const BAR = ['#94a0b8', '#5b9dff', '#e8975b'];
</script>

<div class="titulo-guia">
	<h1>Análisis por categoría</h1>
	<Guia clave="analisis-categoria" texto="Compará tus categorías de gasto: qué pesa más en cada período y cómo se reparte por subcategoría (tocá una categoría para desplegarla), y qué subcategorías crecieron o cayeron. En pesos reales (ajustados por inflación) o nominales." />
</div>
{@render nav?.()}

{#if cargando}
	<div class="sk-chart"><Skeleton w="100%" h="clamp(150px, 42vw, 300px)" /></div>
{:else}
	<div class="toggle-modo">
		<button class:activo={modoLocal === 'real'} onclick={() => (modoLocal = 'real')}>Pesos reales</button>
		<button class:activo={modoLocal === 'nominal'} onclick={() => (modoLocal = 'nominal')}>Pesos nominales</button>
	</div>

	<!-- Visual 1: barras por categoría con desglose de subcategorías in-place -->
	<h2>Peso de cada categoría</h2>
	<p class="aclara">Cada barra es el % que la categoría representó del gasto total de ese período. Ordenadas por peso del mes actual. Tocá una categoría para ver sus subcategorías.</p>
	{#if v1 && v1.rows.length}
		<div class="leyenda-periodos">
			{#each v1.periodos as p, i (p)}<span class="leg"><span class="sw" style="background:{BAR[i]}"></span>{mesCorto(p)}</span>{/each}
		</div>
		<div class="v1">
			{#each v1.rows as r (r.catId)}
				<button type="button" class="v1-row v1-click" class:abierto={expandido === r.catId}
						aria-expanded={expandido === r.catId}
						onclick={() => (expandido = expandido === r.catId ? null : r.catId)}>
					<span class="v1-cat"><span class="v1-caret">{expandido === r.catId ? '▾' : '▸'}</span>{r.nombre}</span>
					<div class="v1-bars">
						{#each r.barras as b, i}
							<div class="v1-bar-wrap"><div class="v1-bar" style="width:{Math.max(b, 0)}%; background:{BAR[i]}"></div><span class="v1-pct">{pct(b)}</span></div>
						{/each}
					</div>
				</button>
				{#if expandido === r.catId && desglose}
					<div class="v1-desglose">
						<p class="desg-hint">Subcategorías de {r.nombre} — % del gasto total del período</p>
						{#if desglose.length}
							{#each desglose as s (s.nombre)}
								<div class="v1-row sub">
									<span class="v1-cat">{s.nombre}</span>
									<div class="v1-bars">
										{#each s.barras as b, i}
											<div class="v1-bar-wrap"><div class="v1-bar" style="width:{Math.max(b, 0)}%; background:{BAR[i]}; opacity:0.8"></div><span class="v1-pct">{pct(b)}</span></div>
										{/each}
									</div>
								</div>
							{/each}
						{:else}
							<p class="nota">Sin subcategorías cargadas en esta categoría.</p>
						{/if}
					</div>
				{/if}
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

	<!-- Visual 2 — Movers: anomalía reciente vs mediana móvil -->
	<h2>Subcategorías que más se movieron</h2>
	<p class="aclara">Últimos 2 períodos contra la mediana de los 9 anteriores, en {modoLocal === 'real' ? 'pesos reales' : 'pesos nominales'}. Detecta lo que se salió de lo habitual, sin sesgo por tamaño. Tocá una para verla en Evolución de Gastos.</p>
	{#if v3.insuficiente}
		<p class="nota">Hacen falta al menos 11 períodos con historial para detectar anomalías.</p>
	{:else}
		<div class="movers">
			<div class="mov-col">
				<h3 class="mov-tit up">▲ Subas</h3>
				{#if v3.subas.length}
					{#each v3.subas as m (m.nombre)}
						<button class="mov" class:click={m.scid != null} onclick={() => m.scid != null && irAGastos(m.scid)}>
							<span class="mov-nom">{m.nombre}</span><span class="mov-delta up">{fmtRatio(m)}</span>
						</button>
					{/each}
				{:else}<p class="nota">Sin subas relevantes.</p>{/if}
			</div>
			<div class="mov-col">
				<h3 class="mov-tit down">▼ Bajas</h3>
				{#if v3.bajas.length}
					{#each v3.bajas as m (m.nombre)}
						<button class="mov" class:click={m.scid != null} onclick={() => m.scid != null && irAGastos(m.scid)}>
							<span class="mov-nom">{m.nombre}</span><span class="mov-delta down">{fmtRatio(m)}</span>
						</button>
					{/each}
				{:else}<p class="nota">Sin bajas relevantes.</p>{/if}
			</div>
		</div>
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

	.v1 { display: flex; flex-direction: column; gap: 10px; }
	.v1-row { display: grid; grid-template-columns: 34% 1fr; gap: 8px; align-items: center; }
	.v1-click { background: none; border: none; padding: 4px 0; font: inherit; color: inherit; text-align: left; cursor: pointer; width: 100%; border-radius: 6px; }
	.v1-click:hover .v1-cat { color: var(--accent); }
	.v1-caret { color: var(--text-dim); font-size: 0.7rem; margin-right: 5px; display: inline-block; width: 10px; }
	.v1-cat { font-size: 0.85rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.v1-row.otros .v1-cat { color: var(--text-dim); font-weight: 400; }
	.v1-bars { display: flex; flex-direction: column; gap: 3px; }
	.v1-bar-wrap { display: flex; align-items: center; gap: 6px; }
	.v1-bar { height: 10px; border-radius: 3px; min-width: 1px; transition: width 0.4s ease; }
	.v1-pct { font-size: 0.72rem; color: var(--text-dim); white-space: nowrap; }
	.v1-desglose { margin: -2px 0 2px; padding: 6px 0 8px 16px; border-left: 2px solid var(--border); display: flex; flex-direction: column; gap: 6px; }
	.desg-hint { font-size: 0.72rem; color: var(--text-dim); margin: 0 0 2px; }
	.v1-row.sub .v1-cat { font-weight: 400; font-size: 0.8rem; color: var(--text-dim); }
	.v1-row.sub .v1-bar { height: 8px; }

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
	@media (max-width: 520px) { .movers { grid-template-columns: 1fr; } .v1-row { grid-template-columns: 40% 1fr; } }
</style>

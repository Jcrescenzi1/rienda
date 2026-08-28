<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import { setMeta } from '$lib/db/meta';
	import { cargarModo, cargarCortes, crearAsignador, secuenciaPeriodos, type ModoPeriodo } from '$lib/periodo';
	import { cargarIPC, fmtMoneda, type IPC } from '$lib/moneda';
	import { mesActual, mesCorto, soloNum } from '$lib/format';
	import Guia from '$lib/Guia.svelte';
	import NotaVisual from '$lib/NotaVisual.svelte';
	import Skeleton from '$lib/Skeleton.svelte';
	import type { Snippet } from 'svelte';

	// Ver Gastos.svelte: `nav` se renderiza debajo del título (Brief H / B5).
	let { nav }: { nav?: Snippet } = $props();

	// Capacidad de ahorro: tasa de ahorro NETO / ingreso regular contra un objetivo
	// editable, por MONEDA separada (ARS pesos reales, USD nominal, sin cruzar), a 12
	// períodos fijos. Hermana de Poder adquisitivo (marco fijo, sin toggle de moneda).
	// Ahorro neto = ahorro bruto (categorías es_ahorro) − desahorro (categoría
	// 'Desahorro'), neteado dentro de cada moneda. Depende del Brief 6.

	type Mov = { fecha: string; monto: number; moneda: string };
	type MovP = { periodo: string; fecha: string; monto: number; moneda: string };

	let cargando = $state(true);
	let ahorroRows = $state<Mov[]>([]);       // gastos es_ahorro (asignados por corte)
	let desahorroRows = $state<MovP[]>([]);   // ingresos categoria='Desahorro'
	let regularRows = $state<MovP[]>([]);     // ingresos regulares (Sueldo, Principal/Secundarios)
	let ipc = $state<IPC>({ indice: {}, ultimoPeriodo: null, factorAHoy: () => 1 });
	let asignar = $state<(fecha: string) => string | null>(() => null);
	let modoPeriodo = $state<ModoPeriodo>('sueldo');
	let cortePeriodos = $state<string[]>([]);

	// Targets sticky (meta). ARS = MISMA clave que el umbral del Brief 1 (fuente única).
	// USD = clave propia. Default 0.10 (10%) para ambos.
	let targetARS = $state(0.10);
	let targetUSD = $state(0.10);

	// Estado de edición inline de la tarjeta "Objetivo" (patrón .cardval/.cardedit),
	// compartido por ambos bloques (ARS/USD) vía el snippet `bloque`.
	let editObj = $state<'ARS' | 'USD' | null>(null);
	let editObjVal = $state('');

	onMount(async () => {
		const [, cortes, ic, ah, des, reg, mARS, mUSD] = await Promise.all([
			(async () => {})(),
			(async () => { modoPeriodo = await cargarModo(); return modoPeriodo === 'sueldo' ? await cargarCortes() : []; })(),
			cargarIPC(),
			query(
				`SELECT g.fecha, g.monto, g.moneda
				 FROM gasto g JOIN categoria c ON c.id = g.categoria_id
				 WHERE g.perfil_id=1 AND c.es_ahorro=1`
			),
			query("SELECT periodo, fecha, monto, moneda FROM ingreso WHERE perfil_id=1 AND categoria='Desahorro' AND periodo IS NOT NULL"),
			query(
				`SELECT periodo, fecha, monto, moneda FROM ingreso
				 WHERE perfil_id=1 AND tipo='Sueldo'
				   AND categoria IN ('Ingreso Principal','Ingresos Secundarios') AND periodo IS NOT NULL`
			),
			query("SELECT valor FROM meta WHERE clave='umbral_ahorro'"),
			query("SELECT valor FROM meta WHERE clave='umbral_ahorro_usd'")
		]);
		asignar = crearAsignador(modoPeriodo, cortes as any);
		cortePeriodos = (cortes as any[]).map((c) => c.periodo);
		ipc = ic;
		ahorroRows = ah as any[]; desahorroRows = des as any[]; regularRows = reg as any[];
		const va = (mARS as any[])[0]?.valor, vu = (mUSD as any[])[0]?.valor;
		targetARS = va != null ? (parseFloat(va) || 0.10) : 0.10;
		targetUSD = vu != null ? (parseFloat(vu) || 0.10) : 0.10;
		cargando = false;
	});

	// mesCorto viene de $lib/format (helper único, Brief H / A2).

	// Ventana FIJA: últimos 12 períodos del enumerador de la app (sin toggle).
	let periodosDato = $derived.by(() => {
		const s = new Set<string>();
		for (const g of ahorroRows) { const p = asignar(g.fecha); if (p) s.add(p); }
		for (const r of regularRows) s.add(r.periodo);
		return [...s].sort();
	});
	let ventana = $derived.by(() => {
		if (!periodosDato.length) return [] as string[];
		const seq = secuenciaPeriodos('ult12', {
			modo: modoPeriodo, cortePeriodos,
			primerDato: periodosDato[0] ?? null, actual: mesActual(), anio: mesActual().slice(0, 4)
		});
		return seq.slice(-12);
	});

	// Valor en la moneda pedida: ARS ajustado a pesos reales (IPC del mes del
	// movimiento); USD nominal (el IPC argentino no aplica a dólares). NO cruza monedas.
	const valReal = (r: { monto: number; moneda: string; fecha: string }, mon: 'ARS' | 'USD') =>
		r.moneda !== mon ? 0 : (mon === 'ARS' ? r.monto * ipc.factorAHoy(r.fecha.slice(0, 7)) : r.monto);

	// Agrega por período y moneda para las 3 fuentes.
	function agregar(mon: 'ARS' | 'USD') {
		const ahorro = new Map<string, number>(), desah = new Map<string, number>(), reg = new Map<string, number>();
		for (const g of ahorroRows) { const p = asignar(g.fecha); if (p) ahorro.set(p, (ahorro.get(p) ?? 0) + valReal(g, mon)); }
		for (const r of desahorroRows) desah.set(r.periodo, (desah.get(r.periodo) ?? 0) + valReal(r, mon));
		for (const r of regularRows) reg.set(r.periodo, (reg.get(r.periodo) ?? 0) + valReal(r, mon));
		return { ahorro, desah, reg };
	}

	// Serie por moneda: neto, ingreso regular, target en monto, tasa, estado.
	function serieDe(mon: 'ARS' | 'USD', target: number) {
		const { ahorro, desah, reg } = agregar(mon);
		return ventana.map((p) => {
			const ingReg = reg.get(p) ?? 0;
			const ahBruto = ahorro.get(p) ?? 0;
			const neto = ahBruto - (desah.get(p) ?? 0);
			const targetMonto = ingReg * target;
			if (ingReg <= 0) return { periodo: p, sinDato: true, neto: 0, ingReg: 0, targetMonto: 0, tasa: 0, sinAhorro: false, estado: 'sindato' as const };
			const tasa = neto / ingReg;
			// Semáforo por % de cumplimiento del target (cortes sobre neto/target).
			const ratio = targetMonto > 0 ? neto / targetMonto : (neto > 0 ? 1 : 0);
			let estado: 'ok' | 'warn' | 'bad' | 'sindato';
			if (neto < 0) estado = 'bad';
			else if (ratio >= 0.9) estado = 'ok';
			else if (ratio >= 0.5) estado = 'warn';
			else estado = 'bad';
			return { periodo: p, sinDato: false, neto, ingReg, targetMonto, tasa, estado };
		});
	}

	// ¿Hay ingreso regular USD en la ventana? Si no, no se muestra nada de dólares
	// (evita además la división por cero en USD).
	let hayUSD = $derived.by(() => {
		if (!ventana.length) return false;
		const set = new Set(ventana);
		for (const r of regularRows) if (r.moneda === 'USD' && set.has(r.periodo)) return true;
		return false;
	});

	let serieARS = $derived.by(() => serieDe('ARS', targetARS));
	let serieUSD = $derived.by(() => (hayUSD ? serieDe('USD', targetUSD) : []));

	function resumen(serie: ReturnType<typeof serieDe>, target: number) {
		const conDato = serie.filter((s) => !s.sinDato);
		const cumplidos = conDato.filter((s) => s.neto >= s.targetMonto && s.neto >= 0).length;
		const tasaProm = conDato.length ? conDato.reduce((a, s) => a + s.tasa, 0) / conDato.length : 0;
		return { m: conDato.length, cumplidos, tasaProm, target };
	}
	let resARS = $derived(resumen(serieARS, targetARS));
	let resUSD = $derived(hayUSD ? resumen(serieUSD, targetUSD) : { m: 0, cumplidos: 0, tasaProm: 0, target: targetUSD });

	// ===== Gráfico de barras (neto vs target, base cero, soporta negativo) =====
	const W = 720, H = 450, P = { l: 56, r: 16, t: 18, b: 30 };
	function chart(serie: ReturnType<typeof serieDe>) {
		const withData = serie.filter((s) => !s.sinDato);
		if (!withData.length) return null;
		const vals = withData.flatMap((s) => [s.neto, s.targetMonto]);
		let minY = Math.min(0, ...vals), maxY = Math.max(...vals, 1);
		const pad = (maxY - minY) * 0.12 || 1; maxY += pad; if (minY < 0) minY -= pad;
		const n = serie.length;
		const innerW = W - P.l - P.r;
		const grupoW = innerW / n;
		const barW = Math.min(30, grupoW * 0.5);
		const py = (y: number) => H - P.b - ((y - minY) / (maxY - minY)) * (H - P.t - P.b);
		const y0 = py(0);
		const bars = serie.map((s, i) => {
			const cx = P.l + grupoW * i + grupoW / 2;
			const yv = py(s.neto);
			return {
				cx, x: cx - barW / 2, w: barW,
				y: Math.min(yv, y0), h: Math.abs(yv - y0),
				targetY: py(s.targetMonto), estado: s.estado, sinDato: s.sinDato,
				tasa: s.tasa, periodo: s.periodo
			};
		});
		const yticks = Array.from({ length: 4 }, (_, k) => { const v = minY + ((maxY - minY) * k) / 3; return { y: py(v), label: fmtNum(v) }; });
		return { bars, y0, yticks, barW };
	}
	let chartARS = $derived.by(() => chart(serieARS));
	let chartUSD = $derived.by(() => (hayUSD ? chart(serieUSD) : null));

	function fmtNum(v: number): string {
		const a = Math.abs(v);
		if (a >= 1000) return Math.round(v / 1000).toLocaleString('es-AR') + 'm';
		return Math.round(v).toString();
	}
	const pctTasa = (n: number) => (n * 100).toFixed(1) + '%';

	async function guardarTargetARS(v: string) {
		let p = parseFloat(v); if (!Number.isFinite(p)) return;
		p = Math.max(0, Math.min(100, p)); targetARS = p / 100; await setMeta('umbral_ahorro', String(targetARS));
	}
	async function guardarTargetUSD(v: string) {
		let p = parseFloat(v); if (!Number.isFinite(p)) return;
		p = Math.max(0, Math.min(100, p)); targetUSD = p / 100; await setMeta('umbral_ahorro_usd', String(targetUSD));
	}

</script>

<div class="titulo-guia">
	<h1>Capacidad de ahorro</h1>
	<Guia
		clave="capacidad-ahorro"
		para="Medir cuánto de tu ingreso estás ahorrando y si llegás a tu objetivo."
		uso="Editá el objetivo en % por moneda: el histórico se repinta contra la vara nueva. Pesos y dólares se miden por separado, cada uno contra su propio ingreso regular."
	/>
</div>
{@render nav?.()}

{#if cargando}
	<div class="sk-chart"><Skeleton w="100%" h="clamp(150px, 42vw, 300px)" /></div>
{:else if !ventana.length}
	<p class="nota">Todavía no hay períodos con ingreso o ahorro cargado para mostrar.</p>
{:else}
	{#snippet bloque(titulo: string, mon: 'ARS' | 'USD', serie: ReturnType<typeof serieDe>, ch: ReturnType<typeof chart>, res: { m: number; cumplidos: number; tasaProm: number; target: number }, target: number, guardar: (v: string) => void)}
		<div class="bloque">
			<div class="bloque-head">
				<h2>{titulo}</h2>
			</div>
			<p class="nota">Expresado como % de tu ingreso regular.</p>
			<div class="resumen">
				<div class="card"><span>Meses cumplidos</span><strong>{res.cumplidos} de {res.m}</strong></div>
				<div class="card"><span>Tasa promedio del rango</span><strong>{pctTasa(res.tasaProm)}</strong></div>
				<div class="card">
					<span>% Objetivo</span>
					{#if editObj === mon}
						<div class="cardedit">
							<input type="text" inputmode="decimal" use:soloNum bind:value={editObjVal} onkeydown={(e) => { if (e.key === 'Enter') { guardar(editObjVal); editObj = null; } }} />
							<button aria-label="Guardar" class="okp" onclick={() => { guardar(editObjVal); editObj = null; }}>✓</button>
							<button aria-label="Cancelar" class="cancp" onclick={() => (editObj = null)}>✕</button>
						</div>
					{:else}
						<div class="cardval">
							<strong>{pctTasa(target)}</strong>
							<button aria-label="Editar" class="lapiz" onclick={() => { editObj = mon; editObjVal = String(Math.round(target * 100)); }} title="Editar objetivo para {mon}">✏</button>
						</div>
					{/if}
				</div>
			</div>
			<div class="leyenda">
				<span class="leg"><span class="sw ok"></span> ≥90% del objetivo</span>
				<span class="leg"><span class="sw warn"></span> 50–90%</span>
				<span class="leg"><span class="sw bad"></span> &lt;50% o negativo</span>
				<span class="leg"><span class="sw-tick"></span> objetivo</span>
			</div>
			{#if ch}
				<svg viewBox="0 0 {W} {H}" class="chart">
					{#each ch.yticks as t}
						<line x1={P.l} y1={t.y} x2={W - P.r} y2={t.y} class="grid" />
						<text x={P.l - 6} y={t.y + 3} class="ylbl">{t.label}</text>
					{/each}
					<line x1={P.l} y1={ch.y0} x2={W - P.r} y2={ch.y0} class="zero" />
					{#each ch.bars as b, i}
						{#if b.sinDato}
							<rect x={b.x} y={ch.y0 - 10} width={b.w} height="10" class="bar sindato" />
							<text x={b.cx} y={ch.y0 - 14} class="sdlbl">s/d</text>
						{:else}
							<rect x={b.x} y={b.y} width={b.w} height={Math.max(b.h, 1)} class="bar {b.estado}" />
							<line x1={b.cx - b.w / 2 - 2} y1={b.targetY} x2={b.cx + b.w / 2 + 2} y2={b.targetY} class="tick" />
							<text x={b.cx} y={(serie[i].neto >= 0 ? b.y - 4 : b.y + b.h + 12)} class="vlbl {b.estado}">{pctTasa(b.tasa)}</text>
						{/if}
						<text x={b.cx} y={H - 10} class="xlbl">{mesCorto(b.periodo)}</text>
					{/each}
				</svg>
				<NotaVisual objetivo="Cuánto ahorraste cada mes contra tu objetivo">
					{#snippet muestra()}Una barra por período con tu <strong>ahorro neto</strong> en {mon}, y una marca horizontal con el objetivo de ese mes.{/snippet}
					{#snippet leer()}El color compara la barra contra su marca, no contra las otras barras: verde llegó al 90% del objetivo o más, amarillo entre 50 y 90, rojo por debajo o negativo. La marca se mueve mes a mes porque el objetivo es un % de tu ingreso regular, aunque el % sea fijo. <strong>s/d</strong> es un período sin ingreso regular en {mon}.{/snippet}
					{#snippet usar()}Ver en qué meses llegaste y en cuáles no, y ajustar el objetivo si quedó siempre fuera de alcance o siempre corto.{/snippet}
					{#snippet fuente()}{mon === 'ARS' ? 'Montos en pesos reales' : 'Montos en dólares nominales'}{mon === 'ARS' && ipc.ultimoPeriodo ? `, de ${mesCorto(ipc.ultimoPeriodo)}` : ''}.{/snippet}
				</NotaVisual>
			{:else}
				<p class="nota">No hay ingreso regular en {mon} en la ventana.</p>
			{/if}
		</div>
	{/snippet}

	{@render bloque('Ahorro en pesos', 'ARS', serieARS, chartARS, resARS, targetARS, guardarTargetARS)}

	{#if hayUSD}
		{@render bloque('Ahorro en dólares', 'USD', serieUSD, chartUSD, resUSD, targetUSD, guardarTargetUSD)}
	{/if}

	<NotaVisual objetivo="Cómo se calcula la tasa de ahorro">
		{#snippet muestra()}El criterio común de los bloques de arriba.{/snippet}
		{#snippet leer()}La tasa es tu ahorro neto dividido el ingreso regular de ese período, siempre dentro de la misma moneda —por eso el ajuste por inflación no mueve el porcentaje, mueve los dos números por igual—. El ahorro neto descuenta los desahorros del período.{/snippet}
		{#snippet usar()}Tener presente que cambiar el objetivo repinta todo el histórico visible: no cambia lo que ahorraste, cambia la vara contra la que se lo mide.{/snippet}
	</NotaVisual>
{/if}

<style>
	h2 { font-size: 1.02rem; margin: 0; border-left: 3px solid var(--accent); padding-left: 12px; }
	.bloque { margin-top: 22px; }
	.bloque-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
	.cardval { display: flex; align-items: center; gap: 6px; }
	.cardedit { display: flex; align-items: center; gap: 4px; }
	.cardedit input { width: 90px; padding: 3px 5px; font-size: 0.95rem; }
	.leyenda { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; font-size: 0.76rem; color: var(--text-dim); margin: 6px 0; }
	.leg { display: inline-flex; align-items: center; gap: 5px; }
	.sw { width: 12px; height: 10px; border-radius: 2px; display: inline-block; }
	.sw.ok { background: var(--pos); } .sw.warn { background: var(--warn); } .sw.bad { background: var(--neg); }
	.sw-tick { width: 14px; height: 0; border-top: 2px dashed var(--text); display: inline-block; }
	.chart { width: 100%; height: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
	.grid { stroke: var(--border); stroke-width: 1; }
	.zero { stroke: var(--text-dim); stroke-width: 1; }
	.ylbl { font-size: 13px; fill: var(--text-dim); text-anchor: end; }
	.xlbl { font-size: 13px; fill: var(--text-dim); text-anchor: middle; }
	.vlbl { font-size: 13px; font-weight: 600; text-anchor: middle; }
	.vlbl.ok { fill: var(--pos); } .vlbl.warn { fill: var(--warn); } .vlbl.bad { fill: var(--neg); }
	.sdlbl { font-size: 9px; fill: var(--text-dim); text-anchor: middle; }
	.bar.ok { fill: var(--pos); } .bar.warn { fill: var(--warn); } .bar.bad { fill: var(--neg); }
	.bar.sindato { fill: var(--surface-2); stroke: var(--border); stroke-dasharray: 3 2; }
	.tick { stroke: var(--text); stroke-width: 2; stroke-dasharray: 4 3; }
	.nota { font-size: 0.8rem; color: var(--text-dim); margin-top: 12px; }
	.sk-chart { margin-top: 12px; }

</style>

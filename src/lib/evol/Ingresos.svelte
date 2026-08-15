<script lang="ts">
	import { onMount } from 'svelte';
	import { query, queryBatch } from '$lib/db/client';
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
	import NotaVisual from '$lib/NotaVisual.svelte';
	import MultiSelect from '$lib/MultiSelect.svelte';
	import CountUp from '$lib/CountUp.svelte';
	import Skeleton from '$lib/Skeleton.svelte';
	import { progresoReplay } from '$lib/anim';
	import { cargarModo, cargarCortes, secuenciaPeriodos, type ModoPeriodo } from '$lib/periodo';
	import { parseNum, formatNum, soloNum, fmtFecha, mesActual, mesCorto, pesos, montoAGuardar } from '$lib/format';
	import type { Snippet } from 'svelte';

	// Ver Gastos.svelte: `nav` se renderiza debajo del título (Brief H / B5).
	let { nav }: { nav?: Snippet } = $props();

	type Ingreso = {
		fecha: string;
		monto: number;
		moneda: string;
		categoria: string;
		tipo: string | null;
		detalle: string | null;
		periodo: string;
		id: number;
	};

	let cargando = $state(true);
	let ingresos = $state<Ingreso[]>([]);
	let dolarSerie = $state<DolarSerie>([]);
	let ipc = $state<IPC>({ indice: {}, ultimoPeriodo: null, factorAHoy: () => 1 });
	let modoPeriodo = $state<ModoPeriodo>('sueldo');
	let cortePeriodos = $state<string[]>([]); // labels de cortes (eje en modo sueldo)

	const CATEGORIAS = ['Ingreso Principal', 'Ingresos Secundarios', 'Otros'];
	// Valor interno (DB) -> etiqueta visible. La lógica de períodos depende del valor
	// 'Sueldo', así que solo cambiamos lo que ve el usuario.
	const TIPOS = [
		{ v: 'Sueldo', l: 'Regular' },
		{ v: 'Aciclico', l: 'Extraordinario' }
	];
	const tipoLabel = (t: string | null) => (t === 'Sueldo' ? 'Regular' : t === 'Aciclico' ? 'Extraordinario' : 'Sin tipo');

	// Ventana de tiempo
	let vista = $state<'historico' | 'ult12' | 'anio'>('ult12');
	let anio = $state('');
	// Filtros dimensionales. Categoría es multi-select efímero: arranca con todas
	// (= "Todas"). catTodas = todo pasa (incluye ingresos con categoría fuera de la lista).
	let selCat = $state<Set<string>>(new Set(CATEGORIAS));
	let catTodas = $derived(selCat.size >= CATEGORIAS.length);
	let catOptions = CATEGORIAS.map((c) => ({ id: c, label: c }));
	let filtroTipo = $state('');
	let filtroTexto = $state('');

	onMount(async () => {
		const [, ds, ic, cortes] = await Promise.all([
			moneda.cargar(),
			cargarDolarSerie(),
			cargarIPC(),
			(async () => { modoPeriodo = await cargarModo(); return modoPeriodo === 'sueldo' ? await cargarCortes() : []; })(),
			cargarIngresos()
		]);
		dolarSerie = ds; ipc = ic;
		cortePeriodos = (cortes as any[]).map((c) => c.periodo);
		cargando = false;
	});

	async function cargarIngresos() {
		// Excluye 'Desahorro' (Brief 6): es uso de ahorro, no ingreso real; incluirlo
		// infla artificialmente el lado ingresos de esta vista (gráfico, dona, totales).
		ingresos = (await query(
			`SELECT id, fecha, monto, moneda, categoria, tipo, detalle, periodo
			 FROM ingreso WHERE perfil_id=1 AND periodo IS NOT NULL AND categoria != 'Desahorro' ORDER BY fecha`
		)) as any[];
	}

	// Ingresos que pasan los filtros dimensionales (categoría / tipo / detalle).
	let filtrados = $derived.by(() => {
		const txt = filtroTexto.trim().toLowerCase();
		return ingresos.filter((i) => {
			if (!catTodas && !selCat.has(i.categoria)) return false;
			if (filtroTipo && (i.tipo ?? '') !== filtroTipo) return false;
			if (txt && !(i.detalle ?? '').toLowerCase().includes(txt)) return false;
			return true;
		});
	});

	// Períodos disponibles y ventana de tiempo elegida (Histórico / Últimos 12 / Año).
	let periodosTodos = $derived([...new Set(filtrados.map((i) => i.periodo))].sort());
	let anios = $derived([...new Set(periodosTodos.map((p) => p.slice(0, 4)))].sort());
	$effect(() => { if (!anio && anios.length) anio = anios[anios.length - 1]; });
	// El eje sale de la VENTANA temporal (no de los períodos con dato): los períodos
	// sin ingreso se dibujan en cero. El dato se hace left-join en `serie`.
	let periodosVista = $derived.by(() =>
		secuenciaPeriodos(vista, {
			modo: modoPeriodo,
			cortePeriodos,
			primerDato: periodosTodos[0] ?? null,
			actual: mesActual(),
			anio
		})
	);
	let ventana = $derived(new Set(periodosVista));

	// Total por período (en el modo de moneda elegido), dentro de la ventana.
	let serie = $derived.by(() => {
		const acc: Record<string, number> = {};
		for (const i of filtrados) {
			if (!ventana.has(i.periodo)) continue;
			const v = convertir(i.monto, i.moneda, i.fecha, moneda.modo, dolarSerie, ipc);
			if (v == null) continue;
			acc[i.periodo] = (acc[i.periodo] ?? 0) + v;
		}
		return periodosVista.map((p) => ({ periodo: p, total: acc[p] ?? 0 }));
	});

	let totalRango = $derived(serie.reduce((s, x) => s + x.total, 0));
	let promedio = $derived(serie.length ? totalRango / serie.length : 0);
	// Período más reciente dentro de la ventana visible (serie va en orden ascendente).
	let ultimo = $derived(serie.length ? serie[serie.length - 1] : null);

	// mesCorto viene de $lib/format (helper único, Brief H / A2).

	// ===== Gráfico de área =====
	const W = 720, H = 300, P = { l: 56, r: 16, t: 16, b: 28 };
	let chart = $derived.by(() => {
		if (serie.length < 2) return null;
		const vals = serie.map((s) => s.total);
		const n = serie.length;
		let minY = Math.min(0, ...vals);
		let maxY = Math.max(...vals, 1);
		const padY = (maxY - minY) * 0.1 || 1;
		maxY += padY;
		const px = (i: number) => P.l + (i / (n - 1)) * (W - P.l - P.r);
		const py = (y: number) => H - P.b - ((y - minY) / (maxY - minY || 1)) * (H - P.t - P.b);
		const pts = serie.map((s, i) => ({ x: px(i), y: py(s.total) }));
		const line = pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
		const area = line + ` L${pts[n - 1].x.toFixed(1)},${py(0).toFixed(1)} L${pts[0].x.toFixed(1)},${py(0).toFixed(1)} Z`;
		const yticks = Array.from({ length: 4 }, (_, k) => {
			const v = minY + ((maxY - minY) * k) / 3;
			return { y: py(v), label: fmtNum(v) };
		});
		const step = Math.max(1, Math.floor(n / 8));
		const xticks = serie
			.map((s, i) => ({ i, p: s.periodo }))
			.filter((_, i) => i % step === 0)
			.map((o) => ({ x: px(o.i), label: mesCorto(o.p) }));
		return { line, area, pts, yticks, xticks };
	});

	// Selección por tap/drag sobre el gráfico: mientras se mantiene el toque, la
	// tarjeta de "Último período" muestra el valor del punto tocado; al soltar,
	// vuelve al último valor de la ventana. Promedio y Total no cambian.
	let tocando = $state(false);
	let puntoTacto = $state<number | null>(null);
	let snapTacto = $derived(puntoTacto != null ? serie[puntoTacto] : null);
	let valorMostrado = $derived(snapTacto ? snapTacto.total : ultimo?.total ?? 0);

	function indiceMasCercano(xViewBox: number): number | null {
		if (!chart) return null;
		let best = 0, bestD = Infinity;
		chart.pts.forEach((p, i) => { const d = Math.abs(p.x - xViewBox); if (d < bestD) { bestD = d; best = i; } });
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

	// Etiquetas de eje Y en miles con separador (8.725.000 -> "8.725m", 500.000 -> "500m").
	function fmtNum(v: number): string {
		const a = Math.abs(v);
		if (a >= 1000) return Math.round(v / 1000).toLocaleString('es-AR') + 'm';
		return Math.round(v).toString();
	}

	// Área: reveal de izquierda a derecha al montar y en cada cambio (incluye moneda).
	let sigArea = $derived(serie.map((s) => s.periodo + ':' + s.total).join('|'));
	const { p: pArea, replay: replayArea } = progresoReplay();
	$effect(() => { sigArea; replayArea(); });

	function limpiar() {
		vista = 'ult12';
		selCat = new Set(CATEGORIAS);
		filtroTipo = '';
		filtroTexto = '';
	}

	// ===== Tabla de registros editable (mismos filtros + ventana) =====
	let registros = $derived(
		filtrados
			.filter((i) => ventana.has(i.periodo))
			.slice()
			.sort((a, b) => b.fecha.localeCompare(a.fecha))
	);
	// Suma ARS/USD de los registros visibles (post-filtros), sin convertir — distinto
	// de la KPI "Total del rango", que sí está convertida a la lente de moneda elegida.
	let totalRegistrosARS = $derived(registros.filter((i) => i.moneda === 'ARS').reduce((s, i) => s + i.monto, 0));
	let totalRegistrosUSD = $derived(registros.filter((i) => i.moneda === 'USD').reduce((s, i) => s + i.monto, 0));
	// Alias al helper único de format.ts (ver Brief H / A1).
	const orig = pesos;

	let editId = $state<number | null>(null);
	let eFecha = $state(''), eMonto = $state(''), eMoneda = $state('ARS');
	// Monto original (precisión completa) al abrir la edición inline — ver
	// montoAGuardar (Brief H / B1): el prefill ahora se redondea a 0 decimales.
	let eMontoOriginal = $state<number | null>(null);
	let eCat = $state('Ingreso Principal'), eTipo = $state(''), eDetalle = $state(''), ePeriodo = $state('');
	let msgEd = $state('');
	// true solo para el error técnico del catch (Brief H / B3).
	let msgEdErr = $state(false);

	function editar(i: any) {
		editId = i.id; eFecha = i.fecha; eMonto = formatNum(i.monto, 0); eMontoOriginal = i.monto; eMoneda = i.moneda;
		eCat = i.categoria; eTipo = i.tipo ?? ''; eDetalle = i.detalle ?? ''; ePeriodo = i.periodo;
		msgEd = '';
	}
	const cancelar = () => (editId = null);
	async function guardarEd() {
		msgEdErr = false;
		const m = montoAGuardar(eMonto, eMontoOriginal);
		if (!eFecha) return (msgEd = 'Falta la fecha');
		if (!Number.isFinite(m) || m <= 0) return (msgEd = 'Monto inválido');
		if (!ePeriodo) return (msgEd = 'Falta el periodo');
		try {
			await query('UPDATE ingreso SET fecha=?, monto=?, moneda=?, categoria=?, tipo=?, detalle=?, periodo=? WHERE id=? AND perfil_id=1',
				[eFecha, m, eMoneda, eCat, eTipo || null, eDetalle.trim() || null, ePeriodo, editId]);
			editId = null;
			await cargarIngresos();
		} catch (e: any) { console.error(e); msgEdErr = true; msgEd = 'Ocurrió un error. Contactá al administrador.'; }
	}
	async function eliminar(id: number) {
		if (!confirm('¿Eliminar este ingreso? No se puede deshacer.')) return;
		// Borra el registro de ingreso fijo que lo referencia (si existe) y el
		// ingreso, en un batch atomico. Sin esto, un ingreso disparado desde un
		// fijo viola la FK ingreso_fijo_registro.ingreso_id (foreign_keys=ON) y el
		// DELETE falla en silencio (calca evol/Gastos, que ya lo hacia bien).
		await queryBatch([
			{ sql: 'DELETE FROM ingreso_fijo_registro WHERE ingreso_id=?', bind: [id] },
			{ sql: 'DELETE FROM ingreso WHERE id=? AND perfil_id=1', bind: [id] }
		]);
		await cargarIngresos();
	}
</script>

<div class="titulo-guia">
	<h1>Evolución de Ingresos</h1>
	<Guia
		clave="ingresos-evolucion"
		para="Ver si tu ingreso crece de verdad."
		uso="Filtrá por fecha, categoría, tipo o detalle, y pasá a pesos reales para descontar la inflación y no confundir un aumento nominal con uno real."
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
	<div class="resumen">
		<div class="card destacado"><span>Último período{snapTacto ? ` · ${mesCorto(snapTacto.periodo)}` : ultimo ? ` · ${mesCorto(ultimo.periodo)}` : ''}</span><strong><CountUp value={valorMostrado} format={(n) => fmtMoneda(n, moneda.modo)} /></strong></div>
		<div class="card"><span>Promedio por período</span><strong><CountUp value={promedio} format={(n) => fmtMoneda(n, moneda.modo)} /></strong></div>
		<div class="card"><span>Total del rango</span><strong><CountUp value={totalRango} format={(n) => fmtMoneda(n, moneda.modo)} /></strong></div>
	</div>

	<div class="vistas">
		<button class:activo={vista === 'historico'} onclick={() => (vista = 'historico')}>Histórico</button>
		<button class:activo={vista === 'ult12'} onclick={() => (vista = 'ult12')}>Últimos 12 meses</button>
		<button class:activo={vista === 'anio'} onclick={() => (vista = 'anio')}>Año calendario</button>
		{#if vista === 'anio'}
			<select bind:value={anio}>{#each anios as y (y)}<option value={y}>{y}</option>{/each}</select>
		{/if}
	</div>

	{#if chart}
		<svg viewBox="0 0 {W} {H}" class="chart tacto"
			role="img" aria-label="Evolución del ingreso por período"
			onpointerdown={iniciarTacto} onpointermove={moverTacto} onpointerup={soltarTacto} onpointercancel={soltarTacto}>
			<defs>
				<linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color="var(--accent)" stop-opacity="0.35" />
					<stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02" />
				</linearGradient>
				<clipPath id="reveal-ingresos"><rect x="0" y="0" width={W * $pArea} height={H} /></clipPath>
			</defs>
			{#each chart.yticks as t}
				<line x1={P.l} y1={t.y} x2={W - P.r} y2={t.y} class="grid" />
				<text x={P.l - 6} y={t.y + 3} class="ylbl">{t.label}</text>
			{/each}
			{#each chart.xticks as t}<text x={t.x} y={H - 8} class="xlbl">{t.label}</text>{/each}
			<g clip-path="url(#reveal-ingresos)">
				<path d={chart.area} fill="url(#areaGrad)" />
				<path d={chart.line} class="line-area" />
				{#each chart.pts as p}<circle cx={p.x} cy={p.y} r="2.5" class="dot-area" />{/each}
			</g>
			{#if puntoTacto != null}
				<line x1={chart.pts[puntoTacto].x} y1={P.t} x2={chart.pts[puntoTacto].x} y2={H - P.b} class="guia-tacto" />
				<circle cx={chart.pts[puntoTacto].x} cy={chart.pts[puntoTacto].y} r="5" class="dot-tacto" />
			{/if}
		</svg>
		<NotaVisual objetivo="Cómo evolucionó tu ingreso período a período" glosario="periodos">
			{#snippet muestra()}El ingreso total de cada período, con los filtros de abajo ya aplicados.{/snippet}
			{#snippet leer()}Cada cobro cuenta en el <strong>período que le asignaste</strong> al cargarlo, no en su fecha: por eso un sueldo cobrado a fin de mes puede figurar en el mes siguiente. Los períodos sin ingreso se dibujan en cero y bajan el promedio.{/snippet}
			{#snippet usar()}Ver si tu ingreso crece de verdad; pasá a pesos reales para descontar la inflación y no confundir un aumento nominal con uno real.{/snippet}
			{#snippet fuente()}{#if moneda.modo === 'real' && ipc.ultimoPeriodo}Expresado en pesos de {mesCorto(ipc.ultimoPeriodo)}, el último mes de inflación cargado.{:else}Montos nominales, tal como los cargaste.{/if}{/snippet}
		</NotaVisual>
	{:else}
		<p class="nota">Hacen falta al menos 2 períodos con datos para graficar la evolución. Ajustá los filtros.</p>
	{/if}

	<ToggleMoneda />

	<h2>Registros</h2><p class="nota">Editás el valor original cargado.</p>
	
	<div class="filtros">
		<label>Categoría
			<MultiSelect options={catOptions} selected={selCat} onchange={(s) => (selCat = s)} label="Categoría" />
		</label>
		<label>Tipo
			<select bind:value={filtroTipo}>
				<option value="">Todos</option>
				{#each TIPOS as t}<option value={t.v}>{t.l}</option>{/each}
			</select>
		</label>
		<label>Detalle <input type="text" bind:value={filtroTexto} placeholder="texto libre" /></label>
		<button class="btn btn-secondary" onclick={limpiar}>Limpiar</button>
	</div>

	
	{#if msgEd}<p class="msg-ed" class:err={msgEdErr}>{#if msgEdErr}<span class="err-x">✗</span> {/if}{msgEd}</p>{/if}
	<div class="fichas">
		{#each registros as i (i.id)}
			{#if editId === i.id}
				<div class="ficha edit">
					<div class="reg-grid">
						<label>Fecha<input type="date" bind:value={eFecha} /></label>
						<label>Monto<input type="text" inputmode="decimal" use:soloNum bind:value={eMonto} /></label>
						<label>Moneda<select bind:value={eMoneda}><option>ARS</option><option>USD</option></select></label>
						<label>Categoria<select bind:value={eCat}>{#each CATEGORIAS as c}<option value={c}>{c}</option>{/each}</select></label>
						<label>Tipo<select bind:value={eTipo}><option value="">Sin tipo</option>{#each TIPOS as t}<option value={t.v}>{t.l}</option>{/each}</select></label>
						<label>Periodo<input type="month" bind:value={ePeriodo} /></label>
						<label class="ancho">Detalle<input type="text" bind:value={eDetalle} /></label>
					</div>
					<div class="reg-acc">
						<button class="btn btn-primary" onclick={guardarEd}>Guardar</button>
						<button class="btn btn-secondary" onclick={cancelar}>Cancelar</button>
					</div>
				</div>
			{:else}
				<div class="ficha">
					<div class="reg-top">
						<span class="reg-det">{i.detalle ?? '(sin detalle)'}</span>
						<span class="reg-monto">{orig(i.monto, i.moneda)}</span>
					</div>
					<div class="reg-bot">
						<span class="reg-meta">{fmtFecha(i.fecha)} · {i.categoria} · {tipoLabel(i.tipo)} · {i.periodo}</span>
						<span class="reg-accs">
							<button aria-label="Editar" class="lapiz" onclick={() => editar(i)} title="Editar">✏</button>
							<button aria-label="Eliminar" class="del" onclick={() => eliminar(i.id)} title="Eliminar">✕</button>
						</span>
					</div>
				</div>
			{/if}
		{/each}
		{#if registros.length === 0}<p class="vacio">Sin registros para los filtros.</p>{/if}
	</div>
	{#if registros.length > 0}
		<div class="reg-total">
			<span>Total de los registros visibles</span>
			<strong>
				{#if totalRegistrosARS !== 0}{pesos(totalRegistrosARS, 'ARS')}{/if}
				{#if totalRegistrosARS !== 0 && totalRegistrosUSD !== 0} + {/if}
				{#if totalRegistrosUSD !== 0}{pesos(totalRegistrosUSD, 'USD')}{/if}
				{#if totalRegistrosARS === 0 && totalRegistrosUSD === 0}{pesos(0, 'ARS')}{/if}
			</strong>
		</div>
	{/if}
{/if}

<style>
	h2 { font-size: 1.02rem; margin-top: 26px; border-left: 3px solid var(--accent); padding-left: 12px; }
	.vistas { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0; align-items: center; }
	.sk-vistas { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0; }
	.sk-chart { margin-top: 12px; }
	.vistas select { padding: 5px 8px; }
	.filtros { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; margin: 8px 0; }
	.filtros label { display: flex; flex-direction: column; font-size: 0.75rem; color: var(--text-dim); gap: 3px; }
	.filtros input, .filtros select { padding: 6px 8px; font-size: 0.85rem; }

	.chart { width: 100%; height: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
	.chart.tacto { touch-action: none; cursor: crosshair; }
	.grid { stroke: var(--border); stroke-width: 1; }
	.ylbl { font-size: 10px; fill: var(--text-dim); text-anchor: end; }
	.xlbl { font-size: 10px; fill: var(--text-dim); text-anchor: middle; }
	.line-area { fill: none; stroke: var(--accent); stroke-width: 2.5; }
	.dot-area { fill: var(--accent); }
	.guia-tacto { stroke: var(--text-dim); stroke-width: 1; stroke-dasharray: 3 2; pointer-events: none; }
	.dot-tacto { fill: var(--accent); stroke: var(--surface); stroke-width: 2; pointer-events: none; }
	.nota { font-size: 0.8rem; color: var(--text-dim); margin-top: 12px; }

	.reg-total { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-top: 10px; padding: 9px 12px; border-top: 1px solid var(--border); font-size: 0.85rem; color: var(--text-dim); }
	.reg-total strong { color: var(--text); font-weight: 700; }
	.fichas { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
	/* Renombrado .reg -> .ficha: mismo patrón de tarjeta de registro que el resto
	   de la app (Brief H / A3) — antes esta pantalla lo llamaba distinto sin motivo. */
	.ficha { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 9px 12px; }
	.ficha.edit { border-color: var(--accent); background: rgba(91, 157, 255, 0.08); }
	.reg-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
	.reg-det { font-weight: 600; font-size: 0.92rem; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.reg-monto { font-weight: 700; white-space: nowrap; }
	.reg-bot { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 4px; }
	.reg-meta { font-size: 0.76rem; color: var(--text-dim); }
	.reg-accs { white-space: nowrap; flex-shrink: 0; }
	.reg-grid { display: flex; flex-wrap: wrap; gap: 8px; }
	.reg-grid label { display: flex; flex-direction: column; font-size: 0.72rem; color: var(--text-dim); gap: 2px; }
	.reg-grid label.ancho { flex: 1 1 100%; }
	.reg-grid input, .reg-grid select { padding: 5px; font-size: 0.9rem; }
	.reg-acc { display: flex; gap: 8px; margin-top: 8px; }
	.msg-ed { font-weight: 600; color: var(--text); }
	.msg-ed.err { color: var(--neg); display: flex; align-items: center; gap: 6px; }
	.msg-ed .err-x { font-size: 1.3em; line-height: 1; }
	.vacio { color: var(--text-dim); font-style: italic; }
</style>

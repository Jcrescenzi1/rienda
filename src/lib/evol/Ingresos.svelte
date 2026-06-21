<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
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
	import { parseNum, formatNum, soloNum, fmtFecha } from '$lib/format';

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

	const CATEGORIAS = ['Ingreso Principal', 'Ingresos Secundarios', 'Otros'];
	// Valor interno (DB) -> etiqueta visible. La lógica de períodos depende del valor
	// 'Sueldo', así que solo cambiamos lo que ve el usuario.
	const TIPOS = [
		{ v: 'Sueldo', l: 'Regular' },
		{ v: 'Aciclico', l: 'Extraordinario' }
	];
	const tipoLabel = (t: string | null) => (t === 'Sueldo' ? 'Regular' : t === 'Aciclico' ? 'Extraordinario' : 'Sin tipo');

	// Ventana de tiempo
	let vista = $state<'historico' | 'ult12' | 'anio'>('historico');
	let anio = $state('');
	// Filtros dimensionales
	let filtroCategoria = $state('');
	let filtroTipo = $state('');
	let filtroTexto = $state('');

	onMount(async () => {
		await moneda.cargar();
		dolarSerie = await cargarDolarSerie();
		ipc = await cargarIPC();
		await cargarIngresos();
		cargando = false;
	});

	async function cargarIngresos() {
		ingresos = (await query(
			`SELECT id, fecha, monto, moneda, categoria, tipo, detalle, periodo
			 FROM ingreso WHERE perfil_id=1 AND periodo IS NOT NULL ORDER BY fecha`
		)) as any[];
	}

	// Ingresos que pasan los filtros dimensionales (categoría / tipo / detalle).
	let filtrados = $derived.by(() => {
		const txt = filtroTexto.trim().toLowerCase();
		return ingresos.filter((i) => {
			if (filtroCategoria && i.categoria !== filtroCategoria) return false;
			if (filtroTipo && (i.tipo ?? '') !== filtroTipo) return false;
			if (txt && !(i.detalle ?? '').toLowerCase().includes(txt)) return false;
			return true;
		});
	});

	// Períodos disponibles y ventana de tiempo elegida (Histórico / Últimos 12 / Año).
	let periodosTodos = $derived([...new Set(filtrados.map((i) => i.periodo))].sort());
	let anios = $derived([...new Set(periodosTodos.map((p) => p.slice(0, 4)))].sort());
	$effect(() => { if (!anio && anios.length) anio = anios[anios.length - 1]; });
	let periodosVista = $derived.by(() => {
		if (vista === 'historico') return periodosTodos;
		if (vista === 'anio') return periodosTodos.filter((p) => p.startsWith(anio));
		return periodosTodos.slice(-12);
	});
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

	const MESES = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
	const mesCorto = (p: string) => {
		const [y, m] = p.split('-');
		return MESES[+m] + " '" + y.slice(2);
	};

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

	// Etiquetas de eje Y compactas (12.345 -> "12k", 1.200.000 -> "1.2M").
	function fmtNum(v: number): string {
		const a = Math.abs(v);
		if (a >= 1_000_000) return (v / 1_000_000).toFixed(1).replace('.0', '') + 'M';
		if (a >= 1000) return Math.round(v / 1000) + 'k';
		return Math.round(v).toString();
	}

	// ===== Dona por tipo (Sueldo / Acíclico) =====
	const PALETA = ['#5b9dff', '#e8975b', '#4ade80', '#f87171', '#c084fc', '#fbbf24', '#38bdf8', '#fb7185', '#a3e635', '#94a0b8'];
	let dona = $derived.by(() => {
		const acc: Record<string, number> = {};
		for (const i of filtrados) {
			if (!ventana.has(i.periodo)) continue;
			const v = convertir(i.monto, i.moneda, i.fecha, moneda.modo, dolarSerie, ipc);
			if (v == null || v <= 0) continue;
			const key = tipoLabel(i.tipo);
			acc[key] = (acc[key] ?? 0) + v;
		}
		const items = Object.entries(acc)
			.map(([cat, val]) => ({ cat, val }))
			.sort((a, b) => b.val - a.val);
		const total = items.reduce((s, x) => s + x.val, 0);
		if (total <= 0) return null;

		const cx = 90, cy = 90, r = 78, rIn = 46;

		// Una sola porción (~100%): el arco degenera; lo dibujamos como anillo completo.
		if (items.length === 1 || items[0].val / total >= 0.9999) {
			const it = items[0];
			return {
				cx, cy, total,
				anillo: { color: PALETA[0], rMid: (r + rIn) / 2, grosor: r - rIn },
				arcos: [{ d: '', color: PALETA[0], cat: it.cat, val: it.val, frac: 1 }]
			};
		}

		let ang = -Math.PI / 2; // arrancar arriba
		const arcos = items.map((it, i) => {
			const frac = it.val / total;
			const a0 = ang;
			const a1 = ang + frac * Math.PI * 2;
			ang = a1;
			const large = a1 - a0 > Math.PI ? 1 : 0;
			const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
			const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
			const xi0 = cx + rIn * Math.cos(a1), yi0 = cy + rIn * Math.sin(a1);
			const xi1 = cx + rIn * Math.cos(a0), yi1 = cy + rIn * Math.sin(a0);
			const d = `M${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)} L${xi0.toFixed(1)},${yi0.toFixed(1)} A${rIn},${rIn} 0 ${large} 0 ${xi1.toFixed(1)},${yi1.toFixed(1)} Z`;
			return { d, color: PALETA[i % PALETA.length], cat: it.cat, val: it.val, frac };
		});
		return { arcos, total, cx, cy, anillo: null as null | { color: string; rMid: number; grosor: number } };
	});

	function limpiar() {
		vista = 'historico';
		filtroCategoria = '';
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
	const orig = (n: number, mon: string) => (mon === 'USD' ? 'U$D ' : '$') + Math.round(n).toLocaleString('es-AR');

	let editId = $state<number | null>(null);
	let eFecha = $state(''), eMonto = $state(''), eMoneda = $state('ARS');
	let eCat = $state('Ingreso Principal'), eTipo = $state(''), eDetalle = $state(''), ePeriodo = $state('');
	let msgEd = $state('');

	function editar(i: any) {
		editId = i.id; eFecha = i.fecha; eMonto = formatNum(i.monto); eMoneda = i.moneda;
		eCat = i.categoria; eTipo = i.tipo ?? ''; eDetalle = i.detalle ?? ''; ePeriodo = i.periodo;
		msgEd = '';
	}
	const cancelar = () => (editId = null);
	async function guardarEd() {
		const m = parseNum(eMonto);
		if (!eFecha) return (msgEd = 'Falta la fecha');
		if (!Number.isFinite(m) || m <= 0) return (msgEd = 'Monto invalido');
		if (!ePeriodo) return (msgEd = 'Falta el periodo');
		try {
			await query('UPDATE ingreso SET fecha=?, monto=?, moneda=?, categoria=?, tipo=?, detalle=?, periodo=? WHERE id=? AND perfil_id=1',
				[eFecha, m, eMoneda, eCat, eTipo || null, eDetalle.trim() || null, ePeriodo, editId]);
			editId = null;
			await cargarIngresos();
		} catch (e: any) { msgEd = 'Error: ' + (e?.message ?? e); }
	}
	async function eliminar(id: number) {
		if (!confirm('Eliminar este ingreso? No se puede deshacer.')) return;
		await query('DELETE FROM ingreso WHERE id=? AND perfil_id=1', [id]);
		await cargarIngresos();
	}
</script>

<div class="titulo-guia">
	<h1>Evolución de Ingresos</h1>
	<Guia clave="ingresos-evolucion" texto="Cómo evolucionaron tus ingresos período a período, con la composición por tipo (Regular vs Extraordinario). Filtrá por fecha, categoría, tipo o detalle. Cambiá la moneda para ver en dólares, pesos reales (ajustados por inflación a hoy) o pesos nominales." />
</div>


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
	<div class="filtros">
		<label>Categoría
			<select bind:value={filtroCategoria}>
				<option value="">Todas</option>
				{#each CATEGORIAS as c}<option value={c}>{c}</option>{/each}
			</select>
		</label>
		<label>Tipo
			<select bind:value={filtroTipo}>
				<option value="">Todos</option>
				{#each TIPOS as t}<option value={t.v}>{t.l}</option>{/each}
			</select>
		</label>
		<label>Detalle <input type="text" bind:value={filtroTexto} placeholder="texto libre" /></label>
		<button class="limpiar" onclick={limpiar}>Limpiar</button>
	</div>

	<ToggleMoneda />

	<div class="resumen">
		<div class="card"><span>Total del rango</span><strong>{fmtMoneda(totalRango, moneda.modo)}</strong></div>
		<div class="card"><span>Promedio por período</span><strong>{fmtMoneda(promedio, moneda.modo)}</strong></div>
		<div class="card"><span>Períodos</span><strong>{serie.length}</strong></div>
	</div>

	<div class="leyenda">
		<span class="aclara">
			Por período de ingreso (el que asignaste a cada cobro).
			{#if moneda.modo === 'real' && ipc.ultimoPeriodo}Pesos de {mesCorto(ipc.ultimoPeriodo)} (último mes de inflación cargado).{/if}
		</span>
	</div>

	{#if chart}
		<svg viewBox="0 0 {W} {H}" class="chart">
			<defs>
				<linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color="var(--accent)" stop-opacity="0.35" />
					<stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02" />
				</linearGradient>
			</defs>
			{#each chart.yticks as t}
				<line x1={P.l} y1={t.y} x2={W - P.r} y2={t.y} class="grid" />
				<text x={P.l - 6} y={t.y + 3} class="ylbl">{t.label}</text>
			{/each}
			{#each chart.xticks as t}<text x={t.x} y={H - 8} class="xlbl">{t.label}</text>{/each}
			<path d={chart.area} fill="url(#areaGrad)" />
			<path d={chart.line} class="line-area" />
			{#each chart.pts as p}<circle cx={p.x} cy={p.y} r="2.5" class="dot-area" />{/each}
		</svg>
	{:else}
		<p class="nota">Hacen falta al menos 2 períodos con datos para graficar la evolución. Ajustá los filtros.</p>
	{/if}

	<h2>Composición por tipo</h2>
	{#if dona}
		<div class="dona-wrap">
			<svg viewBox="0 0 180 180" class="dona">
				{#if dona.anillo}
					<circle cx={dona.cx} cy={dona.cy} r={dona.anillo.rMid} fill="none" stroke={dona.anillo.color} stroke-width={dona.anillo.grosor} />
				{:else}
					{#each dona.arcos as a}<path d={a.d} fill={a.color} />{/each}
				{/if}
			</svg>
			<ul class="dona-leyenda">
				{#each dona.arcos as a}
					<li>
						<span class="sw" style="background:{a.color}"></span>
						<span class="cat">{a.cat}</span>
						<span class="val">{fmtMoneda(a.val, moneda.modo)}</span>
						<span class="pct">{(a.frac * 100).toFixed(1)}%</span>
					</li>
				{/each}
			</ul>
		</div>
	{:else}
		<p class="nota">No hay ingresos en el rango filtrado.</p>
	{/if}

	<h2>Registros</h2>
	<p class="nota">Editas el valor original cargado. El toggle de moneda solo afecta el grafico y la dona.</p>
	{#if msgEd}<p class="msg-ed">{msgEd}</p>{/if}
	<div class="regs">
		{#each registros as i (i.id)}
			{#if editId === i.id}
				<div class="reg edit">
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
						<button class="ok" onclick={guardarEd}>Guardar</button>
						<button class="sec" onclick={cancelar}>Cancelar</button>
					</div>
				</div>
			{:else}
				<div class="reg">
					<div class="reg-top">
						<span class="reg-det">{i.detalle ?? '(sin detalle)'}</span>
						<span class="reg-monto">{orig(i.monto, i.moneda)}</span>
					</div>
					<div class="reg-bot">
						<span class="reg-meta">{fmtFecha(i.fecha)} · {i.categoria} · {tipoLabel(i.tipo)} · {i.periodo}</span>
						<span class="reg-accs">
							<button class="lapiz" onclick={() => editar(i)} title="Editar">✏</button>
							<button class="del" onclick={() => eliminar(i.id)} title="Eliminar">✕</button>
						</span>
					</div>
				</div>
			{/if}
		{/each}
		{#if registros.length === 0}<p class="vacio">Sin registros para los filtros.</p>{/if}
	</div>
{/if}

<style>
	h2 { font-size: 1.05rem; margin-top: 24px; }
	.vistas { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0; align-items: center; }
	.vistas button { padding: 5px 12px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); border-radius: 20px; cursor: pointer; font-size: 0.82rem; }
	.vistas button.activo { background: var(--accent); color: #fff; border-color: var(--accent); }
	.vistas select { padding: 5px 8px; }
	.filtros { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; margin: 8px 0; }
	.filtros label { display: flex; flex-direction: column; font-size: 0.75rem; color: var(--text-dim); gap: 3px; }
	.filtros input, .filtros select { padding: 6px 8px; font-size: 0.85rem; }
	.limpiar { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 7px 12px; cursor: pointer; font-size: 0.8rem; height: 33px; }
	.resumen { display: flex; gap: 10px; flex-wrap: wrap; margin: 10px 0; }
	.card { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 8px 14px; display: flex; flex-direction: column; flex: 1; min-width: 140px; }
	.card span { font-size: 0.72rem; color: var(--text-dim); }
	.card strong { font-size: 1.05rem; }
	.leyenda { font-size: 0.8rem; color: var(--text-dim); margin: 6px 0; }
	.aclara { color: var(--text-dim); }
	.chart { width: 100%; height: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
	.grid { stroke: var(--border); stroke-width: 1; }
	.ylbl { font-size: 10px; fill: var(--text-dim); text-anchor: end; }
	.xlbl { font-size: 10px; fill: var(--text-dim); text-anchor: middle; }
	.line-area { fill: none; stroke: var(--accent); stroke-width: 2.5; }
	.dot-area { fill: var(--accent); }
	.nota { font-size: 0.8rem; color: var(--text-dim); margin-top: 12px; }
	.dona-wrap { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
	.dona { width: 180px; height: 180px; flex-shrink: 0; }
	.dona-leyenda { list-style: none; padding: 0; margin: 0; flex: 1; min-width: 220px; font-size: 0.85rem; }
	.dona-leyenda li { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
	.dona-leyenda .sw { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
	.dona-leyenda .cat { flex: 1; }
	.dona-leyenda .val { color: var(--text-dim); }
	.dona-leyenda .pct { width: 52px; text-align: right; font-weight: 600; }

	.regs { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
	.reg { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 9px 12px; }
	.reg.edit { border-color: var(--accent); background: rgba(91, 157, 255, 0.08); }
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
	.reg-acc .ok { background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
	.reg-acc .sec { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; cursor: pointer; }
	.lapiz { background: none; border: none; cursor: pointer; opacity: 0.6; }
	.lapiz:hover { opacity: 1; }
	.del { background: rgba(248, 113, 113, 0.15); color: var(--neg); border: none; border-radius: 5px; padding: 2px 8px; cursor: pointer; margin-left: 4px; }
	.msg-ed { font-weight: 600; color: var(--text); }
	.vacio { color: var(--text-dim); font-style: italic; }
</style>

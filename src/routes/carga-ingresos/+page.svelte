<script lang="ts">
	import { query, queryBatch } from '$lib/db/client';
	import { fmtFecha, hoyISO, parseNum, formatNum, calc, pesos as peso } from '$lib/format';
	import Guia from '$lib/Guia.svelte';
	import TabsCorrRec from '$lib/TabsCorrRec.svelte';
	import Calculadora from '$lib/Calculadora.svelte';
	import { periodoRegla } from '$lib/periodo';
	import { Toast } from '$lib/toast.svelte';

	let calcAbierto = $state(false);
	let ingresos = $state<any[]>([]);
	const toast = new Toast();

	// Filtros de la lista
	let filtroCategoria = $state<string>('');
	let filtroDesde = $state('');
	let filtroHasta = $state('');

	// Form
	let editandoId = $state<number | null>(null);
	let formAbierto = $state(false); // panel de alta/edicion colapsable (solo UI)
	let fecha = $state(hoyISO());
	let monto = $state('');
	let moneda = $state('ARS');
	let categoria = $state<'Ingreso Principal' | 'Ingresos Secundarios' | 'Otros' | 'Desahorro'>('Ingreso Principal');
	let tipo = $state<'Sueldo' | 'Aciclico'>('Sueldo');
	let detalle = $state('');
	let periodoIngreso = $state('');
	// En edición, no piso el período guardado salvo que el usuario toque fecha/categoría.
	let periodoTocado = $state(false);

	const esPrincipal = $derived(categoria === 'Ingreso Principal');


	// Recalcula el período sugerido al cambiar fecha o categoría.
	// En edición solo recalcula si el usuario tocó fecha/categoría (periodoTocado),
	// para no pisar un período ajustado a mano en una carga vieja.
	$effect(() => {
		const f = fecha;
		const c = categoria;
		if (editandoId !== null && !periodoTocado) return;
		periodoIngreso = periodoRegla(f, c);
	});

	async function cargar() {
		let sql = 'SELECT id, fecha, monto, moneda, categoria, tipo, detalle, periodo FROM ingreso WHERE perfil_id=1';
		const params: any[] = [];
		if (filtroCategoria) { sql += ' AND categoria = ?'; params.push(filtroCategoria); }
		if (filtroDesde) { sql += ' AND fecha >= ?'; params.push(filtroDesde); }
		if (filtroHasta) { sql += ' AND fecha <= ?'; params.push(filtroHasta); }
		sql += ' ORDER BY fecha DESC, id DESC';
		// Sin filtro de fechas, limito a los últimos 40. Con filtro activo, muestro el rango completo.
		if (!filtroDesde && !filtroHasta) sql += ' LIMIT 40';
		ingresos = (await query(sql, params)) as any[];
	}

	// Reactividad: al cambiar cualquier filtro, recargo la lista.
	// (También corre al montar, así que hace la carga inicial: sin onMount aparte.)
	$effect(() => {
		filtroCategoria; filtroDesde; filtroHasta;
		cargar();
	});

	function limpiarFiltros() {
		filtroCategoria = '';
		filtroDesde = '';
		filtroHasta = '';
	}

	function resetForm() {
		editandoId = null;
		periodoTocado = false;
		// La fecha NO se resetea: si cargaste o editaste un ingreso, la próxima
		// carga arranca con esa misma fecha. Al abrir la página, arranca en hoy.
		monto = '';
		moneda = 'ARS';
		categoria = 'Ingreso Principal';
		tipo = 'Sueldo';
		detalle = '';
		// el $effect recalcula periodoIngreso solo
	}

	function editar(i: any) {
		editandoId = i.id;
		periodoTocado = false; // respeta el período guardado hasta que toque fecha/cat
		fecha = i.fecha;
		monto = formatNum(i.monto);
		moneda = i.moneda;
		categoria = i.categoria;
		tipo = i.tipo === 'Aciclico' ? 'Aciclico' : 'Sueldo';
		detalle = i.detalle ?? '';
		periodoIngreso = i.periodo ?? periodoRegla(i.fecha, i.categoria);
		toast.limpiar();
		formAbierto = true;
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	async function guardar() {
		toast.limpiar();
		const m = parseNum(monto);
		if (!fecha) return toast.error('Falta la fecha');
		if (!Number.isFinite(m) || m <= 0) return toast.error('Monto inválido');
		if (!periodoIngreso) return toast.error('Falta el período');
		// tipo se guarda para todas las categorías; solo los Ingreso Principal
		// con tipo Regular (Sueldo) marcan los cortes de período.
		const t = tipo;
		const det = detalle.trim() || null;
		try {
			if (editandoId) {
				await query(
					'UPDATE ingreso SET fecha=?, monto=?, moneda=?, categoria=?, tipo=?, detalle=?, periodo=? WHERE id=? AND perfil_id=1',
					[fecha, m, moneda, categoria, t, det, periodoIngreso, editandoId]
				);
				toast.exito('Ingreso actualizado ✅');
			} else {
				await query(
					'INSERT INTO ingreso (perfil_id,fecha,monto,moneda,categoria,tipo,detalle,periodo) VALUES (1,?,?,?,?,?,?,?)',
					[fecha, m, moneda, categoria, t, det, periodoIngreso]
				);
				toast.exito('Ingreso guardado ✅');
			}
			resetForm();
			await cargar();
		} catch (e: any) {
			toast.error('Error: ' + (e?.message ?? String(e)));
		}
	}

	async function borrar(id: number) {
		if (!confirm('¿Eliminar este ingreso?')) return;
		if (editandoId === id) resetForm();
		// Borra el registro de ingreso fijo que lo referencia (si existe) y el
		// ingreso, en un batch atómico: evita el fallo de FK y el huérfano.
		await queryBatch([
			{ sql: 'DELETE FROM ingreso_fijo_registro WHERE ingreso_id=?', bind: [id] },
			{ sql: 'DELETE FROM ingreso WHERE id=? AND perfil_id=1', bind: [id] }
		]);
		await cargar();
	}

	// Etiqueta visible del tipo (interno Sueldo/Aciclico → Regular/Extraordinario)
	const tipoLabel = (t: string | null) => t === 'Sueldo' ? 'Regular' : t === 'Aciclico' ? 'Extraordinario' : '—';
	// Etiqueta visible de la categoría para la ficha
	const catLabel = (c: string) => c === 'Ingreso Principal' ? 'Principal' : c === 'Ingresos Secundarios' ? 'Secundario' : c === 'Desahorro' ? 'Desahorro' : 'Otros';
	// El período difiere del mes de la fecha de cobro (caso informativo)
	const periodoDifiere = (i: any) => i.periodo && i.periodo !== i.fecha?.slice(0, 7);

	// Texto del rango activo
	const rangoTexto = $derived(
		!filtroDesde && !filtroHasta ? 'Últimos 40 ingresos'
		: filtroDesde && filtroHasta ? `Del ${fmtFecha(filtroDesde)} al ${fmtFecha(filtroHasta)}`
		: filtroDesde ? `Desde ${fmtFecha(filtroDesde)} hasta hoy`
		: `Desde el inicio hasta ${fmtFecha(filtroHasta)}`
	);

	const hayFiltro = $derived(!!filtroCategoria || !!filtroDesde || !!filtroHasta);

	// Total de lo listado, separado por moneda (sin convertir). Refleja el filtro
	// activo: suma exactamente las fichas mostradas.
	const totales = $derived.by(() => {
		const t: Record<string, number> = {};
		for (const i of ingresos) t[i.moneda] = (t[i.moneda] ?? 0) + i.monto;
		return Object.entries(t).sort((a, b) => a[0].localeCompare(b[0]));
	});
</script>

<div class="titulo-guia">
	<h1>Ingresos</h1>
	<Guia clave="carga-ingresos" texto="El Ingreso Principal regular (tu sueldo) marca el ritmo de tus períodos; los demás ingresos se acomodan a ese mes. El período se sugiere solo según la fecha de cobro." />
</div>
<div class="cr-nav">
	<a href="/" class="btn-volver">← Volver a Cuenta Corriente</a>
	<TabsCorrRec activo="corriente" corriente="/carga-ingresos" recurrente="/ingresos-fijos" />
</div>

<details class="form-panel" bind:open={formAbierto}>
	<summary>{editandoId ? '✏ Editar ingreso' : '➕ Cargar ingreso'}</summary>
<div class="form">
	{#if editandoId}<p class="editando">✏ Editando ingreso #{editandoId} · <button class="link" onclick={resetForm}>cancelar</button></p>{/if}
	<label>Fecha<input type="date" bind:value={fecha} onchange={() => (periodoTocado = true)} /></label>
	<label>Monto<span class="monto-row"><input type="text" inputmode="decimal" use:calc bind:value={monto} placeholder="0,00" /><button type="button" class="calc-btn" onclick={() => (calcAbierto = true)} aria-label="Abrir calculadora" title="Calculadora"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="15" x2="8" y2="15"/><line x1="12" y1="15" x2="12" y2="15"/><line x1="16" y1="15" x2="16" y2="18"/></svg></button></span></label>
	<label>Moneda<select bind:value={moneda}><option>ARS</option><option>USD</option></select></label>

	<label>Categoría
		<select bind:value={categoria} onchange={() => (periodoTocado = true)}>
			<option value="Ingreso Principal">Ingreso Principal</option>
			<option value="Ingresos Secundarios">Ingresos Secundarios</option>
			<option value="Otros">Otros</option>
			<option value="Desahorro">Desahorro (uso de ahorro)</option>
		</select>
	</label>
	<p class="hint">El Ingreso Principal marca el ritmo de tus períodos. Secundarios y Otros se ajustan a ese mes. <strong>Desahorro</strong>: plata que sacás de tu ahorro para gastar este mes; suma a lo disponible pero no cuenta como ingreso en Evolución ni en tus ingresos regulares.</p>

	<label>Tipo de ingreso
		<select bind:value={tipo}>
			<option value="Sueldo">Regular</option>
			<option value="Aciclico">Extraordinario</option>
		</select>
	</label>
	<p class="hint">Regular: ingreso recurrente (sueldo, renta, alquiler). Extraordinario: cobros puntuales como aguinaldo, bonos o una venta.</p>

	<label>Período (mes al que pertenece)<input type="month" bind:value={periodoIngreso} /></label>
	<p class="hint">Sugerido según tu fecha de cobro. Podés cambiarlo.</p>

	<label>Detalle (opcional)<input bind:value={detalle} placeholder="Ej: Aguinaldo, Cochera, Dólares…" /></label>
	<button class="btn btn-primary" onclick={guardar}>{editandoId ? 'Actualizar ingreso' : 'Guardar ingreso'}</button>
	{#if toast.texto}<p class="msg">{toast.texto}</p>{/if}
</div>
</details>

<h2>Ingresos cargados</h2>
<div class="filtros">
	<label>Desde<input type="date" bind:value={filtroDesde} /></label>
	<label>Hasta<input type="date" bind:value={filtroHasta} /></label>
	<label>Categoría
		<select bind:value={filtroCategoria}>
			<option value="">Todas</option>
			<option value="Ingreso Principal">Principal</option>
			<option value="Ingresos Secundarios">Secundarios</option>
			<option value="Otros">Otros</option>
			<option value="Desahorro">Desahorro</option>
		</select>
	</label>
	{#if hayFiltro}<button class="btn btn-secondary" onclick={limpiarFiltros}>Limpiar</button>{/if}
</div>
<p class="rango">{rangoTexto}</p>
{#if totales.length}
	<div class="totales">
		{#each totales as [mon, tot] (mon)}
			<div class="total">Total {mon}: <strong>{peso(tot, mon)}</strong></div>
		{/each}
	</div>
{/if}

<div class="fichas">
	{#each ingresos as i (i.id)}
		<div class="ficha" class:destacado={i.categoria === 'Ingreso Principal' && i.tipo === 'Sueldo'} class:editrow={editandoId === i.id}>
			<div class="ficha-top">
				<span class="ficha-detalle">{i.detalle ?? '—'}</span>
				<span class="ficha-monto">{peso(i.monto, i.moneda)}</span>
			</div>
			<div class="ficha-bot">
				<span class="ficha-meta">
					{fmtFecha(i.fecha)} · {catLabel(i.categoria)} · {tipoLabel(i.tipo)}{#if periodoDifiere(i)} · período {i.periodo}{/if}
				</span>
				<span class="ficha-acc">
					<button aria-label="Editar" class="lapiz" onclick={() => editar(i)} title="Editar">✏</button>
					<button aria-label="Eliminar" class="del" onclick={() => borrar(i.id)} title="Eliminar">✕</button>
				</span>
			</div>
		</div>
	{/each}
	{#if ingresos.length === 0}<p class="vacio">No hay ingresos para los filtros seleccionados.</p>{/if}
</div>

<Calculadora abierto={calcAbierto} onConfirm={(v) => { monto = v; calcAbierto = false; }} onCerrar={() => (calcAbierto = false)} />

<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	h2 { font-size: 1.02rem; margin-top: 26px; border-left: 3px solid var(--accent); padding-left: 12px; }
	label { display: flex; flex-direction: column; font-size: 0.82rem; color: var(--text-dim); gap: 3px; }
	.monto-row { display: flex; gap: 6px; align-items: stretch; }
	.monto-row input { flex: 1; min-width: 0; }
	.calc-btn { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; padding: 0 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text-dim); border-radius: 6px; cursor: pointer; }
	.calc-btn:hover { color: var(--accent); border-color: var(--accent); }
	input, select { padding: 6px; font-size: 0.95rem; }
	.hint { font-size: 0.78rem; color: var(--text-dim); margin: 0; line-height: 1.35; }
	.editando { font-size: 0.85rem; color: var(--warn); background: rgba(251, 191, 36, 0.1); padding: 6px 10px; border-radius: 6px; margin: 0; }
	.form-panel { border: 1px solid var(--border); border-radius: 8px; background: var(--surface); margin: 12px 0; }
	.form-panel summary { cursor: pointer; padding: 11px 14px; font-family: var(--font-display); font-weight: 600; font-size: 0.92rem; color: var(--accent); list-style: none; }
	.form-panel summary::-webkit-details-marker { display: none; }
	.form-panel[open] summary { border-bottom: 1px solid var(--border); }
	.form-panel .form { background: none; border-color: transparent; border-radius: 0; margin: 0; padding: 12px 14px; }

	/* Filtros de la lista */
	.filtros { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end; margin: 8px 0; }
	.filtros label { flex: 1 1 140px; min-width: 0; }
	/* El input ocupa el 100% de su columna: los campos de fecha tienen ancho
	   mínimo propio y sin esto desbordan y se superponen en el celular. */
	.filtros input, .filtros select { width: 100%; min-width: 0; box-sizing: border-box; }
	.rango { font-size: 0.8rem; color: var(--text-dim); margin: 0 0 8px; font-weight: 600; }
	/* Total de lo listado, una línea por moneda (sin convertir) */
	.totales { display: flex; flex-wrap: wrap; gap: 4px 18px; margin: 0 0 10px; }
	.total { font-size: 0.9rem; color: var(--text-dim); font-weight: 600; }
	.total strong { color: var(--text); }

	/* Fichas de ingresos cargados */
	.fichas { display: flex; flex-direction: column; gap: 8px; }
	.ficha { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 10px 12px; border-left: 3px solid transparent; }
	/* Elemento firma del sistema de diseño: regla de acento a la izquierda, solo Principal+Regular */
	.ficha.destacado { border-left-color: var(--accent); }
	.ficha.editrow { border-color: var(--accent); background: rgba(91, 157, 255, 0.08); }
	.ficha-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
	.ficha-detalle { font-weight: 600; font-size: 0.95rem; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.ficha-monto { font-weight: 700; white-space: nowrap; flex-shrink: 0; }
	.ficha-bot { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 4px; }
	.ficha-meta { font-size: 0.78rem; color: var(--text-dim); line-height: 1.35; }
	.ficha-acc { white-space: nowrap; flex-shrink: 0; }
	.vacio { color: var(--text-dim); font-style: italic; }
	.msg { font-weight: 600; color: var(--text); }

	/* Nav superior de Corriente/Recurrente: volver + tabs (+ selector de periodo si aplica), apilados */
	.cr-nav { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; margin: 4px 0 14px; }
	.cr-nav :global(.btn-volver) { margin: 0; }
	.cr-nav :global(.sel) { margin: 0; }
</style>
<script lang="ts">
	import { onMount } from 'svelte';
	import { query, queryBatch } from '$lib/db/client';
	import { hoyISO, mesActual, parseNum, formatNum, soloNum } from '$lib/format';
	import { periodoRegla } from '$lib/periodo';
	import Guia from '$lib/Guia.svelte';

	let periodo = $state(mesActual());

	let fijos = $state<any[]>([]);
	let grupos = $state<any[]>([]);
	let registradas = $state<Record<number, boolean>>({});
	let fijoMesARS = $state(0);   // total de ingresos fijos activos del mes, en ARS (USD al MEP)
	let dolar = $state(0);

	let registrando = $state<number | null>(null);
	let dMonto = $state('');
	let dFecha = $state('');

	// Form unificado (alta + edicion). editId null = alta, numero = edicion.
	let editId = $state<number | null>(null);
	let fNombre = $state('');
	let fDetalle = $state('');
	let fMonto = $state('');
	let fMoneda = $state('ARS');
	let fCategoria = $state<'Ingreso Principal' | 'Ingresos Secundarios' | 'Otros'>('Ingreso Principal');
	let fTipo = $state<'Sueldo' | 'Aciclico'>('Sueldo');

	let mensaje = $state('');
	const editando = $derived(editId !== null);

	const ORDEN_CAT = ['Ingreso Principal', 'Ingresos Secundarios', 'Otros'];
	const catLabel = (c: string) =>
		c === 'Ingreso Principal' ? 'Principal' : c === 'Ingresos Secundarios' ? 'Secundarios' : 'Otros';
	const tipoLabel = (t: string) => (t === 'Sueldo' ? 'Regular' : 'Extraordinario');

	// MEP de referencia del periodo: cotizacion del primer dia del mes corriente
	// (ancla deterministica, igual que en Gastos Fijos).
	async function mepDelPeriodo(): Promise<number> {
		const r = (await query("SELECT valor FROM cotizacion_dolar WHERE perfil_id=1 AND casa='bolsa' AND fecha <= ? ORDER BY fecha DESC LIMIT 1", [mesActual() + '-01'])) as any[];
		return r[0]?.valor ?? 1;
	}

	async function cargar() {
		fijos = (await query(`
			SELECT id, nombre, detalle, monto, moneda, categoria, tipo, activa
			FROM ingreso_fijo WHERE perfil_id=1
			ORDER BY activa DESC, categoria, nombre`)) as any[];

		const reg = (await query('SELECT ingreso_fijo_id FROM ingreso_fijo_registro WHERE periodo=?', [periodo])) as any[];
		const r: Record<number, boolean> = {};
		for (const x of reg) r[x.ingreso_fijo_id] = true;
		registradas = r;

		dolar = await mepDelPeriodo();
		fijoMesARS = fijos
			.filter((s: any) => s.activa)
			.reduce((t: number, s: any) => t + (s.moneda === 'USD' ? s.monto * dolar : s.monto), 0);

		// Agrupar por categoria, en orden Principal -> Secundarios -> Otros.
		const map: Record<string, any[]> = {};
		for (const s of fijos) (map[s.categoria] ??= []).push(s);
		grupos = ORDEN_CAT.filter((c) => map[c]?.length).map((cat) => ({ cat, items: map[cat] }));
	}

	onMount(cargar);

	function resetForm() {
		editId = null;
		fNombre = '';
		fDetalle = '';
		fMonto = '';
		fMoneda = 'ARS';
		fCategoria = 'Ingreso Principal';
		fTipo = 'Sueldo';
	}

	function iniciarEdit(s: any) {
		editId = s.id;
		fNombre = s.nombre;
		fDetalle = s.detalle ?? '';
		fMonto = formatNum(s.monto);
		fMoneda = s.moneda;
		fCategoria = s.categoria;
		fTipo = s.tipo === 'Aciclico' ? 'Aciclico' : 'Sueldo';
		mensaje = '';
		window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
	}

	async function guardar() {
		mensaje = '';
		const m = parseNum(fMonto);
		if (!fNombre.trim()) return (mensaje = 'Falta el nombre');
		if (!Number.isFinite(m) || m <= 0) return (mensaje = 'Monto inválido');
		const detalle = fDetalle.trim() || null;
		try {
			if (editId) {
				await query('UPDATE ingreso_fijo SET nombre=?, detalle=?, monto=?, moneda=?, categoria=?, tipo=? WHERE id=? AND perfil_id=1',
					[fNombre.trim(), detalle, m, fMoneda, fCategoria, fTipo, editId]);
				mensaje = 'Ingreso fijo actualizado ✅';
			} else {
				await query('INSERT INTO ingreso_fijo (perfil_id,nombre,detalle,monto,moneda,categoria,tipo) VALUES (1,?,?,?,?,?,?)',
					[fNombre.trim(), detalle, m, fMoneda, fCategoria, fTipo]);
				mensaje = 'Ingreso fijo agregado ✅';
			}
			resetForm();
			await cargar();
		} catch (e: any) {
			mensaje = 'Error: ' + (e?.message ?? String(e));
		}
	}

	async function eliminar(s: any) {
		if (!confirm(`¿Eliminar el ingreso fijo "${s.nombre}"? (no borra los ingresos ya registrados)`)) return;
		await query('DELETE FROM ingreso_fijo_registro WHERE ingreso_fijo_id=?', [s.id]);
		await query('DELETE FROM ingreso_fijo WHERE id=? AND perfil_id=1', [s.id]);
		if (editId === s.id) resetForm();
		await cargar();
	}

	function iniciarRegistro(s: any) {
		registrando = s.id;
		dMonto = formatNum(s.monto);
		dFecha = periodo === mesActual() ? hoyISO() : periodo + '-01';
		mensaje = '';
	}
	async function confirmarRegistro(s: any) {
		const m = parseNum(dMonto);
		if (!Number.isFinite(m) || m <= 0) return (mensaje = 'Monto inválido');
		if (!dFecha) return (mensaje = 'Falta la fecha');
		try {
			// El ingreso hereda categoria y tipo del fijo; su periodo sale de la regla
			// del veinte sobre la fecha de cobro (misma funcion que la carga manual).
			// El registro guarda el mes del selector (guard de "Registrado"). Todo en
			// un batch atomico: si el registro choca con UNIQUE (re-disparo del mismo
			// mes), se revierte el ingreso y no queda huerfano.
			const det = s.detalle ?? s.nombre;
			const per = periodoRegla(dFecha, s.categoria);
			await queryBatch([
				{ sql: "INSERT INTO ingreso (perfil_id,fecha,monto,moneda,categoria,tipo,detalle,periodo) VALUES (1,?,?,?,?,?,?,?)",
				  bind: [dFecha, m, s.moneda, s.categoria, s.tipo, det, per] },
				{ sql: "INSERT INTO ingreso_fijo_registro (ingreso_fijo_id,ingreso_id,periodo) VALUES (?, last_insert_rowid(), ?)",
				  bind: [s.id, periodo] }
			]);
			registrando = null; mensaje = `"${s.nombre}" registrado (período ${per}) ✅`;
			await cargar();
		} catch (e: any) { mensaje = 'Error: ' + (e?.message ?? String(e)); }
	}

	const peso = (n: number, mon = 'ARS') => (mon === 'USD' ? 'U$D ' : '$') + Math.round(n || 0).toLocaleString('es-AR');
</script>

<div class="titulo-guia">
	<h1>Ingresos Fijos</h1>
	<Guia clave="ingresos-fijos" texto="Tus ingresos recurrentes (sueldo, alquiler, renta, freelance fijo). Solo lo que cobrás todos los meses. 'Registrar Ingreso' lo convierte en un ingreso real del mes elegido, con su categoría y tipo. Si tu sueldo (Principal + Regular) es fijo, registralo desde acá y no lo cargues además a mano el mismo mes." />
</div>

<a href="/" class="btn-volver">← Volver a Presupuesto</a>

<label class="sel">Mes / Año: <input type="month" bind:value={periodo} onchange={cargar} /></label>

<div class="fijo-total">
	<span>Ingreso fijo del mes</span>
	<strong>{peso(fijoMesARS)}</strong>
	<span class="fijo-nota">suma de todos los ingresos fijos activos (USD al MEP)</span>
</div>

<div class="grupos">
	{#each grupos as g (g.cat)}
		<div class="grupo-cat">{catLabel(g.cat)}</div>
		{#each g.items as s (s.id)}
			<div class="ficha" class:inactiva={!s.activa} class:editrow={editId === s.id}>
				<div class="ficha-top">
					<span class="ficha-nombre">{s.nombre}</span>
					<span class="ficha-monto">{peso(s.monto, s.moneda)}</span>
					<span class="ficha-acc">
						<button aria-label="Editar" class="lapiz" onclick={() => iniciarEdit(s)} title="Editar">✏</button>
						<button aria-label="Eliminar" class="del" onclick={() => eliminar(s)} title="Eliminar">✕</button>
					</span>
				</div>
				<div class="ficha-meta">
					<span class="chip">{tipoLabel(s.tipo)}</span>
				</div>
				<div class="ficha-estado">
					{#if !s.activa}
						<span class="dim">Inactivo</span>
					{:else if registradas[s.id]}
						<span class="ok">Registrado ✓</span>
					{:else if registrando === s.id}
						<span class="draft">
							<input type="text" inputmode="decimal" use:soloNum bind:value={dMonto} class="mini" />
							<input type="date" bind:value={dFecha} class="mini" />
							<button class="btn btn-primary" onclick={() => confirmarRegistro(s)}>Confirmar</button>
							<button class="btn btn-secondary" onclick={() => (registrando = null)}>Cancelar</button>
						</span>
					{:else}
						<button class="btn btn-primary" onclick={() => iniciarRegistro(s)}>Registrar Ingreso</button>
					{/if}
				</div>
			</div>
		{/each}
	{/each}
	{#if fijos.length === 0}<p class="vacio">No hay ingresos fijos. Agregá uno abajo.</p>{/if}
</div>
{#if mensaje}<p class="msg">{mensaje}</p>{/if}

<h2>{editando ? 'Editar ingreso fijo' : 'Agregar ingreso fijo'}</h2>
<div class="form" class:edit={editando}>
	{#if editando}<p class="editando">✏ Editando #{editId} · <button class="link" onclick={resetForm}>cancelar</button></p>{/if}
	<label>Nombre<input bind:value={fNombre} placeholder="Ej: Sueldo, Alquiler" /></label>
	<label>Detalle (como aparece en el ingreso)<input bind:value={fDetalle} placeholder="Ej: Sueldo empresa, Cochera" /></label>
	<label>Monto<input type="text" inputmode="decimal" use:soloNum bind:value={fMonto} placeholder="0,00" /></label>
	<label>Moneda<select bind:value={fMoneda}><option>ARS</option><option>USD</option></select></label>
	<label>Categoría<select bind:value={fCategoria}>
		<option value="Ingreso Principal">Ingreso Principal</option>
		<option value="Ingresos Secundarios">Ingresos Secundarios</option>
		<option value="Otros">Otros</option>
	</select></label>
	<p class="form-nota">El Ingreso Principal marca el ritmo de tus períodos (en modo sueldo). Secundarios y Otros se acomodan a ese mes.</p>
	<label>Tipo de ingreso<select bind:value={fTipo}>
		<option value="Sueldo">Regular</option>
		<option value="Aciclico">Extraordinario</option>
	</select></label>
	<p class="form-nota">Regular: recurrente (sueldo, alquiler, renta). Extraordinario: cobros puntuales.</p>
	<div class="botones">
		<button class="btn btn-primary" onclick={guardar}>{editando ? 'Guardar cambios' : 'Agregar'}</button>
		{#if editando}<button class="btn btn-secondary" onclick={resetForm}>Cancelar</button>{/if}
	</div>
</div>

<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	.sel { font-size: 0.9rem; display: inline-flex; flex-direction: row; gap: 8px; align-items: center; margin-top: 4px; }
	.fijo-total { display: flex; flex-direction: column; gap: 2px; border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 10px 14px; margin: 12px 0; }
	.fijo-total span { font-size: 0.75rem; color: var(--text-dim); }
	.fijo-total strong { font-size: 1.6rem; }
	.fijo-nota { font-size: 0.72rem !important; }
	h2 { font-size: 1.1rem; margin-top: 22px; }
	.form { display: flex; flex-direction: column; gap: 8px; max-width: 340px; }
	.form.edit { border: 1px solid var(--accent); border-radius: 8px; padding: 12px; background: var(--surface); }
	label { display: flex; flex-direction: column; font-size: 0.82rem; color: var(--text-dim); gap: 3px; }
	input, select { padding: 6px; font-size: 0.95rem; }
	input.mini { width: 110px; padding: 3px 5px; display: inline-block; }
	.botones { display: flex; gap: 8px; margin-top: 4px; }
	.form-nota { font-size: 0.76rem; color: var(--text-dim); margin: 2px 0 0; line-height: 1.35; }
	.editando { font-size: 0.85rem; color: var(--warn); background: rgba(251, 191, 36, 0.1); padding: 6px 10px; border-radius: 6px; margin: 0; }
	.draft { display: inline-flex; gap: 5px; align-items: center; flex-wrap: wrap; }
	.ok { color: var(--pos); font-weight: 600; font-size: 0.85rem; }
	.dim { color: var(--text-dim); font-size: 0.85rem; }
	.vacio { color: var(--text-dim); font-style: italic; }
	.msg { color: var(--text-dim); font-weight: 600; }

	.grupos { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
	.grupo-cat { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim); font-weight: 700; margin-top: 10px; padding-bottom: 2px; border-bottom: 1px solid var(--border); }
	.ficha { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 10px 12px; }
	.ficha.inactiva { opacity: 0.45; }
	.ficha.editrow { border-color: var(--accent); background: rgba(91, 157, 255, 0.08); }
	.ficha-top { display: flex; align-items: baseline; gap: 10px; }
	.ficha-nombre { font-weight: 600; font-size: 0.95rem; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.ficha-monto { font-weight: 700; white-space: nowrap; }
	.ficha-acc { white-space: nowrap; flex-shrink: 0; }
	.ficha-meta { font-size: 0.78rem; color: var(--text-dim); margin-top: 5px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
	.chip { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 999px; padding: 2px 9px; font-size: 0.76rem; }
	.ficha-estado { margin-top: 8px; }
</style>

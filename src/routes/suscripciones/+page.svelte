<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import { hoyISO, mesActual, parseNum, formatNum, soloNum } from '$lib/format';
	import { setMeta } from '$lib/db/meta';
	import Guia from '$lib/Guia.svelte';

	let periodo = $state(mesActual());

	let subs = $state<any[]>([]);
	let grupos = $state<any[]>([]);
	let categorias = $state<any[]>([]);
	let tarjetas = $state<any[]>([]);
	let subcategorias = $state<any[]>([]);
	// Subcategoria para TODOS los gastos disparados desde aca ('' = automatica, segun diccionario)
	let dispSubcatId = $state('');
	let registradas = $state<Record<number, boolean>>({});
	let fijoMesARS = $state(0);   // total de fijos activos del mes, en ARS (USD al MEP)
	let dolar = $state(0);

	let disparando = $state<number | null>(null);
	let dMonto = $state('');
	let dFecha = $state('');

	// Form unificado (alta + edicion). editId null = alta, numero = edicion.
	let editId = $state<number | null>(null);
	let fNombre = $state('');
	let fDetalle = $state('');
	let fMonto = $state('');
	let fMoneda = $state('ARS');
	let fCatId = $state<number | null>(null);
	let fSubcatId = $state('');
	let fTarjetaId = $state<number | null>(null);

	let mensaje = $state('');
	const editando = $derived(editId !== null);

	// MEP de referencia del periodo: cotizacion del primer dia del mes corriente.
	// Es una cotizacion historica fija -> el presupuesto de fijos USD NO flota
	// intra-mes; se actualiza recien al cambiar de mes (Item 3, ancla deterministica).
	async function mepDelPeriodo(): Promise<number> {
		const r = (await query("SELECT valor FROM cotizacion_dolar WHERE perfil_id=1 AND casa='bolsa' AND fecha <= ? ORDER BY fecha DESC LIMIT 1", [mesActual() + '-01'])) as any[];
		return r[0]?.valor ?? 1;
	}

	async function cargar() {
		categorias = await query('SELECT id, nombre FROM categoria WHERE perfil_id=1 AND activa=1 ORDER BY nombre');
		tarjetas = await query('SELECT id, nombre FROM tarjeta WHERE perfil_id=1 AND activa=1 ORDER BY nombre');
		subcategorias = await query('SELECT id, nombre FROM subcategoria WHERE perfil_id=1 AND activa=1 ORDER BY nombre');
		const sc = (await query("SELECT valor FROM meta WHERE clave='susc_subcat_id'")) as any[];
		dispSubcatId = sc[0]?.valor ?? '';
		if (fCatId == null) {
			const f = categorias.find((c: any) => c.nombre === 'Impuestos/Servicios');
			fCatId = f ? f.id : categorias[0]?.id ?? null;
		}
		// Fijos con su subcategoria resuelta por el diccionario (mapeo_detalle).
		subs = await query(`
			SELECT s.id, s.nombre, s.detalle, s.monto, s.moneda, s.activa,
			       s.categoria_id, c.nombre AS categoria, s.tarjeta_id, t.nombre AS tarjeta,
			       m.subcategoria_id AS scid, sc.nombre AS subcat
			FROM suscripcion s
			JOIN categoria c ON c.id = s.categoria_id
			LEFT JOIN tarjeta t ON t.id = s.tarjeta_id
			LEFT JOIN mapeo_detalle m ON m.perfil_id = 1 AND m.detalle = s.detalle
			LEFT JOIN subcategoria sc ON sc.id = m.subcategoria_id
			WHERE s.perfil_id = 1
			ORDER BY s.activa DESC, c.nombre, s.nombre`);
		const reg = (await query('SELECT suscripcion_id FROM suscripcion_registro WHERE periodo=?', [periodo])) as any[];
		const r: Record<number, boolean> = {};
		for (const x of reg) r[x.suscripcion_id] = true;
		registradas = r;

		// Dolar MEP para convertir los fijos en USD a ARS.
		dolar = await mepDelPeriodo();
		fijoMesARS = subs
			.filter((s: any) => s.activa)
			.reduce((t: number, s: any) => t + (s.moneda === 'USD' ? s.monto * dolar : s.monto), 0);

		// Agrupar por categoria (headers como separadores).
		const map: Record<string, any[]> = {};
		for (const s of subs) (map[s.categoria] ??= []).push(s);
		grupos = Object.keys(map)
			.sort((a, b) => a.localeCompare(b, 'es'))
			.map((cat) => ({ cat, items: map[cat] }));

		// Mantener el presupuesto autocompletado al dia.
		await recalcPresupuestoFijos();
	}

	onMount(cargar);

	// El presupuesto de cada subcat con pago fijo = suma de sus fijos (ARS, USD al
	// MEP). Se marca auto=1 y NO se edita desde la tabla de presupuesto. Fuente
	// unica de edicion: esta pantalla. Limpia los auto viejos en cada pasada.
	async function recalcPresupuestoFijos() {
		const dol = await mepDelPeriodo();
		const filas = (await query(`
			SELECT m.subcategoria_id AS scid, s.monto, s.moneda
			FROM suscripcion s
			JOIN mapeo_detalle m ON m.perfil_id = 1 AND m.detalle = s.detalle
			WHERE s.perfil_id = 1 AND s.activa = 1 AND m.subcategoria_id IS NOT NULL`)) as any[];
		const sum: Record<number, number> = {};
		for (const f of filas) {
			const ars = f.moneda === 'USD' ? f.monto * dol : f.monto;
			sum[f.scid] = (sum[f.scid] ?? 0) + ars;
		}
		// Estado deseado vs actual: si no cambió nada, no escribimos (evita marcar
		// "edición" y disparar el aviso de backup solo por mirar la pantalla).
		const deseado: Record<number, number> = {};
		for (const [scid, monto] of Object.entries(sum)) deseado[Number(scid)] = Math.round(monto);
		const actualRows = (await query('SELECT subcategoria_id AS scid, monto FROM presupuesto WHERE perfil_id=1 AND auto=1')) as any[];
		const actual: Record<number, number> = {};
		for (const r of actualRows) actual[r.scid] = Math.round(r.monto);
		const mismas = Object.keys(deseado).length === Object.keys(actual).length
			&& Object.keys(deseado).every((k) => actual[Number(k)] === deseado[Number(k)]);
		if (mismas) return;
		await query('DELETE FROM presupuesto WHERE perfil_id=1 AND auto=1');
		for (const [scid, monto] of Object.entries(deseado)) {
			await query(
				"INSERT INTO presupuesto (perfil_id, subcategoria_id, periodo, monto, auto) VALUES (1, ?, 'default', ?, 1) ON CONFLICT(perfil_id, subcategoria_id, periodo) DO UPDATE SET monto=excluded.monto, auto=1",
				[Number(scid), monto]
			);
		}
	}

	function catPorDefecto(): number | null {
		const f = categorias.find((c: any) => c.nombre === 'Impuestos/Servicios');
		return f ? f.id : categorias[0]?.id ?? null;
	}

	function resetForm() {
		editId = null;
		fNombre = '';
		fDetalle = '';
		fMonto = '';
		fMoneda = 'ARS';
		fCatId = catPorDefecto();
		fSubcatId = '';
		fTarjetaId = null;
	}

	// Al escribir el detalle: precarga subcat (del diccionario) y categoria (la
	// mas usada en gastos historicos con ese detalle). Cero tipeo si ya hay datos.
	async function onDetalleChange() {
		const d = fDetalle.trim();
		if (!d) return;
		const mp = (await query('SELECT subcategoria_id FROM mapeo_detalle WHERE perfil_id=1 AND detalle=?', [d])) as any[];
		if (mp.length) fSubcatId = String(mp[0].subcategoria_id);
		const cg = (await query('SELECT categoria_id, COUNT(*) AS c FROM gasto WHERE perfil_id=1 AND detalle=? GROUP BY categoria_id ORDER BY c DESC LIMIT 1', [d])) as any[];
		if (cg.length) fCatId = cg[0].categoria_id;
	}

	function iniciarEdit(s: any) {
		editId = s.id;
		fNombre = s.nombre;
		fDetalle = s.detalle ?? s.nombre;
		fMonto = formatNum(s.monto);
		fMoneda = s.moneda;
		fCatId = s.categoria_id;
		fSubcatId = s.scid != null ? String(s.scid) : '';
		fTarjetaId = s.tarjeta_id;
		mensaje = '';
		window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
	}

	async function guardar() {
		mensaje = '';
		const m = parseNum(fMonto);
		if (!fNombre.trim()) return (mensaje = 'Falta el nombre');
		if (!Number.isFinite(m) || m <= 0) return (mensaje = 'Monto inválido');
		if (!fCatId) return (mensaje = 'Elegí categoría');
		const detalle = (fDetalle.trim() || fNombre.trim());
		try {
			if (editId) {
				await query('UPDATE suscripcion SET nombre=?, detalle=?, monto=?, moneda=?, categoria_id=?, tarjeta_id=? WHERE id=? AND perfil_id=1',
					[fNombre.trim(), detalle, m, fMoneda, fCatId, fTarjetaId, editId]);
				mensaje = 'Gasto fijo actualizado ✅';
			} else {
				await query('INSERT INTO suscripcion (perfil_id,nombre,detalle,monto,moneda,categoria_id,tarjeta_id) VALUES (1,?,?,?,?,?,?)',
					[fNombre.trim(), detalle, m, fMoneda, fCatId, fTarjetaId]);
				mensaje = 'Gasto fijo agregado ✅';
			}
			// Si se eligio subcategoria, se mapea el detalle (reclasifica historial).
			if (fSubcatId) {
				const ex = (await query('SELECT id FROM mapeo_detalle WHERE perfil_id=1 AND detalle=?', [detalle])) as any[];
				if (ex.length) await query('UPDATE mapeo_detalle SET subcategoria_id=? WHERE perfil_id=1 AND detalle=?', [Number(fSubcatId), detalle]);
				else await query('INSERT INTO mapeo_detalle (perfil_id, detalle, subcategoria_id) VALUES (1, ?, ?)', [detalle, Number(fSubcatId)]);
			}
			await recalcPresupuestoFijos();
			resetForm();
			await cargar();
		} catch (e: any) {
			mensaje = 'Error: ' + (e?.message ?? String(e));
		}
	}

	async function eliminar(s: any) {
		if (!confirm(`¿Eliminar el gasto fijo "${s.nombre}"? (no borra los gastos ya registrados)`)) return;
		await query('DELETE FROM suscripcion_registro WHERE suscripcion_id=?', [s.id]);
		await query('DELETE FROM suscripcion WHERE id=? AND perfil_id=1', [s.id]);
		if (editId === s.id) resetForm();
		await recalcPresupuestoFijos();
		await cargar();
	}

	function iniciarDisparo(s: any) {
		disparando = s.id; dMonto = formatNum(s.monto);
		dFecha = periodo === mesActual() ? hoyISO() : periodo + '-01';
		mensaje = '';
	}
	async function confirmarDisparo(s: any) {
		const m = parseNum(dMonto);
		if (!Number.isFinite(m) || m <= 0) return (mensaje = 'Monto inválido');
		if (!dFecha) return (mensaje = 'Falta la fecha');
		try {
			// Si hay una subcategoria macro elegida, el gasto sale con ese override;
			// si no, queda NULL y se clasifica por diccionario (via el detalle).
			const scid = dispSubcatId ? Number(dispSubcatId) : null;
			const det = s.detalle ?? s.nombre;
			const g = (await query("INSERT INTO gasto (perfil_id,fecha,monto,moneda,categoria_id,detalle,medio,cuotas,subcategoria_id) VALUES (1,?,?,?,?,?,'debito',1,?) RETURNING id",
				[dFecha, m, s.moneda, s.categoria_id, det, scid])) as any[];
			await query('INSERT INTO suscripcion_registro (suscripcion_id,gasto_id,periodo) VALUES (?,?,?)', [s.id, g[0].id, periodo]);
			disparando = null; mensaje = `"${s.nombre}" registrada en ${periodo} ✅`;
			await cargar();
		} catch (e: any) { mensaje = 'Error: ' + (e?.message ?? String(e)); }
	}

	const peso = (n: number, mon = 'ARS') => (mon === 'USD' ? 'U$D ' : '$') + Math.round(n || 0).toLocaleString('es-AR');
</script>

<div class="titulo-guia">
	<h1>Gastos Fijos</h1>
	<Guia clave="suscripciones" texto="Tus gastos fijos mensuales (apps, servicios, impuestos, gym, escuela). Solo lo que pagás todos los meses. Cada uno alimenta automáticamente el presupuesto de su subcategoría. 'Registrar Pago' lo convierte en gasto real del mes." />
</div>

<a href="/" class="btn-volver">← Volver a Presupuesto</a>

<label class="sel">Mes / Año: <input type="month" bind:value={periodo} onchange={cargar} /></label>

<div class="fijo-total">
	<span>Fijo del mes</span>
	<strong>{peso(fijoMesARS)}</strong>
	<span class="fijo-nota">suma de todos los fijos activos (USD al MEP)</span>
</div>

<label class="disparo-subcat">Subcategoría de los gastos registrados:
	<select bind:value={dispSubcatId} onchange={() => setMeta('susc_subcat_id', dispSubcatId)}>
		<option value="">Automática (según diccionario)</option>
		{#each subcategorias as s (s.id)}<option value={String(s.id)}>{s.nombre}</option>{/each}
	</select>
</label>

<div class="grupos">
	{#each grupos as g (g.cat)}
		<div class="grupo-cat">{g.cat}</div>
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
					<span class="chip" class:sin={s.scid == null}>{s.subcat ?? '— sin subcategoría —'}</span>
					{s.tarjeta ? ` · ${s.tarjeta}` : ''}
				</div>
				<div class="ficha-estado">
					{#if !s.activa}
						<span class="dim">Inactiva</span>
					{:else if registradas[s.id]}
						<span class="ok">Registrada ✓</span>
					{:else if disparando === s.id}
						<span class="draft">
							<input type="text" inputmode="decimal" use:soloNum bind:value={dMonto} class="mini" />
							<input type="date" bind:value={dFecha} class="mini" />
							<button class="btn btn-primary" onclick={() => confirmarDisparo(s)}>Confirmar</button>
							<button class="btn btn-secondary" onclick={() => (disparando = null)}>Cancelar</button>
						</span>
					{:else}
						<button class="btn btn-primary" onclick={() => iniciarDisparo(s)}>Registrar Pago</button>
					{/if}
				</div>
			</div>
		{/each}
	{/each}
	{#if subs.length === 0}<p class="vacio">No hay gastos fijos. Agregá uno abajo.</p>{/if}
</div>
{#if mensaje}<p class="msg">{mensaje}</p>{/if}

<h2>{editando ? 'Editar gasto fijo' : 'Agregar gasto fijo'}</h2>
<div class="form" class:edit={editando}>
	{#if editando}<p class="editando">✏ Editando #{editId} · <button class="link" onclick={resetForm}>cancelar</button></p>{/if}
	<label>Nombre<input bind:value={fNombre} placeholder="Ej: Netflix" /></label>
	<label>Detalle (como aparece en el gasto)<input bind:value={fDetalle} onblur={onDetalleChange} placeholder="Ej: Netflix" /></label>
	<label>Monto{editando ? ' (lo que dice la factura)' : ''}<input type="text" inputmode="decimal" use:soloNum bind:value={fMonto} placeholder="0,00" /></label>
	<label>Moneda<select bind:value={fMoneda}><option>ARS</option><option>USD</option></select></label>
	<label>Categoría<select bind:value={fCatId}>{#each categorias as c (c.id)}<option value={c.id}>{c.nombre}</option>{/each}</select></label>
	<label>Subcategoría<select bind:value={fSubcatId}>
		<option value="">— sin asignar —</option>
		{#each subcategorias as s (s.id)}<option value={String(s.id)}>{s.nombre}</option>{/each}
	</select></label>
	<label>Tarjeta (opcional, solo referencia)
		<select bind:value={fTarjetaId}><option value={null}>— ninguna —</option>{#each tarjetas as t (t.id)}<option value={t.id}>{t.nombre}</option>{/each}</select></label>
	<div class="botones">
		<button class="btn btn-primary" onclick={guardar}>{editando ? 'Guardar cambios' : 'Agregar'}</button>
		{#if editando}<button class="btn btn-secondary" onclick={resetForm}>Cancelar</button>{/if}
	</div>
	<p class="form-nota">La subcategoría define en qué línea del presupuesto cae el fijo (se mapea por detalle, igual que un gasto). Cambiarla reclasifica todo el historial con ese detalle.</p>
</div>

<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	.sel { font-size: 0.9rem; display: inline-flex; flex-direction: row; gap: 8px; align-items: center; margin-top: 4px; }
	.fijo-total { display: flex; flex-direction: column; gap: 2px; border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 10px 14px; margin: 12px 0; }
	.fijo-total span { font-size: 0.75rem; color: var(--text-dim); }
	.fijo-total strong { font-size: 1.6rem; }
	.fijo-nota { font-size: 0.72rem !important; }
	.disparo-subcat { flex-direction: row !important; align-items: center; gap: 8px; font-size: 0.82rem; margin-bottom: 10px; flex-wrap: wrap; }
	.disparo-subcat select { max-width: 240px; }
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
	.chip.sin { color: var(--text-dim); border-style: dashed; }
	.ficha-estado { margin-top: 8px; }
</style>

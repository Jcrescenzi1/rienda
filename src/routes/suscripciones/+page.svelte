<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import { mesActual, parseNum, formatNum, soloNum, fechaCobroDefault, pesos as peso } from '$lib/format';
	import { setMeta } from '$lib/db/meta';
	import { periodoActivoCC, cargarModo, diaCobroActivo, ordenDia, type ModoPeriodo } from '$lib/periodo';
	import Guia from '$lib/Guia.svelte';
	import TabsCorrRec from '$lib/TabsCorrRec.svelte';
	import { Toast } from '$lib/toast.svelte';

	// Arranca en el período activo de Cuenta Corriente (si venís de la Home); si no,
	// en el mes actual. Es solo el default inicial: el usuario lo cambia libremente y
	// el cambio acá NO se propaga de vuelta a la Home.
	let periodo = $state(periodoActivoCC() ?? mesActual());

	let subs = $state<any[]>([]);
	let modo = $state<ModoPeriodo>('sueldo');
	// Día de cobro que ancla la rotación de la lista (solo en modo sueldo con ingreso
	// principal cargado). null = orden crudo 1→31. El día esperado guardado es día
	// calendario real (1-31) en ambos modos; la rotación es puro reordenamiento visual.
	let cobroDia = $state<number | null>(null);
	// Opciones del selector: día calendario 1-31, igual en los dos modos.
	const OPCIONES_DIA = Array.from({ length: 31 }, (_, i) => i + 1);
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
	let formAbierto = $state(false); // panel de alta/edicion colapsable (solo UI)
	let fNombre = $state('');
	let fDetalle = $state('');
	let fMonto = $state('');
	let fMoneda = $state('ARS');
	let fCatId = $state<number | null>(null);
	let fSubcatId = $state('');
	let fTarjetaId = $state<number | null>(null);
	let fDiaEsperado = $state(''); // '' = sin especificar -> NULL

	const toast = new Toast();
	const editando = $derived(editId !== null);

	// Orden de presentación: activos primero, dentro de ellos rotados por día de cobro
	// (ordenDia), los sin-día al final; los inactivos al fondo. La rotación es JS y no
	// SQL porque el día de cobro es un valor de runtime (no está en la fila).
	const ordenadas = $derived.by(() =>
		[...subs].sort((a, b) => {
			if (a.activa !== b.activa) return b.activa - a.activa;
			const ka = ordenDia(a.dia_esperado, cobroDia), kb = ordenDia(b.dia_esperado, cobroDia);
			if (ka !== kb) return ka - kb;
			return String(a.nombre).localeCompare(String(b.nombre), 'es');
		})
	);

	// Lista plana (sin agrupar por categoría) con dos separadores tenues intercalados:
	// "Sin día estimado" antes del primer activo sin día, e "Inactivos" antes del
	// primer pausado. El segundo hace falta porque el orden pone activos primero:
	// sin él, un inactivo CON día quedaría colgado debajo de "Sin día estimado".
	const filas = $derived.by(() => {
		const out: { sep?: string; s?: any }[] = [];
		let sepSinDia = false, sepInactivos = false;
		for (const s of ordenadas) {
			if (!s.activa) {
				if (!sepInactivos) { out.push({ sep: 'Inactivos' }); sepInactivos = true; }
			} else if (s.dia_esperado == null && !sepSinDia) {
				out.push({ sep: 'Sin día estimado' });
				sepSinDia = true;
			}
			out.push({ s });
		}
		return out;
	});

	// Total de los recurrentes activos, separado por moneda (sin convertir). El
	// "Recurrente del mes" de arriba es el total convertido a ARS; esto es el
	// desglose por moneda tal cual, sin conversión.
	const totales = $derived.by(() => {
		const t: Record<string, number> = {};
		for (const s of subs) if (s.activa) t[s.moneda] = (t[s.moneda] ?? 0) + s.monto;
		return Object.entries(t).sort((a, b) => a[0].localeCompare(b[0]));
	});

	// MEP de referencia del periodo: cotizacion del primer dia del mes corriente.
	// Es una cotizacion historica fija -> el presupuesto de fijos USD NO flota
	// intra-mes; se actualiza recien al cambiar de mes (Item 3, ancla deterministica).
	async function mepDelPeriodo(): Promise<number> {
		const r = (await query("SELECT valor FROM cotizacion_dolar WHERE perfil_id=1 AND casa='bolsa' AND fecha <= ? ORDER BY fecha DESC LIMIT 1", [mesActual() + '-01'])) as any[];
		return r[0]?.valor ?? 1;
	}

	async function cargar() {
		modo = await cargarModo();
		// Día de cobro para rotar la lista: solo en modo sueldo (en calendario no rota).
		cobroDia = modo === 'sueldo' ? await diaCobroActivo() : null;
		categorias = await query('SELECT id, nombre FROM categoria WHERE perfil_id=1 AND activa=1 ORDER BY nombre');
		tarjetas = await query('SELECT id, nombre FROM tarjeta WHERE perfil_id=1 AND activa=1 ORDER BY nombre');
		subcategorias = await query('SELECT id, nombre FROM subcategoria WHERE perfil_id=1 AND activa=1 ORDER BY nombre');
		const sc = (await query("SELECT valor FROM meta WHERE clave='susc_subcat_id'")) as any[];
		dispSubcatId = sc[0]?.valor ?? '';
		// Fijos con su subcategoria resuelta por el diccionario (mapeo_detalle). El
		// orden final (rotación por día de cobro) se resuelve en JS -> ordenadas.
		subs = await query(`
			SELECT s.id, s.nombre, s.detalle, s.monto, s.moneda, s.activa, s.dia_esperado,
			       s.categoria_id, c.nombre AS categoria, s.tarjeta_id, t.nombre AS tarjeta,
			       m.subcategoria_id AS scid, sc.nombre AS subcat
			FROM suscripcion s
			JOIN categoria c ON c.id = s.categoria_id
			LEFT JOIN tarjeta t ON t.id = s.tarjeta_id
			LEFT JOIN mapeo_detalle m ON m.perfil_id = 1 AND m.detalle = s.detalle
			LEFT JOIN subcategoria sc ON sc.id = m.subcategoria_id
			WHERE s.perfil_id = 1
			ORDER BY s.nombre`);
		const reg = (await query('SELECT suscripcion_id FROM suscripcion_registro WHERE periodo=?', [periodo])) as any[];
		const r: Record<number, boolean> = {};
		for (const x of reg) r[x.suscripcion_id] = true;
		registradas = r;

		// Dolar MEP para convertir los fijos en USD a ARS.
		dolar = await mepDelPeriodo();
		fijoMesARS = subs
			.filter((s: any) => s.activa)
			.reduce((t: number, s: any) => t + (s.moneda === 'USD' ? s.monto * dolar : s.monto), 0);

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

	function resetForm() {
		editId = null;
		fNombre = '';
		fDetalle = '';
		fMonto = '';
		fMoneda = 'ARS';
		fCatId = null;   // arranca vacío: la categoría se elige a mano (obligatoria)
		fSubcatId = '';
		fTarjetaId = null;
		fDiaEsperado = '';
	}

	// Al escribir el detalle: precarga la subcategoría del diccionario (mapeo_detalle).
	// La categoría YA NO se autosugiere del historial: se elige siempre a mano.
	async function onDetalleChange() {
		const d = fDetalle.trim();
		if (!d) return;
		const mp = (await query('SELECT subcategoria_id FROM mapeo_detalle WHERE perfil_id=1 AND detalle=?', [d])) as any[];
		if (mp.length) fSubcatId = String(mp[0].subcategoria_id);
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
		fDiaEsperado = s.dia_esperado != null ? String(s.dia_esperado) : '';
		toast.limpiar();
		formAbierto = true;
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	async function guardar() {
		toast.limpiar();
		const m = parseNum(fMonto);
		if (!fNombre.trim()) return toast.error('Falta el nombre');
		if (!Number.isFinite(m) || m <= 0) return toast.error('Monto inválido');
		if (!fCatId) return toast.error('Elegí categoría');
		const detalle = (fDetalle.trim() || fNombre.trim());
		const dia = fDiaEsperado ? Number(fDiaEsperado) : null;
		try {
			if (editId) {
				await query('UPDATE suscripcion SET nombre=?, detalle=?, monto=?, moneda=?, categoria_id=?, tarjeta_id=?, dia_esperado=? WHERE id=? AND perfil_id=1',
					[fNombre.trim(), detalle, m, fMoneda, fCatId, fTarjetaId, dia, editId]);
				toast.exito('Gasto recurrente actualizado ✅');
			} else {
				await query('INSERT INTO suscripcion (perfil_id,nombre,detalle,monto,moneda,categoria_id,tarjeta_id,dia_esperado) VALUES (1,?,?,?,?,?,?,?)',
					[fNombre.trim(), detalle, m, fMoneda, fCatId, fTarjetaId, dia]);
				toast.exito('Gasto recurrente agregado ✅');
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
			toast.error('Error: ' + (e?.message ?? String(e)));
		}
	}

	async function eliminar(s: any) {
		if (!confirm(`¿Eliminar el gasto recurrente "${s.nombre}"? (no borra los gastos ya registrados)`)) return;
		await query('DELETE FROM suscripcion_registro WHERE suscripcion_id=?', [s.id]);
		await query('DELETE FROM suscripcion WHERE id=? AND perfil_id=1', [s.id]);
		if (editId === s.id) resetForm();
		await recalcPresupuestoFijos();
		await cargar();
	}

	function iniciarDisparo(s: any) {
		disparando = s.id; dMonto = formatNum(s.monto);
		// Default editable: hoy montado sobre el mes del selector. El gasto fijo no
		// abre corte -> el periodo del registro sigue siendo el del selector (guard).
		dFecha = fechaCobroDefault(periodo);
		toast.limpiar();
	}
	async function confirmarDisparo(s: any) {
		const m = parseNum(dMonto);
		if (!Number.isFinite(m) || m <= 0) return toast.error('Monto inválido');
		if (!dFecha) return toast.error('Falta la fecha');
		try {
			// Si hay una subcategoria macro elegida, el gasto sale con ese override;
			// si no, queda NULL y se clasifica por diccionario (via el detalle).
			const scid = dispSubcatId ? Number(dispSubcatId) : null;
			const det = s.detalle ?? s.nombre;
			const g = (await query("INSERT INTO gasto (perfil_id,fecha,monto,moneda,categoria_id,detalle,medio,cuotas,subcategoria_id) VALUES (1,?,?,?,?,?,'debito',1,?) RETURNING id",
				[dFecha, m, s.moneda, s.categoria_id, det, scid])) as any[];
			await query('INSERT INTO suscripcion_registro (suscripcion_id,gasto_id,periodo) VALUES (?,?,?)', [s.id, g[0].id, periodo]);
			disparando = null; toast.exito(`"${s.nombre}" registrada en ${periodo} ✅`);
			await cargar();
		} catch (e: any) { toast.error('Error: ' + (e?.message ?? String(e))); }
	}

</script>

<div class="titulo-guia">
	<h1>Gastos</h1>
	<Guia clave="suscripciones" texto="Tus gastos recurrentes mensuales (apps, servicios, impuestos, gym, escuela). Solo lo que pagás todos los meses. Cada uno alimenta automáticamente el presupuesto de su subcategoría. 'Registrar Pago' lo convierte en gasto real del mes." />
</div>
<div class="cr-nav">
	<a href="/" class="btn-volver">← Volver a Cuenta Corriente</a>
	<TabsCorrRec activo="recurrente" corriente="/gastos" recurrente="/suscripciones" />
	<label class="sel">Mes / Año: <input type="month" bind:value={periodo} onchange={cargar} /></label>
</div>

<div class="fijo-total">
	<span>Recurrente del mes</span>
	<strong>{peso(fijoMesARS)}</strong>
	<span class="fijo-nota">suma de todos los recurrentes activos (USD al MEP)</span>
</div>

<details class="form-panel" bind:open={formAbierto}>
	<summary>{editando ? '✏ Editar gasto recurrente' : '➕ Agregar gasto recurrente'}</summary>
<div class="form" class:edit={editando}>
	{#if editando}<p class="editando">✏ Editando #{editId} · <button class="link" onclick={resetForm}>cancelar</button></p>{/if}
	<label>Nombre<input bind:value={fNombre} placeholder="Ej: Netflix" /></label>
	<label>Detalle (como aparece en el gasto)<input bind:value={fDetalle} onblur={onDetalleChange} placeholder="Ej: Netflix" /></label>
	<label>Monto{editando ? ' (lo que dice la factura)' : ''}<input type="text" inputmode="decimal" use:soloNum bind:value={fMonto} placeholder="0,00" /></label>
	<label>Moneda<select bind:value={fMoneda}><option>ARS</option><option>USD</option></select></label>
	<label>Categoría<select bind:value={fCatId}><option value={null}>— elegí una —</option>{#each categorias as c (c.id)}<option value={c.id}>{c.nombre}</option>{/each}</select></label>
	<label>Subcategoría<select bind:value={fSubcatId}>
		<option value="">— sin asignar —</option>
		{#each subcategorias as s (s.id)}<option value={String(s.id)}>{s.nombre}</option>{/each}
	</select></label>
	<label>Tarjeta (opcional, solo referencia)
		<select bind:value={fTarjetaId}><option value={null}>— ninguna —</option>{#each tarjetas as t (t.id)}<option value={t.id}>{t.nombre}</option>{/each}</select></label>
	<label>Día esperado de pago
		<select bind:value={fDiaEsperado}>
			<option value="">— sin especificar —</option>
			{#each OPCIONES_DIA as d (d)}<option value={String(d)}>Día {d}</option>{/each}
		</select></label>
	<div class="botones">
		<button class="btn btn-primary" onclick={guardar}>{editando ? 'Guardar cambios' : 'Agregar'}</button>
		{#if editando}<button class="btn btn-secondary" onclick={resetForm}>Cancelar</button>{/if}
	</div>
	<p class="form-nota">La subcategoría define en qué línea del presupuesto cae este gasto recurrente (se mapea por detalle, igual que un gasto). Cambiarla reclasifica todo el historial con ese detalle.</p>
</div>
</details>

<label class="disparo-subcat">Subcategoría de los gastos registrados:
	<select bind:value={dispSubcatId} onchange={() => setMeta('susc_subcat_id', dispSubcatId)}>
		<option value="">Automática (según diccionario)</option>
		{#each subcategorias as s (s.id)}<option value={String(s.id)}>{s.nombre}</option>{/each}
	</select>
</label>

{#if totales.length}
	<div class="totales">
		{#each totales as [mon, tot] (mon)}
			<div class="total">Total {mon}: <strong>{peso(tot, mon)}</strong></div>
		{/each}
	</div>
{/if}

<div class="grupos">
	{#each filas as f (f.sep ?? f.s.id)}
		{#if f.sep}
			<div class="sep-lista">{f.sep}</div>
		{:else}
			{@const s = f.s}
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
					{` · ${s.categoria}`}{s.tarjeta ? ` · ${s.tarjeta}` : ''}{s.dia_esperado != null ? ` · Día ${s.dia_esperado}` : ''}
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
		{/if}
	{/each}
	{#if subs.length === 0}<p class="vacio">No hay gastos recurrentes. Agregá el primero desde “➕ Agregar gasto recurrente”, arriba.</p>{/if}
</div>
{#if toast.texto}<p class="msg">{toast.texto}</p>{/if}



<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	.sel { font-size: 0.9rem; display: inline-flex; flex-direction: row; gap: 8px; align-items: center; margin-top: 4px; }
	.fijo-total { display: flex; flex-direction: column; gap: 2px; border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 10px 14px; margin: 12px 0; }
	.fijo-total span { font-size: 0.75rem; color: var(--text-dim); }
	.fijo-total strong { font-size: 1.6rem; }
	.fijo-nota { font-size: 0.72rem !important; }
	.disparo-subcat { flex-direction: row !important; align-items: center; gap: 8px; font-size: 0.82rem; margin-bottom: 10px; flex-wrap: wrap; }
	.disparo-subcat select { max-width: 240px; }
	.form-panel { border: 1px solid var(--border); border-radius: 8px; background: var(--surface); margin: 12px 0; }
	.form-panel summary { cursor: pointer; padding: 11px 14px; font-family: var(--font-display); font-weight: 600; font-size: 0.92rem; color: var(--accent); list-style: none; }
	.form-panel summary::-webkit-details-marker { display: none; }
	.form-panel[open] summary { border-bottom: 1px solid var(--border); }
	.form-panel .form { background: none; border-color: transparent; border-radius: 0; margin: 0; padding: 12px 14px; }
	.form.edit { border-color: var(--accent); }
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

	/* Total de recurrentes activos, una línea por moneda (sin convertir) */
	.totales { display: flex; flex-wrap: wrap; gap: 4px 18px; margin: 10px 0; }
	.total { font-size: 0.9rem; color: var(--text-dim); font-weight: 600; }
	.total strong { color: var(--text); }
	.grupos { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
	/* Separadores tenues de la lista plana. Deliberadamente más discretos que los
	   viejos headers de categoría: acá no agrupan, solo marcan un corte. */
	.sep-lista { font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); font-weight: 600; margin-top: 14px; padding-bottom: 3px; border-bottom: 1px dashed var(--border); opacity: 0.75; }
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

	/* Nav superior de Corriente/Recurrente: volver + tabs (+ selector de periodo si aplica), apilados */
	.cr-nav { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; margin: 4px 0 14px; }
	.cr-nav :global(.btn-volver) { margin: 0; }
	.cr-nav :global(.sel) { margin: 0; }
</style>

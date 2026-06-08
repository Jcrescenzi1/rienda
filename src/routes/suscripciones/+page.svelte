<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';

	const hoy = new Date();
	let periodo = $state(hoy.toISOString().slice(0, 7));

	let subs = $state<any[]>([]);
	let categorias = $state<any[]>([]);
	let tarjetas = $state<any[]>([]);
	let registradas = $state<Record<number, boolean>>({});
	let presupApps = $state(0);

	let disparando = $state<number | null>(null);
	let dMonto = $state<number | null>(null);
	let dFecha = $state('');

	// Form unificado (alta + edición). editId null = alta, número = edición.
	let editId = $state<number | null>(null);
	let fNombre = $state('');
	let fMonto = $state<number | null>(null);
	let fMoneda = $state('ARS');
	let fCatId = $state<number | null>(null);
	let fTarjetaId = $state<number | null>(null);

	let mensaje = $state('');
	const editando = $derived(editId !== null);

	async function cargar() {
		categorias = await query('SELECT id, nombre FROM categoria WHERE perfil_id=1 AND activa=1 ORDER BY nombre');
		tarjetas = await query('SELECT id, nombre FROM tarjeta WHERE perfil_id=1 AND activa=1 ORDER BY nombre');
		if (fCatId == null) {
			const f = categorias.find((c: any) => c.nombre === 'Facturas');
			fCatId = f ? f.id : categorias[0]?.id ?? null;
		}
		subs = await query(`
			SELECT s.id, s.nombre, s.monto, s.moneda, s.activa,
			       s.categoria_id, c.nombre AS categoria, s.tarjeta_id, t.nombre AS tarjeta
			FROM suscripcion s
			JOIN categoria c ON c.id = s.categoria_id
			LEFT JOIN tarjeta t ON t.id = s.tarjeta_id
			WHERE s.perfil_id = 1
			ORDER BY s.activa DESC, s.nombre`);
		const reg = (await query('SELECT suscripcion_id FROM suscripcion_registro WHERE periodo=?', [periodo])) as any[];
		const r: Record<number, boolean> = {};
		for (const x of reg) r[x.suscripcion_id] = true;
		registradas = r;
		const p = (await query("SELECT COALESCE(SUM(monto),0) AS t FROM suscripcion WHERE perfil_id=1 AND activa=1 AND moneda='ARS'")) as any[];
		presupApps = p[0].t;
	}

	onMount(cargar);

	// Categoría por defecto para una alta nueva (Facturas si existe)
	function catPorDefecto(): number | null {
		const f = categorias.find((c: any) => c.nombre === 'Facturas');
		return f ? f.id : categorias[0]?.id ?? null;
	}

	function resetForm() {
		editId = null;
		fNombre = '';
		fMonto = null;
		fMoneda = 'ARS';
		fCatId = catPorDefecto();
		fTarjetaId = null;
	}

	function iniciarEdit(s: any) {
		editId = s.id;
		fNombre = s.nombre;
		fMonto = s.monto;
		fMoneda = s.moneda;
		fCatId = s.categoria_id;
		fTarjetaId = s.tarjeta_id;
		mensaje = '';
		window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
	}

	async function guardar() {
		mensaje = '';
		const m = Number(fMonto);
		if (!fNombre.trim()) return (mensaje = 'Falta el nombre');
		if (!m || m <= 0) return (mensaje = 'Monto inválido');
		if (!fCatId) return (mensaje = 'Elegí categoría');
		try {
			if (editId) {
				await query('UPDATE suscripcion SET nombre=?, monto=?, moneda=?, categoria_id=?, tarjeta_id=? WHERE id=? AND perfil_id=1',
					[fNombre.trim(), m, fMoneda, fCatId, fTarjetaId, editId]);
				mensaje = 'Suscripción actualizada ✅';
			} else {
				await query('INSERT INTO suscripcion (perfil_id,nombre,monto,moneda,categoria_id,tarjeta_id) VALUES (1,?,?,?,?,?)',
					[fNombre.trim(), m, fMoneda, fCatId, fTarjetaId]);
				mensaje = 'Suscripción agregada ✅';
			}
			resetForm();
			await cargar();
		} catch (e: any) {
			mensaje = 'Error: ' + (e?.message ?? String(e));
		}
	}

	async function eliminar(s: any) {
		if (!confirm(`¿Eliminar la suscripción "${s.nombre}"? (no borra los gastos ya registrados)`)) return;
		await query('DELETE FROM suscripcion WHERE id=? AND perfil_id=1', [s.id]);
		if (editId === s.id) resetForm();
		await cargar();
	}

	function iniciarDisparo(s: any) {
		disparando = s.id; dMonto = s.monto;
		dFecha = periodo === hoy.toISOString().slice(0, 7) ? hoy.toISOString().slice(0, 10) : periodo + '-01';
		mensaje = '';
	}
	async function confirmarDisparo(s: any) {
		const m = Number(dMonto);
		if (!m || m <= 0) return (mensaje = 'Monto inválido');
		if (!dFecha) return (mensaje = 'Falta la fecha');
		try {
			const g = (await query("INSERT INTO gasto (perfil_id,fecha,monto,moneda,categoria_id,detalle,medio,cuotas) VALUES (1,?,?,?,?,?,'debito',1) RETURNING id",
				[dFecha, m, s.moneda, s.categoria_id, s.nombre])) as any[];
			await query('INSERT INTO suscripcion_registro (suscripcion_id,gasto_id,periodo) VALUES (?,?,?)', [s.id, g[0].id, periodo]);
			disparando = null; mensaje = `"${s.nombre}" registrada en ${periodo} ✅`;
			await cargar();
		} catch (e: any) { mensaje = 'Error: ' + (e?.message ?? String(e)); }
	}

	const peso = (n: number, mon = 'ARS') => (mon === 'USD' ? 'U$D ' : '$') + Math.round(n || 0).toLocaleString('es-AR');
</script>

<h1>Suscripciones</h1>

<a href="/" class="btn-volver">← Volver a Gastos y Presupuesto</a>

<label class="sel">Mes / Año: <input type="month" bind:value={periodo} onchange={cargar} /></label>

<p class="apps">Presupuesto de Aplicaciones (solo ARS): <strong>{peso(presupApps)}</strong> / mes</p>

<div class="fichas">
	{#each subs as s (s.id)}
		<div class="ficha" class:inactiva={!s.activa} class:editrow={editId === s.id}>
			<div class="ficha-top">
				<span class="ficha-nombre">{s.nombre}</span>
				<span class="ficha-monto">{peso(s.monto, s.moneda)}</span>
				<span class="ficha-acc">
					<button class="lapiz" onclick={() => iniciarEdit(s)} title="Editar">✏️</button>
					<button class="del" onclick={() => eliminar(s)} title="Eliminar">✕</button>
				</span>
			</div>
			<div class="ficha-meta">{s.categoria}{s.tarjeta ? ` · ${s.tarjeta}` : ''}</div>
			<div class="ficha-estado">
				{#if !s.activa}
					<span class="dim">Inactiva</span>
				{:else if registradas[s.id]}
					<span class="ok">Registrada ✓</span>
				{:else if disparando === s.id}
					<span class="draft">
						<input type="number" min="0" bind:value={dMonto} class="mini" />
						<input type="date" bind:value={dFecha} class="mini" />
						<button onclick={() => confirmarDisparo(s)}>Confirmar</button>
						<button class="sec" onclick={() => (disparando = null)}>Cancelar</button>
					</span>
				{:else}
					<button onclick={() => iniciarDisparo(s)}>Disparar</button>
				{/if}
			</div>
		</div>
	{/each}
	{#if subs.length === 0}<p class="vacio">No hay suscripciones. Agregá una abajo.</p>{/if}
</div>
{#if mensaje}<p class="msg">{mensaje}</p>{/if}

<h2>{editando ? 'Editar suscripción' : 'Agregar suscripción'}</h2>
<div class="form" class:edit={editando}>
	{#if editando}<p class="editando">✏️ Editando #{editId} · <button class="link" onclick={resetForm}>cancelar</button></p>{/if}
	<label>Nombre<input bind:value={fNombre} placeholder="Ej: Netflix" /></label>
	<label>Monto{editando ? ' (lo que dice la factura)' : ''}<input type="number" min="0" bind:value={fMonto} /></label>
	<label>Moneda<select bind:value={fMoneda}><option>ARS</option><option>USD</option></select></label>
	<label>Categoría<select bind:value={fCatId}>{#each categorias as c (c.id)}<option value={c.id}>{c.nombre}</option>{/each}</select></label>
	<label>Tarjeta (opcional, solo referencia)
		<select bind:value={fTarjetaId}><option value={null}>— ninguna —</option>{#each tarjetas as t (t.id)}<option value={t.id}>{t.nombre}</option>{/each}</select></label>
	<div class="botones">
		<button class="guardar" onclick={guardar}>{editando ? 'Guardar cambios' : 'Agregar'}</button>
		{#if editando}<button class="sec" onclick={resetForm}>Cancelar</button>{/if}
	</div>
</div>

<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	.sel { font-size: 0.9rem; display: inline-flex; gap: 8px; align-items: center; margin-top: 4px; }
	.apps { font-size: 0.9rem; color: var(--text-dim); }
	h2 { font-size: 1.1rem; margin-top: 22px; }
	.form { display: flex; flex-direction: column; gap: 8px; max-width: 340px; }
	.form.edit { border: 1px solid var(--accent); border-radius: 8px; padding: 12px; background: var(--surface); }
	label { display: flex; flex-direction: column; font-size: 0.82rem; color: var(--text-dim); gap: 3px; }
	input, select { padding: 6px; font-size: 0.95rem; }
	input.mini { width: 110px; padding: 3px 5px; display: inline-block; }
	button { padding: 5px 10px; background: var(--accent); color: #fff; border: none; border-radius: 6px; cursor: pointer; }
	button.sec { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); }
	button.guardar { padding: 9px; }
	.botones { display: flex; gap: 8px; margin-top: 4px; }
	.editando { font-size: 0.85rem; color: var(--warn); background: rgba(251, 191, 36, 0.1); padding: 6px 10px; border-radius: 6px; margin: 0; }
	.link { background: none; border: none; color: var(--accent); cursor: pointer; text-decoration: underline; font-size: 0.85rem; padding: 0; }
	.draft { display: inline-flex; gap: 5px; align-items: center; flex-wrap: wrap; }
	.ok { color: var(--pos); font-weight: 600; font-size: 0.85rem; }
	.dim { color: var(--text-dim); font-size: 0.85rem; }
	.vacio { color: var(--text-dim); font-style: italic; }
	.msg { color: var(--text-dim); font-weight: 600; }

	/* Fichas de suscripciones */
	.fichas { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
	.ficha { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 10px 12px; }
	.ficha.inactiva { opacity: 0.45; }
	.ficha.editrow { border-color: var(--accent); background: rgba(91, 157, 255, 0.08); }
	.ficha-top { display: flex; align-items: baseline; gap: 10px; }
	.ficha-nombre { font-weight: 600; font-size: 0.95rem; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.ficha-monto { font-weight: 700; white-space: nowrap; }
	.ficha-acc { white-space: nowrap; flex-shrink: 0; }
	.ficha-meta { font-size: 0.78rem; color: var(--text-dim); margin-top: 3px; }
	.ficha-estado { margin-top: 8px; }
	.lapiz { background: none; border: none; cursor: pointer; opacity: 0.6; padding: 2px 4px; }
	.lapiz:hover { opacity: 1; }
	.del { background: rgba(248, 113, 113, 0.15); color: var(--neg); padding: 3px 8px; margin-left: 2px; }
	.btn-volver { display: block; color: var(--accent); text-decoration: none; font-size: 0.9rem; margin: 4px 0 8px; }
	.btn-volver:hover { text-decoration: underline; }
</style>
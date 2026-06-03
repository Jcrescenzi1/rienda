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

	let nNombre = $state('');
	let nMonto = $state<number | null>(null);
	let nMoneda = $state('ARS');
	let nCatId = $state<number | null>(null);
	let nTarjetaId = $state<number | null>(null);

	let disparando = $state<number | null>(null);
	let dMonto = $state<number | null>(null);
	let dFecha = $state('');

	// edición
	let editId = $state<number | null>(null);
	let eNombre = $state(''); let eMonto = $state<number | null>(null);
	let eMoneda = $state('ARS'); let eCatId = $state<number | null>(null); let eTarjetaId = $state<number | null>(null);

	let mensaje = $state('');

	async function cargar() {
		categorias = await query('SELECT id, nombre FROM categoria WHERE perfil_id=1 AND activa=1 ORDER BY nombre');
		tarjetas = await query('SELECT id, nombre FROM tarjeta WHERE perfil_id=1 AND activa=1 ORDER BY nombre');
		if (nCatId == null) {
			const f = categorias.find((c: any) => c.nombre === 'Facturas');
			nCatId = f ? f.id : categorias[0]?.id ?? null;
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

	async function agregar() {
		mensaje = '';
		if (!nNombre.trim()) return (mensaje = 'Falta el nombre');
		if (!nMonto || nMonto <= 0) return (mensaje = 'Monto inválido');
		if (!nCatId) return (mensaje = 'Elegí categoría');
		await query('INSERT INTO suscripcion (perfil_id,nombre,monto,moneda,categoria_id,tarjeta_id) VALUES (1,?,?,?,?,?)',
			[nNombre.trim(), nMonto, nMoneda, nCatId, nTarjetaId]);
		nNombre = ''; nMonto = null; nTarjetaId = null;
		await cargar();
	}

	function iniciarEdit(s: any) {
		editId = s.id; eNombre = s.nombre; eMonto = s.monto; eMoneda = s.moneda;
		eCatId = s.categoria_id; eTarjetaId = s.tarjeta_id;
		mensaje = '';
	}
	async function guardarEdit() {
		const m = Number(eMonto);
		if (!eNombre.trim()) return (mensaje = 'Falta el nombre');
		if (!m || m <= 0) return (mensaje = 'Monto inválido');
		await query('UPDATE suscripcion SET nombre=?, monto=?, moneda=?, categoria_id=?, tarjeta_id=? WHERE id=? AND perfil_id=1',
			[eNombre.trim(), m, eMoneda, eCatId, eTarjetaId, editId]);
		editId = null; mensaje = 'Suscripción actualizada ✅';
		await cargar();
	}

	async function eliminar(s: any) {
		if (!confirm(`¿Eliminar la suscripción "${s.nombre}"? (no borra los gastos ya registrados)`)) return;
		await query('DELETE FROM suscripcion WHERE id=? AND perfil_id=1', [s.id]);
		if (editId === s.id) editId = null;
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

<a href="/" class="btn-volver">← Volver a Presupuesto</a>

<label class="sel">Mes / Año: <input type="month" bind:value={periodo} onchange={cargar} /></label>

<p class="apps">Presupuesto de Aplicaciones (solo ARS): <strong>{peso(presupApps)}</strong> / mes</p>

<table>
	<thead>
		<tr><th>Nombre</th><th class="num">Monto</th><th>Tarjeta</th><th>Estado del mes</th><th>Acciones</th></tr>
	</thead>
	<tbody>
		{#each subs as s (s.id)}
			<tr class:inactiva={!s.activa} class:editrow={editId === s.id}>
				<td>{s.nombre}</td>
				<td class="num">{peso(s.monto, s.moneda)}</td>
				<td>{s.tarjeta ?? '—'}</td>
				<td>
					{#if !s.activa}—
					{:else if registradas[s.id]}<span class="ok">Registrada ✓</span>
					{:else if disparando === s.id}
						<span class="draft">
							<input type="number" min="0" bind:value={dMonto} class="mini" />
							<input type="date" bind:value={dFecha} class="mini" />
							<button onclick={() => confirmarDisparo(s)}>Confirmar</button>
							<button class="sec" onclick={() => (disparando = null)}>Cancelar</button>
						</span>
					{:else}<button onclick={() => iniciarDisparo(s)}>Disparar</button>{/if}
				</td>
				<td class="acc">
					<button class="lapiz" onclick={() => iniciarEdit(s)} title="Editar">✏️</button>
					<button class="del" onclick={() => eliminar(s)} title="Eliminar">✕</button>
				</td>
			</tr>
		{/each}
		{#if subs.length === 0}<tr><td colspan="5" class="vacio">No hay suscripciones. Agregá una abajo.</td></tr>{/if}
	</tbody>
</table>
{#if mensaje}<p class="msg">{mensaje}</p>{/if}

{#if editId != null}
	<div class="editbox">
		<h3>Editar suscripción</h3>
		<div class="form">
			<label>Nombre<input bind:value={eNombre} /></label>
			<label>Monto (lo que dice la factura)<input type="number" min="0" bind:value={eMonto} /></label>
			<label>Moneda<select bind:value={eMoneda}><option>ARS</option><option>USD</option></select></label>
			<label>Categoría<select bind:value={eCatId}>{#each categorias as c (c.id)}<option value={c.id}>{c.nombre}</option>{/each}</select></label>
			<label>Tarjeta<select bind:value={eTarjetaId}><option value={null}>— ninguna —</option>{#each tarjetas as t (t.id)}<option value={t.id}>{t.nombre}</option>{/each}</select></label>
			<div class="botones">
				<button class="guardar" onclick={guardarEdit}>Guardar cambios</button>
				<button class="sec" onclick={() => (editId = null)}>Cancelar</button>
			</div>
		</div>
	</div>
{/if}

<h2>Agregar suscripción</h2>
<div class="form">
	<label>Nombre<input bind:value={nNombre} placeholder="Ej: Netflix" /></label>
	<label>Monto<input type="number" min="0" bind:value={nMonto} /></label>
	<label>Moneda<select bind:value={nMoneda}><option>ARS</option><option>USD</option></select></label>
	<label>Categoría<select bind:value={nCatId}>{#each categorias as c (c.id)}<option value={c.id}>{c.nombre}</option>{/each}</select></label>
	<label>Tarjeta (opcional, solo referencia)
		<select bind:value={nTarjetaId}><option value={null}>— ninguna —</option>{#each tarjetas as t (t.id)}<option value={t.id}>{t.nombre}</option>{/each}</select></label>
	<button class="guardar" onclick={agregar}>Agregar</button>
</div>

<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	.sel { font-size: 0.9rem; display: inline-flex; gap: 8px; align-items: center; margin-top: 4px; }
	.apps { font-size: 0.9rem; color: var(--text-dim); }
	h2 { font-size: 1.1rem; margin-top: 22px; }
	h3 { font-size: 1rem; margin: 0 0 8px; }
	table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
	th, td { padding: 5px 8px; text-align: left; }
	td.num, th.num { text-align: right; white-space: nowrap; }
	.form { display: flex; flex-direction: column; gap: 8px; max-width: 340px; }
	label { display: flex; flex-direction: column; font-size: 0.82rem; color: var(--text-dim); gap: 3px; }
	input, select { padding: 6px; font-size: 0.95rem; }
	input.mini { width: 110px; padding: 3px 5px; display: inline-block; }
	button { padding: 5px 10px; background: var(--accent); color: #fff; border: none; border-radius: 6px; cursor: pointer; }
	button.sec { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); }
	button.guardar { padding: 9px; margin-top: 4px; }
	.draft { display: inline-flex; gap: 5px; align-items: center; flex-wrap: wrap; }
	.ok { color: var(--pos); font-weight: 600; }
	.vacio, .msg { color: var(--text-dim); }
	.msg { font-weight: 600; }
	tr.inactiva { opacity: 0.45; }
	tr.editrow { background: rgba(91, 157, 255, 0.08); }
	td.acc { white-space: nowrap; }
	.lapiz { background: none; border: none; cursor: pointer; opacity: 0.6; padding: 2px 4px; }
	.lapiz:hover { opacity: 1; }
	.del { background: rgba(248, 113, 113, 0.15); color: var(--neg); padding: 3px 8px; margin-left: 2px; }
	.editbox { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 14px; margin: 12px 0; max-width: 380px; }
	.botones { display: flex; gap: 8px; }
	.btn-volver { display: block; color: var(--accent); text-decoration: none; font-size: 0.9rem; margin: 4px 0 8px; }
	.btn-volver:hover { text-decoration: underline; }
</style>
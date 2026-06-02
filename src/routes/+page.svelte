<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';

	let categorias = $state<any[]>([]);
	let subcategorias = $state<any[]>([]);
	let tarjetasCredito = $state<any[]>([]);
	let detallesExistentes = $state<string[]>([]);
	let ultimos = $state<any[]>([]);

	let fecha = $state(new Date().toISOString().slice(0, 10));
	let monto = $state<number | null>(null);
	let moneda = $state('ARS');
	let categoriaId = $state<number | null>(null);
	let detalle = $state('');
	let medio = $state<'debito' | 'credito'>('debito');
	let tarjetaId = $state<number | null>(null);
	let cuotas = $state(1);
	let mesInicio = $state(new Date().toISOString().slice(0, 7));

	let subcatDerivada = $state<string | null>(null);
	let detalleNuevo = $state(false);
	let modoSubcat = $state<'existente' | 'nueva'>('existente');
	let subcatSelId = $state<number | null>(null);
	let subcatNuevaNombre = $state('');

	let editandoId = $state<number | null>(null);
	let mensaje = $state('');

	async function cargarBase() {
		categorias = await query('SELECT id, nombre FROM categoria WHERE perfil_id=1 AND activa=1 ORDER BY nombre');
		subcategorias = await query('SELECT id, nombre FROM subcategoria WHERE perfil_id=1 AND activa=1 ORDER BY nombre');
		tarjetasCredito = await query("SELECT id, nombre FROM tarjeta WHERE perfil_id=1 AND tipo='credito' AND activa=1 ORDER BY nombre");
		const d = await query('SELECT DISTINCT detalle FROM mapeo_detalle WHERE perfil_id=1 ORDER BY detalle');
		detallesExistentes = d.map((x: any) => x.detalle);
		await cargarUltimos();
	}

	async function cargarUltimos() {
		ultimos = await query(`
			SELECT g.id, g.fecha, g.monto, g.moneda, g.categoria_id, c.nombre AS categoria, g.detalle, g.medio,
			       g.subcategoria_id, COALESCE(s.nombre, sm.nombre) AS subcategoria,
			       g.tarjeta_id, t.nombre AS tarjeta, g.cuotas, g.mes_inicio_pago
			FROM gasto g
			JOIN categoria c ON c.id = g.categoria_id
			LEFT JOIN subcategoria s ON s.id = g.subcategoria_id
			LEFT JOIN mapeo_detalle md ON md.perfil_id = g.perfil_id AND md.detalle = g.detalle
			LEFT JOIN subcategoria sm ON sm.id = md.subcategoria_id
			LEFT JOIN tarjeta t ON t.id = g.tarjeta_id
			WHERE g.perfil_id = 1
			ORDER BY g.fecha DESC, g.id DESC LIMIT 30
		`);
	}

	onMount(cargarBase);

	$effect(() => {
		const d = detalle.trim();
		if (!d) { subcatDerivada = null; detalleNuevo = false; return; }
		query('SELECT s.nombre FROM mapeo_detalle m JOIN subcategoria s ON s.id=m.subcategoria_id WHERE m.perfil_id=1 AND m.detalle=?', [d])
			.then((r: any) => {
				if (r.length) { subcatDerivada = r[0].nombre; detalleNuevo = false; }
				else { subcatDerivada = null; detalleNuevo = true; }
			});
	});

	function resetForm() {
		editandoId = null;
		monto = null; detalle = ''; subcatSelId = null; subcatNuevaNombre = ''; modoSubcat = 'existente';
		medio = 'debito'; tarjetaId = null; cuotas = 1;
		fecha = new Date().toISOString().slice(0, 10);
		mesInicio = new Date().toISOString().slice(0, 7);
		moneda = 'ARS'; categoriaId = null;
	}

	function editar(g: any) {
		editandoId = g.id;
		fecha = g.fecha;
		monto = g.monto;
		moneda = g.moneda;
		categoriaId = g.categoria_id;
		detalle = g.detalle;
		medio = g.medio;
		tarjetaId = g.tarjeta_id;
		cuotas = g.cuotas ?? 1;
		mesInicio = g.mes_inicio_pago ? g.mes_inicio_pago.slice(0, 7) : new Date().toISOString().slice(0, 7);
		mensaje = '';
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	async function eliminar(id: number) {
		if (!confirm('¿Eliminar este gasto? No se puede deshacer.')) return;
		await query('DELETE FROM gasto WHERE id=? AND perfil_id=1', [id]);
		if (editandoId === id) resetForm();
		await cargarUltimos();
	}

	async function guardar() {
		mensaje = '';
		const m = Number(monto);
		if (!fecha) return (mensaje = 'Falta la fecha');
		if (!m || m <= 0) return (mensaje = 'El monto debe ser mayor a 0');
		if (!categoriaId) return (mensaje = 'Elegí una categoría');
		if (!detalle.trim()) return (mensaje = 'Falta el detalle');
		if (medio === 'credito') {
			if (!tarjetaId) return (mensaje = 'Elegí la tarjeta');
			if (!cuotas || cuotas < 1) return (mensaje = 'Cuotas inválidas');
			if (!mesInicio) return (mensaje = 'Falta el mes de inicio de pago');
		}
		const dTrim = detalle.trim();
		try {
			if (detalleNuevo) {
				let subId: number | null = null;
				if (modoSubcat === 'nueva' && subcatNuevaNombre.trim()) {
					const nom = subcatNuevaNombre.trim();
					await query('INSERT OR IGNORE INTO subcategoria (perfil_id, nombre) VALUES (1, ?)', [nom]);
					const r = await query('SELECT id FROM subcategoria WHERE perfil_id=1 AND nombre=?', [nom]);
					subId = r[0].id;
				} else if (modoSubcat === 'existente' && subcatSelId) {
					subId = subcatSelId;
				}
				if (subId) await query('INSERT OR IGNORE INTO mapeo_detalle (perfil_id, detalle, subcategoria_id) VALUES (1, ?, ?)', [dTrim, subId]);
			}

			if (editandoId) {
				// UPDATE
				if (medio === 'debito') {
					await query('UPDATE gasto SET fecha=?, monto=?, moneda=?, categoria_id=?, detalle=?, medio=?, tarjeta_id=NULL, cuotas=1, mes_inicio_pago=NULL WHERE id=? AND perfil_id=1',
						[fecha, m, moneda, categoriaId, dTrim, 'debito', editandoId]);
				} else {
					await query('UPDATE gasto SET fecha=?, monto=?, moneda=?, categoria_id=?, detalle=?, medio=?, tarjeta_id=?, cuotas=?, mes_inicio_pago=? WHERE id=? AND perfil_id=1',
						[fecha, m, moneda, categoriaId, dTrim, 'credito', tarjetaId, cuotas, mesInicio + '-01', editandoId]);
				}
				mensaje = 'Gasto actualizado ✅';
			} else {
				// INSERT
				if (medio === 'debito') {
					await query('INSERT INTO gasto (perfil_id,fecha,monto,moneda,categoria_id,detalle,medio,cuotas) VALUES (1,?,?,?,?,?,?,1)',
						[fecha, m, moneda, categoriaId, dTrim, 'debito']);
				} else {
					await query('INSERT INTO gasto (perfil_id,fecha,monto,moneda,categoria_id,detalle,medio,tarjeta_id,cuotas,mes_inicio_pago) VALUES (1,?,?,?,?,?,?,?,?,?)',
						[fecha, m, moneda, categoriaId, dTrim, 'credito', tarjetaId, cuotas, mesInicio + '-01']);
				}
				mensaje = 'Gasto guardado ✅';
			}
			resetForm();
			await cargarBase();
		} catch (e: any) {
			mensaje = 'Error: ' + (e?.message ?? String(e));
		}
	}

	const fmt = (n: number, mon: string) => (mon === 'USD' ? 'U$D ' : '$') + Number(n).toLocaleString('es-AR');
</script>

<h1>Rienda — {editandoId ? 'Editar gasto' : 'Cargar gasto'}</h1>

<div class="form">
	{#if editandoId}<p class="editando">✏️ Editando gasto #{editandoId} · <button class="link" onclick={resetForm}>cancelar</button></p>{/if}
	<label>Fecha<input type="date" bind:value={fecha} /></label>
	<label>Monto<input type="number" step="0.01" min="0" bind:value={monto} placeholder="0" /></label>
	<label>Moneda
		<select bind:value={moneda}><option value="ARS">ARS</option><option value="USD">USD</option></select>
	</label>
	<label>Categoría
		<select bind:value={categoriaId}>
			<option value={null} disabled>Elegir…</option>
			{#each categorias as c (c.id)}<option value={c.id}>{c.nombre}</option>{/each}
		</select>
	</label>
	<label>Detalle
		<input list="detalles" bind:value={detalle} placeholder="Ej: Pizza, Auto, Kiosco…" />
		<datalist id="detalles">{#each detallesExistentes as d (d)}<option value={d}></option>{/each}</datalist>
	</label>

	{#if detalle.trim()}
		{#if !detalleNuevo}
			<p class="hint">Subcategoría: <strong>{subcatDerivada}</strong></p>
		{:else}
			<div class="nuevo">
				<p class="hint">Detalle nuevo. Asignale una subcategoría (se recuerda para este y los próximos):</p>
				<div class="medio">
					<button type="button" class:activo={modoSubcat === 'existente'} onclick={() => (modoSubcat = 'existente')}>Usar existente</button>
					<button type="button" class:activo={modoSubcat === 'nueva'} onclick={() => (modoSubcat = 'nueva')}>Crear nueva</button>
				</div>
				{#if modoSubcat === 'existente'}
					<select bind:value={subcatSelId}>
						<option value={null} disabled>Elegir subcategoría…</option>
						{#each subcategorias as s (s.id)}<option value={s.id}>{s.nombre}</option>{/each}
					</select>
				{:else}
					<input bind:value={subcatNuevaNombre} placeholder="Nombre de la nueva subcategoría" />
				{/if}
			</div>
		{/if}
	{/if}

	<div class="medio">
		<button type="button" class:activo={medio === 'debito'} onclick={() => (medio = 'debito')}>Débito</button>
		<button type="button" class:activo={medio === 'credito'} onclick={() => (medio = 'credito')}>Crédito</button>
	</div>

	{#if medio === 'credito'}
		<label>Tarjeta
			<select bind:value={tarjetaId}>
				<option value={null} disabled>Elegir…</option>
				{#each tarjetasCredito as t (t.id)}<option value={t.id}>{t.nombre}</option>{/each}
			</select>
		</label>
		<label>Cuotas<input type="number" min="1" bind:value={cuotas} /></label>
		<label>Mes inicio de pago<input type="month" bind:value={mesInicio} /></label>
	{/if}

	<button class="guardar" onclick={guardar}>{editandoId ? 'Actualizar gasto' : 'Guardar gasto'}</button>
	{#if mensaje}<p class="msg">{mensaje}</p>{/if}
</div>

<h2>Últimos gastos</h2>
<table>
	<thead><tr><th>Fecha</th><th>Detalle</th><th>Subcat.</th><th>Categoría</th><th>Medio</th><th class="num">Monto</th><th></th></tr></thead>
	<tbody>
		{#each ultimos as g (g.id)}
			<tr class:editrow={editandoId === g.id}>
				<td>{g.fecha}</td>
				<td>{g.detalle}</td>
				<td>{g.subcategoria ?? '—'}</td>
				<td>{g.categoria}</td>
				<td>{g.medio}{g.medio === 'credito' && g.cuotas > 1 ? ` ${g.cuotas}c` : ''}{g.tarjeta ? ` · ${g.tarjeta}` : ''}</td>
				<td class="num">{fmt(g.monto, g.moneda)}</td>
				<td class="acc">
					<button class="lapiz" onclick={() => editar(g)} title="Editar">✏️</button>
					<button class="del" onclick={() => eliminar(g.id)} title="Eliminar">✕</button>
				</td>
			</tr>
		{/each}
	</tbody>
</table>

<style>
	:global(body) { font-family: system-ui, sans-serif; max-width: 820px; margin: 0 auto; padding: 16px; }
	.form { display: flex; flex-direction: column; gap: 10px; max-width: 360px; margin: 0 auto; }
	label { display: flex; flex-direction: column; font-size: 0.85rem; color: #444; gap: 3px; }
	input, select { padding: 7px; font-size: 1rem; border: 1px solid #bbb; border-radius: 6px; }
	.medio { display: flex; gap: 8px; }
	.medio button { flex: 1; padding: 8px; border: 1px solid #bbb; background: #f5f5f5; border-radius: 6px; cursor: pointer; }
	.medio button.activo { background: #1a73e8; color: #fff; border-color: #1a73e8; }
	.guardar { padding: 10px; font-size: 1rem; background: #1a73e8; color: #fff; border: none; border-radius: 6px; cursor: pointer; margin-top: 4px; }
	.nuevo { border: 1px dashed #c8a000; background: #fffceb; padding: 10px; border-radius: 6px; display: flex; flex-direction: column; gap: 8px; }
	.hint { font-size: 0.85rem; color: #555; margin: 0; }
	.msg { font-weight: 600; }
	.editando { font-size: 0.85rem; color: #8a4b00; background: #fff3e0; padding: 6px 10px; border-radius: 6px; margin: 0; }
	.link { background: none; border: none; color: #1a73e8; cursor: pointer; text-decoration: underline; font-size: 0.85rem; padding: 0; }
	table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 0.9rem; }
	th, td { border: 1px solid #ddd; padding: 5px 8px; text-align: left; }
	td.num, th.num { text-align: right; white-space: nowrap; }
	tr.editrow { background: #fff8e1; }
	td.acc { white-space: nowrap; }
	.lapiz { background: none; border: none; cursor: pointer; opacity: 0.6; }
	.lapiz:hover { opacity: 1; }
	.del { background: #fce8e6; color: #c5221f; border: none; border-radius: 5px; padding: 2px 8px; cursor: pointer; margin-left: 4px; }
</style>
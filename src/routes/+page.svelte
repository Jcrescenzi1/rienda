<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';

	let categorias = $state<any[]>([]);
	let subcategorias = $state<any[]>([]);
	let tarjetasCredito = $state<any[]>([]);
	let detallesExistentes = $state<string[]>([]);
	let ultimos = $state<any[]>([]);

	// Formulario
	let fecha = $state(new Date().toISOString().slice(0, 10));
	let monto = $state<number | null>(null);
	let moneda = $state('ARS');
	let categoriaId = $state<number | null>(null);
	let detalle = $state('');
	let medio = $state<'debito' | 'credito'>('debito');
	let tarjetaId = $state<number | null>(null);
	let cuotas = $state(1);
	let mesInicio = $state(new Date().toISOString().slice(0, 7));

	// Subcategoría / aprendizaje
	let subcatDerivada = $state<string | null>(null);
	let detalleNuevo = $state(false);
	let modoSubcat = $state<'existente' | 'nueva'>('existente');
	let subcatSelId = $state<number | null>(null);
	let subcatNuevaNombre = $state('');

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
			SELECT g.id, g.fecha, g.monto, g.moneda, c.nombre AS categoria, g.detalle, g.medio,
			       COALESCE(s.nombre, sm.nombre) AS subcategoria, t.nombre AS tarjeta, g.cuotas
			FROM gasto g
			JOIN categoria c ON c.id = g.categoria_id
			LEFT JOIN subcategoria s ON s.id = g.subcategoria_id
			LEFT JOIN mapeo_detalle md ON md.perfil_id = g.perfil_id AND md.detalle = g.detalle
			LEFT JOIN subcategoria sm ON sm.id = md.subcategoria_id
			LEFT JOIN tarjeta t ON t.id = g.tarjeta_id
			WHERE g.perfil_id = 1
			ORDER BY g.id DESC LIMIT 12
		`);
	}

	onMount(cargarBase);

	// Detecta en vivo si el detalle ya tiene subcategoría o es nuevo
	$effect(() => {
		const d = detalle.trim();
		if (!d) {
			subcatDerivada = null;
			detalleNuevo = false;
			return;
		}
		query(
			'SELECT s.nombre FROM mapeo_detalle m JOIN subcategoria s ON s.id=m.subcategoria_id WHERE m.perfil_id=1 AND m.detalle=?',
			[d]
		).then((r: any) => {
			if (r.length) {
				subcatDerivada = r[0].nombre;
				detalleNuevo = false;
			} else {
				subcatDerivada = null;
				detalleNuevo = true;
			}
		});
	});

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
			// Si el detalle es nuevo y el usuario asignó subcategoría, la recordamos
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
				if (subId) {
					await query('INSERT OR IGNORE INTO mapeo_detalle (perfil_id, detalle, subcategoria_id) VALUES (1, ?, ?)', [dTrim, subId]);
				}
			}

			// Inserta el gasto
			if (medio === 'debito') {
				await query(
					'INSERT INTO gasto (perfil_id,fecha,monto,moneda,categoria_id,detalle,medio,cuotas) VALUES (1,?,?,?,?,?,?,1)',
					[fecha, m, moneda, categoriaId, dTrim, 'debito']
				);
			} else {
				await query(
					'INSERT INTO gasto (perfil_id,fecha,monto,moneda,categoria_id,detalle,medio,tarjeta_id,cuotas,mes_inicio_pago) VALUES (1,?,?,?,?,?,?,?,?,?)',
					[fecha, m, moneda, categoriaId, dTrim, 'credito', tarjetaId, cuotas, mesInicio + '-01']
				);
			}

			mensaje = 'Gasto guardado ✅';
			monto = null;
			detalle = '';
			subcatSelId = null;
			subcatNuevaNombre = '';
			modoSubcat = 'existente';
			await cargarBase(); // refresca detalles/subcategorías nuevos
		} catch (e: any) {
			mensaje = 'Error: ' + (e?.message ?? String(e));
		}
	}

	const fmt = (n: number, mon: string) => (mon === 'USD' ? 'U$D ' : '$') + Number(n).toLocaleString('es-AR');
</script>

<h1>Rienda — Cargar gasto</h1>
<button onclick={async () => { await query('DELETE FROM gasto WHERE perfil_id=1 AND id > 2059'); await cargarBase(); }}>🧹 Borrar gastos de prueba</button>

<div class="form">
	<label>Fecha<input type="date" bind:value={fecha} /></label>
	<label>Monto<input type="number" step="0.01" min="0" bind:value={monto} placeholder="0" /></label>

	<label>Moneda
		<select bind:value={moneda}>
			<option value="ARS">ARS</option>
			<option value="USD">USD</option>
		</select>
	</label>

	<label>Categoría
		<select bind:value={categoriaId}>
			<option value={null} disabled>Elegir…</option>
			{#each categorias as c (c.id)}<option value={c.id}>{c.nombre}</option>{/each}
		</select>
	</label>

	<label>Detalle
		<input list="detalles" bind:value={detalle} placeholder="Ej: Pizza, Auto, Kiosco…" />
		<datalist id="detalles">
			{#each detallesExistentes as d (d)}<option value={d}></option>{/each}
		</datalist>
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

	<button class="guardar" onclick={guardar}>Guardar gasto</button>
	{#if mensaje}<p class="msg">{mensaje}</p>{/if}
</div>

<h2>Últimos gastos</h2>
<table>
	<thead><tr><th>Fecha</th><th>Detalle</th><th>Subcat.</th><th>Categoría</th><th>Medio</th><th>Monto</th></tr></thead>
	<tbody>
		{#each ultimos as g (g.id)}
			<tr>
				<td>{g.fecha}</td>
				<td>{g.detalle}</td>
				<td>{g.subcategoria ?? '—'}</td>
				<td>{g.categoria}</td>
				<td>{g.medio}{g.medio === 'credito' && g.cuotas > 1 ? ` ${g.cuotas}c` : ''}{g.tarjeta ? ` · ${g.tarjeta}` : ''}</td>
				<td class="num">{fmt(g.monto, g.moneda)}</td>
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
	table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 0.9rem; }
	th, td { border: 1px solid #ddd; padding: 5px 8px; text-align: left; }
	td.num { text-align: right; white-space: nowrap; }
</style>
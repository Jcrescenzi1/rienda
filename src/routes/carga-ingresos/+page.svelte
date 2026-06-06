<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';

	const hoy = new Date();
	let periodoSel = $state(hoy.toISOString().slice(0, 7));

	let ingresos = $state<any[]>([]);
	let resumen = $state<any>({ principal: 0, secundario: 0, otros: 0 });
	let mensaje = $state('');

	// Form
	let fecha = $state(hoy.toISOString().slice(0, 10));
	let monto = $state<number | null>(null);
	let moneda = $state('ARS');
	let categoria = $state<'Ingreso Principal' | 'Ingresos Secundarios' | 'Otros'>('Ingreso Principal');
	let tipo = $state<'Sueldo' | 'Aciclico'>('Sueldo');
	let detalle = $state('');
	let periodoIngreso = $state('');

	const esPrincipal = $derived(categoria === 'Ingreso Principal');

	// Período sugerido según la fecha:
	//  - Ingreso Principal: día < 20 → mes corriente; día >= 20 → mes siguiente.
	//  - Secundarios / Otros: siempre el mes corriente.
	function periodoRegla(f: string, cat: string): string {
		const [y, m, d] = f.split('-').map(Number);
		const delta = cat === 'Ingreso Principal' && d >= 20 ? 1 : 0;
		const fechaP = new Date(y, m - 1 + delta, 1);
		return fechaP.getFullYear() + '-' + String(fechaP.getMonth() + 1).padStart(2, '0');
	}

	// Recalcula el período sugerido al cambiar fecha o categoría
	$effect(() => {
		periodoIngreso = periodoRegla(fecha, categoria);
	});

	async function cargar() {
		ingresos = (await query(
			'SELECT id, fecha, monto, moneda, categoria, tipo, detalle, periodo FROM ingreso WHERE perfil_id=1 ORDER BY periodo DESC, fecha DESC, id DESC'
		)) as any[];
		const delMes = ingresos.filter((i) => i.periodo === periodoSel);
		resumen = {
			principal: delMes.filter((i) => i.categoria === 'Ingreso Principal').reduce((s, i) => s + i.monto, 0),
			secundario: delMes.filter((i) => i.categoria === 'Ingresos Secundarios').reduce((s, i) => s + i.monto, 0),
			otros: delMes.filter((i) => i.categoria === 'Otros').reduce((s, i) => s + i.monto, 0)
		};
	}

	onMount(cargar);

	async function guardar() {
		mensaje = '';
		const m = Number(monto);
		if (!fecha) return (mensaje = 'Falta la fecha');
		if (!m || m <= 0) return (mensaje = 'Monto inválido');
		if (!periodoIngreso) return (mensaje = 'Falta el período');
		// tipo solo aplica a Ingreso Principal; en el resto va NULL
		const t = esPrincipal ? tipo : null;
		try {
			await query(
				'INSERT INTO ingreso (perfil_id,fecha,monto,moneda,categoria,tipo,detalle,periodo) VALUES (1,?,?,?,?,?,?,?)',
				[fecha, m, moneda, categoria, t, detalle.trim() || null, periodoIngreso]
			);
			mensaje = 'Ingreso guardado ✅';
			monto = null;
			detalle = '';
			await cargar();
		} catch (e: any) {
			mensaje = 'Error: ' + (e?.message ?? String(e));
		}
	}

	async function borrar(id: number) {
		if (!confirm('¿Borrar este ingreso?')) return;
		await query('DELETE FROM ingreso WHERE id=?', [id]);
		await cargar();
	}

	const peso = (n: number, mon = 'ARS') => (mon === 'USD' ? 'U$D ' : '$') + Math.round(n || 0).toLocaleString('es-AR');
	// Etiqueta visible del tipo (interno Sueldo/Aciclico → Regular/Extraordinario)
	const tipoLabel = (t: string | null) => t === 'Sueldo' ? 'Regular' : t === 'Aciclico' ? 'Extraordinario' : '—';
	// Etiqueta visible de la categoría para la tabla
	const catLabel = (c: string) => c === 'Ingreso Principal' ? 'Principal' : c === 'Ingresos Secundarios' ? 'Secundario' : 'Otros';
</script>

<h1>Carga de Ingresos</h1>
<a href="/ingresos" class="btn-volver">← Volver a Ingresos</a>
<label class="sel">Mes / Año: <input type="month" bind:value={periodoSel} onchange={cargar} /></label>

<div class="cards">
	<div class="card"><span>Principal</span><strong>{peso(resumen.principal)}</strong></div>
	<div class="card"><span>Secundarios</span><strong>{peso(resumen.secundario)}</strong></div>
	<div class="card"><span>Otros</span><strong>{peso(resumen.otros)}</strong></div>
	<div class="card tot"><span>Total período</span><strong>{peso(resumen.principal + resumen.secundario + resumen.otros)}</strong></div>
</div>

<h2>Cargar ingreso</h2>
<div class="form">
	<label>Fecha<input type="date" bind:value={fecha} /></label>
	<label>Monto<input type="number" min="0" bind:value={monto} /></label>
	<label>Moneda<select bind:value={moneda}><option>ARS</option><option>USD</option></select></label>

	<label>Categoría
		<select bind:value={categoria}>
			<option value="Ingreso Principal">Ingreso Principal</option>
			<option value="Ingresos Secundarios">Ingresos Secundarios</option>
			<option value="Otros">Otros</option>
		</select>
	</label>
	<p class="hint">El Ingreso Principal marca el ritmo de tus períodos. Secundarios y Otros se ajustan a ese mes.</p>

	{#if esPrincipal}
		<label>Tipo de ingreso
			<select bind:value={tipo}>
				<option value="Sueldo">Regular</option>
				<option value="Aciclico">Extraordinario</option>
			</select>
		</label>
		<p class="hint">Regular: tu ingreso recurrente (sueldo, jubilación, renta). Extraordinario: cobros extra como aguinaldo o bonos.</p>
	{/if}

	<label>Período (mes al que pertenece)<input type="month" bind:value={periodoIngreso} /></label>
	<p class="hint">Sugerido según tu fecha de cobro. Podés cambiarlo.</p>

	<label>Detalle (opcional)<input bind:value={detalle} placeholder="Ej: Aguinaldo, Cochera, Dólares…" /></label>
	<button class="guardar" onclick={guardar}>Guardar ingreso</button>
	{#if mensaje}<p class="msg">{mensaje}</p>{/if}
</div>

<h2>Ingresos cargados</h2>
<table>
	<thead><tr><th>Fecha</th><th>Período</th><th>Categoría</th><th>Tipo</th><th>Detalle</th><th>Monto</th><th></th></tr></thead>
	<tbody>
		{#each ingresos as i (i.id)}
			<tr class:foco={i.periodo === periodoSel}>
				<td>{i.fecha}</td>
				<td>{i.periodo ?? '—'}</td>
				<td>{catLabel(i.categoria)}</td>
				<td>{tipoLabel(i.tipo)}</td>
				<td>{i.detalle ?? '—'}</td>
				<td class="num">{peso(i.monto, i.moneda)}</td>
				<td><button class="sec" onclick={() => borrar(i.id)}>✕</button></td>
			</tr>
		{/each}
		{#if ingresos.length === 0}<tr><td colspan="7" class="vacio">Todavía no hay ingresos.</td></tr>{/if}
	</tbody>
</table>

<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	.sel { font-size: 0.9rem; display: inline-flex; gap: 8px; align-items: center; }
	h2 { font-size: 1.1rem; margin-top: 22px; }
	.cards { display: flex; gap: 10px; flex-wrap: wrap; margin: 12px 0; }
	.card { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 8px 14px; display: flex; flex-direction: column; min-width: 120px; }
	.card span { font-size: 0.72rem; color: var(--text-dim); }
	.card strong { font-size: 1.05rem; }
	.card.tot { border-color: var(--accent); }
	.form { display: flex; flex-direction: column; gap: 8px; max-width: 340px; }
	label { display: flex; flex-direction: column; font-size: 0.82rem; color: var(--text-dim); gap: 3px; }
	input, select { padding: 6px; font-size: 0.95rem; }
	button { padding: 6px 12px; background: var(--accent); color: #fff; border: none; border-radius: 6px; cursor: pointer; }
	button.sec { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); }
	.guardar { padding: 9px; margin-top: 4px; }
	.hint { font-size: 0.78rem; color: var(--text-dim); margin: 0; line-height: 1.35; }
	table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
	th, td { padding: 5px 8px; text-align: left; }
	td.num, th.num { text-align: right; white-space: nowrap; }
	.msg { font-weight: 600; color: var(--text); }
	.vacio { color: var(--text-dim); font-style: italic; text-align: center; }
	.btn-volver { display: inline-block; color: var(--accent); text-decoration: none; font-size: 0.9rem; margin: 4px 0 12px; }
	.btn-volver:hover { text-decoration: underline; }
</style>
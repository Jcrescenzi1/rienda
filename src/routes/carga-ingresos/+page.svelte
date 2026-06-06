<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import { fmtFecha } from '$lib/format';

	const hoy = new Date();
	let periodoSel = $state(hoy.toISOString().slice(0, 7));

	let ingresos = $state<any[]>([]);
	let resumen = $state<any>({ sueldo: 0, aciclico: 0, otros: 0 });
	let mensaje = $state('');

	// Form
	let fecha = $state(hoy.toISOString().slice(0, 10));
	let monto = $state<number | null>(null);
	let moneda = $state('ARS');
	let categoria = $state<'Salario' | 'Otros'>('Salario');
	let tipo = $state<'Sueldo' | 'Aciclico'>('Sueldo');
	let detalle = $state('');
	let periodoIngreso = $state('');

	// Calcula el período por defecto según la regla (Salario -> mes siguiente; Otros -> mismo mes)
	function periodoRegla(f: string, cat: string): string {
		const [y, m] = f.split('-').map(Number);
		const d = cat === 'Salario' ? new Date(y, m, 1) : new Date(y, m - 1, 1);
		return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
	}

	// Cuando cambian fecha o categoría, recalcula el período sugerido
	$effect(() => {
		periodoIngreso = periodoRegla(fecha, categoria);
	});

	async function cargar() {
		ingresos = (await query(
			'SELECT id, fecha, monto, moneda, categoria, tipo, detalle, periodo FROM ingreso WHERE perfil_id=1 ORDER BY periodo DESC, fecha DESC, id DESC'
		)) as any[];
		const delMes = ingresos.filter((i) => i.periodo === periodoSel);
		resumen = {
			sueldo: delMes.filter((i) => i.tipo === 'Sueldo').reduce((s, i) => s + i.monto, 0),
			aciclico: delMes.filter((i) => i.tipo === 'Aciclico').reduce((s, i) => s + i.monto, 0),
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
		const t = categoria === 'Salario' ? tipo : null;
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
</script>

<h1>Carga de Ingresos</h1>
<a href="/ingresos" class="btn-volver">← Volver a Ingresos</a>
<label class="sel">Mes / Año: <input type="month" bind:value={periodoSel} onchange={cargar} /></label>

<div class="cards">
	<div class="card"><span>Sueldo</span><strong>{peso(resumen.sueldo)}</strong></div>
	<div class="card"><span>Acíclicos</span><strong>{peso(resumen.aciclico)}</strong></div>
	<div class="card"><span>Otros</span><strong>{peso(resumen.otros)}</strong></div>
	<div class="card tot"><span>Total período</span><strong>{peso(resumen.sueldo + resumen.aciclico + resumen.otros)}</strong></div>
</div>

<h2>Cargar ingreso</h2>
<div class="form">
	<label>Fecha<input type="date" bind:value={fecha} /></label>
	<label>Monto<input type="number" min="0" bind:value={monto} /></label>
	<label>Moneda<select bind:value={moneda}><option>ARS</option><option>USD</option></select></label>

	<div class="medio">
		<button type="button" class:activo={categoria === 'Salario'} onclick={() => (categoria = 'Salario')}>Salario</button>
		<button type="button" class:activo={categoria === 'Otros'} onclick={() => (categoria = 'Otros')}>Otros</button>
	</div>

	{#if categoria === 'Salario'}
		<div class="medio">
			<button type="button" class:activo={tipo === 'Sueldo'} onclick={() => (tipo = 'Sueldo')}>Sueldo</button>
			<button type="button" class:activo={tipo === 'Aciclico'} onclick={() => (tipo = 'Aciclico')}>Acíclico</button>
		</div>
	{/if}

	<label>Período (mes al que pertenece)<input type="month" bind:value={periodoIngreso} /></label>

	<label>Detalle (opcional)<input bind:value={detalle} placeholder="Ej: Aguinaldo, Cochera, Dolares…" /></label>
	<button class="guardar" onclick={guardar}>Guardar ingreso</button>
	{#if mensaje}<p class="msg">{mensaje}</p>{/if}
</div>

<h2>Ingresos cargados</h2>
<table>
	<thead><tr><th>Fecha</th><th>Período</th><th>Tipo</th><th>Detalle</th><th>Monto</th><th></th></tr></thead>
	<tbody>
		{#each ingresos as i (i.id)}
			<tr class:foco={i.periodo === periodoSel}>
				<td>{fmtFecha(i.fecha)}</td>
				<td>{i.periodo ?? '—'}</td>
				<td>{i.categoria === 'Otros' ? 'Otros' : i.tipo}</td>
				<td>{i.detalle ?? '—'}</td>
				<td class="num">{peso(i.monto, i.moneda)}</td>
				<td><button class="sec" onclick={() => borrar(i.id)}>✕</button></td>
			</tr>
		{/each}
		{#if ingresos.length === 0}<tr><td colspan="6" class="vacio">Todavía no hay ingresos.</td></tr>{/if}
	</tbody>
</table>

<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	.sel { font-size: 0.9rem; display: inline-flex; gap: 8px; align-items: center; }
	h2 { font-size: 1.1rem; margin-top: 22px; }
	.form { display: flex; flex-direction: column; gap: 8px; max-width: 340px; }
	label { display: flex; flex-direction: column; font-size: 0.82rem; color: var(--text-dim); gap: 3px; }
	input, select { padding: 6px; font-size: 0.95rem; }
	button { padding: 6px 12px; background: var(--accent); color: #fff; border: none; border-radius: 6px; cursor: pointer; }
	button.sec { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); }
	.guardar { padding: 9px; margin-top: 4px; }
	table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
	th, td { padding: 5px 8px; text-align: left; }
	td.num, th.num { text-align: right; white-space: nowrap; }
	.msg { font-weight: 600; color: var(--text); }
	.vacio { color: var(--text-dim); font-style: italic; text-align: center; }
	tr.editrow { background: rgba(91, 157, 255, 0.08); }
	.lapiz { background: none; border: none; cursor: pointer; opacity: 0.6; }
	.lapiz:hover { opacity: 1; }
	.del { background: rgba(248, 113, 113, 0.15); color: var(--neg); border: none; border-radius: 5px; padding: 2px 8px; cursor: pointer; }
	.nota { font-size: 0.8rem; color: var(--text-dim); margin-top: 12px; }
	.btn-volver { display: inline-block; color: var(--accent); text-decoration: none; font-size: 0.9rem; margin: 4px 0 12px; }
	.btn-volver:hover { text-decoration: underline; }
</style>
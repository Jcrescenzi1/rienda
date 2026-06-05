<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';

	let cargando = $state(true);
	let categorias = $state<any[]>([]);
	let tarjetas = $state<any[]>([]);

	// Alta de categoría
	let nuevaCat = $state('');
	// Alta de tarjeta
	let ntNombre = $state('');
	let ntProveedor = $state('Visa');
	let ntTipo = $state<'credito' | 'debito'>('credito');

	// Edición inline
	let editCatId = $state<number | null>(null);
	let editCatNombre = $state('');
	let editTarId = $state<number | null>(null);
	let editTarNombre = $state('');

	let msg = $state('');

	async function cargar() {
		// Categorías con conteo de gastos asociados
		categorias = (await query(`
			SELECT c.id, c.nombre,
				(SELECT COUNT(*) FROM gasto g WHERE g.categoria_id = c.id) AS usos
			FROM categoria c WHERE c.perfil_id=1 ORDER BY c.nombre
		`)) as any[];

		// Tarjetas con conteo de gastos + suscripciones asociadas
		tarjetas = (await query(`
			SELECT t.id, t.nombre, t.proveedor, t.tipo,
				(SELECT COUNT(*) FROM gasto g WHERE g.tarjeta_id = t.id)
				+ (SELECT COUNT(*) FROM suscripcion s WHERE s.tarjeta_id = t.id) AS usos
			FROM tarjeta t WHERE t.perfil_id=1 ORDER BY t.nombre
		`)) as any[];

		cargando = false;
	}
	onMount(cargar);

	function flash(t: string) { msg = t; setTimeout(() => (msg = ''), 3000); }

	// ===== Categorías =====
	async function crearCat() {
		const n = nuevaCat.trim();
		if (!n) return;
		try {
			await query('INSERT INTO categoria (perfil_id, nombre) VALUES (1, ?)', [n]);
			nuevaCat = ''; await cargar(); flash('Categoría creada ✅');
		} catch (e: any) {
			flash(e?.message?.includes('UNIQUE') ? 'Ya existe una categoría con ese nombre.' : 'Error: ' + (e?.message ?? e));
		}
	}
	function abrirEditCat(c: any) { editCatId = c.id; editCatNombre = c.nombre; }
	async function guardarCat() {
		const n = editCatNombre.trim();
		if (editCatId == null || !n) { editCatId = null; return; }
		try {
			await query('UPDATE categoria SET nombre=? WHERE id=? AND perfil_id=1', [n, editCatId]);
			editCatId = null; await cargar(); flash('Categoría renombrada ✅');
		} catch (e: any) {
			flash(e?.message?.includes('UNIQUE') ? 'Ya existe una categoría con ese nombre.' : 'Error: ' + (e?.message ?? e));
		}
	}
	async function borrarCat(c: any) {
		if (c.usos > 0) {
			alert(`No se puede eliminar "${c.nombre}": tiene ${c.usos} gasto(s) asociado(s). Primero reasigná o eliminá esos gastos.`);
			return;
		}
		if (!confirm(`¿Eliminar la categoría "${c.nombre}"?`)) return;
		try {
			await query('DELETE FROM categoria WHERE id=? AND perfil_id=1', [c.id]);
			await cargar(); flash('Categoría eliminada ✅');
		} catch (e: any) { flash('Error: ' + (e?.message ?? e)); }
	}

	// ===== Tarjetas =====
	async function crearTar() {
		const n = ntNombre.trim();
		if (!n) return;
		try {
			await query('INSERT INTO tarjeta (perfil_id, nombre, proveedor, tipo) VALUES (1, ?, ?, ?)', [n, ntProveedor, ntTipo]);
			ntNombre = ''; await cargar(); flash('Tarjeta creada ✅');
		} catch (e: any) {
			flash(e?.message?.includes('UNIQUE') ? 'Ya existe una tarjeta con ese nombre.' : 'Error: ' + (e?.message ?? e));
		}
	}
	function abrirEditTar(t: any) { editTarId = t.id; editTarNombre = t.nombre; }
	async function guardarTar() {
		const n = editTarNombre.trim();
		if (editTarId == null || !n) { editTarId = null; return; }
		try {
			await query('UPDATE tarjeta SET nombre=? WHERE id=? AND perfil_id=1', [n, editTarId]);
			editTarId = null; await cargar(); flash('Tarjeta renombrada ✅');
		} catch (e: any) {
			flash(e?.message?.includes('UNIQUE') ? 'Ya existe una tarjeta con ese nombre.' : 'Error: ' + (e?.message ?? e));
		}
	}
	async function borrarTar(t: any) {
		if (t.usos > 0) {
			alert(`No se puede eliminar "${t.nombre}": tiene ${t.usos} gasto(s)/suscripción(es) asociada(s). Primero reasigná o eliminá esos registros.`);
			return;
		}
		if (!confirm(`¿Eliminar la tarjeta "${t.nombre}"?`)) return;
		try {
			await query('DELETE FROM tarjeta WHERE id=? AND perfil_id=1', [t.id]);
			await cargar(); flash('Tarjeta eliminada ✅');
		} catch (e: any) { flash('Error: ' + (e?.message ?? e)); }
	}
</script>

<h1>Configuración</h1>
<a href="/" class="btn-volver">← Volver</a>

{#if msg}<p class="msg">{msg}</p>{/if}

{#if cargando}
	<p>Cargando…</p>
{:else}
	<h2>Categorías</h2>
	<div class="alta">
		<input bind:value={nuevaCat} placeholder="Nueva categoría" onkeydown={(e) => e.key === 'Enter' && crearCat()} />
		<button class="add" onclick={crearCat}>+ Agregar</button>
	</div>
	<table>
		<thead><tr><th>Nombre</th><th class="num">Gastos</th><th></th></tr></thead>
		<tbody>
			{#each categorias as c (c.id)}
				<tr>
					<td>
						{#if editCatId === c.id}
							<input class="edit" bind:value={editCatNombre} onkeydown={(e) => e.key === 'Enter' && guardarCat()} />
							<button class="okp" onclick={guardarCat}>✓</button>
							<button class="cancp" onclick={() => (editCatId = null)}>✕</button>
						{:else}{c.nombre}{/if}
					</td>
					<td class="num">{c.usos}</td>
					<td class="acciones">
						{#if editCatId !== c.id}
							<button class="lapiz" onclick={() => abrirEditCat(c)} title="Renombrar">✏️</button>
							<button class="del" class:off={c.usos > 0} onclick={() => borrarCat(c)} title={c.usos > 0 ? 'Tiene gastos asociados' : 'Eliminar'}>🗑</button>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	<h2>Tarjetas</h2>
	<div class="alta">
		<input bind:value={ntNombre} placeholder="Nombre de la tarjeta" onkeydown={(e) => e.key === 'Enter' && crearTar()} />
		<select bind:value={ntProveedor}><option>Visa</option><option>Mastercard</option><option>Amex</option></select>
		<select bind:value={ntTipo}><option value="credito">Crédito</option><option value="debito">Débito</option></select>
		<button class="add" onclick={crearTar}>+ Agregar</button>
	</div>
	<table>
		<thead><tr><th>Nombre</th><th>Proveedor</th><th>Tipo</th><th class="num">Usos</th><th></th></tr></thead>
		<tbody>
			{#each tarjetas as t (t.id)}
				<tr>
					<td>
						{#if editTarId === t.id}
							<input class="edit" bind:value={editTarNombre} onkeydown={(e) => e.key === 'Enter' && guardarTar()} />
							<button class="okp" onclick={guardarTar}>✓</button>
							<button class="cancp" onclick={() => (editTarId = null)}>✕</button>
						{:else}{t.nombre}{/if}
					</td>
					<td>{t.proveedor ?? '—'}</td>
					<td>{t.tipo === 'credito' ? 'Crédito' : 'Débito'}</td>
					<td class="num">{t.usos}</td>
					<td class="acciones">
						{#if editTarId !== t.id}
							<button class="lapiz" onclick={() => abrirEditTar(t)} title="Renombrar">✏️</button>
							<button class="del" class:off={t.usos > 0} onclick={() => borrarTar(t)} title={t.usos > 0 ? 'Tiene registros asociados' : 'Eliminar'}>🗑</button>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	<p class="nota">Renombrar no afecta los gastos ya cargados. Solo se puede eliminar lo que no tenga registros asociados.</p>
{/if}

<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	h2 { font-size: 1.05rem; margin-top: 24px; }
	.btn-volver { display: inline-block; color: var(--accent); text-decoration: none; font-size: 0.9rem; margin: 4px 0 12px; }
	.btn-volver:hover { text-decoration: underline; }
	.msg { font-weight: 600; color: var(--pos); margin: 6px 0; }
	.alta { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
	.alta input { padding: 7px; flex: 1; min-width: 160px; }
	.alta select { padding: 7px; }
	.add { background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 7px 14px; cursor: pointer; font-weight: 600; white-space: nowrap; }
	table { border-collapse: collapse; width: 100%; font-size: 0.9rem; margin-bottom: 8px; }
	th, td { padding: 6px 8px; text-align: left; }
	td.num, th.num { text-align: right; }
	td.acciones { text-align: right; white-space: nowrap; }
	.edit { width: 60%; padding: 3px 6px; }
	.lapiz { background: none; border: none; cursor: pointer; font-size: 0.85rem; opacity: 0.6; }
	.lapiz:hover { opacity: 1; }
	.okp { background: var(--pos); color: #06281a; border: none; border-radius: 4px; cursor: pointer; padding: 1px 7px; margin-left: 2px; }
	.cancp { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 4px; cursor: pointer; padding: 1px 7px; margin-left: 2px; }
	.del {
		background: rgba(248, 113, 113, 0.15);
		color: var(--neg);
		border: none;
		border-radius: 5px;
		padding: 2px 8px;
		cursor: pointer;
		font-size: 0.85rem;
	}
	.del:hover { background: rgba(248, 113, 113, 0.28); }
	.del.off { opacity: 0.35; cursor: not-allowed; }
	.nota { font-size: 0.8rem; color: var(--text-dim); margin-top: 12px; }
</style>
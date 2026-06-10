<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import { cargarModo, type ModoPeriodo } from '$lib/periodo';
	import Guia from '$lib/Guia.svelte';

	let cargando = $state(true);
	let categorias = $state<any[]>([]);
	let tarjetas = $state<any[]>([]);
	let subcategorias = $state<any[]>([]);
	let detalles = $state<any[]>([]);   // diccionario: detalle -> subcategoria

	// Modo de período
	let modo = $state<ModoPeriodo>('sueldo');

	// Alta de categoría
	let nuevaCat = $state('');
	// Alta de subcategoría
	let nuevaSub = $state('');
	// Alta de tarjeta
	let ntNombre = $state('');
	let ntProveedor = $state('Visa');
	let ntTipo = $state<'credito' | 'debito'>('credito');

	// Edición inline
	let editCatId = $state<number | null>(null);
	let editCatNombre = $state('');
	let editTarId = $state<number | null>(null);
	let editTarNombre = $state('');
	let editSubId = $state<number | null>(null);
	let editSubNombre = $state('');

	let msg = $state('');

	const explicacionModo: Record<ModoPeriodo, string> = {
		sueldo: 'Cada período arranca el día que cobrás tu sueldo. Ideal si tenés un ingreso principal fijo.',
		calendario: 'Cada período es un mes corrido (del 1 al último día). Ideal si tus ingresos varían o no tenés un sueldo fijo.'
	};

	async function cargar() {
		modo = await cargarModo();

		categorias = (await query(`
			SELECT c.id, c.nombre,
				(SELECT COUNT(*) FROM gasto g WHERE g.categoria_id = c.id) AS usos
			FROM categoria c WHERE c.perfil_id=1 ORDER BY c.nombre
		`)) as any[];

		tarjetas = (await query(`
			SELECT t.id, t.nombre, t.proveedor, t.tipo,
				(SELECT COUNT(*) FROM gasto g WHERE g.tarjeta_id = t.id)
				+ (SELECT COUNT(*) FROM suscripcion s WHERE s.tarjeta_id = t.id) AS usos
			FROM tarjeta t WHERE t.perfil_id=1 ORDER BY t.nombre
		`)) as any[];

		// Subcategorías con conteo de uso (en diccionario + como override en gastos)
		subcategorias = (await query(`
			SELECT sc.id, sc.nombre,
				(SELECT COUNT(*) FROM mapeo_detalle m WHERE m.subcategoria_id = sc.id)
				+ (SELECT COUNT(*) FROM gasto g WHERE g.subcategoria_id = sc.id) AS usos
			FROM subcategoria sc WHERE sc.perfil_id=1 ORDER BY sc.nombre
		`)) as any[];

		// Diccionario: todos los detalles que aparecen en gastos O ya están mapeados,
		// con la subcategoría a la que apuntan hoy (si la hay).
		detalles = (await query(`
			SELECT d.detalle, m.subcategoria_id
			FROM (
				SELECT DISTINCT detalle FROM gasto WHERE perfil_id=1 AND detalle IS NOT NULL AND detalle <> ''
				UNION
				SELECT detalle FROM mapeo_detalle WHERE perfil_id=1
			) d
			LEFT JOIN mapeo_detalle m ON m.perfil_id=1 AND m.detalle = d.detalle
			ORDER BY d.detalle COLLATE NOCASE
		`)) as any[];

		cargando = false;
	}
	onMount(cargar);

	function flash(t: string) { msg = t; setTimeout(() => (msg = ''), 3000); }
	function esUnique(e: any) { return e?.message?.includes('UNIQUE'); }

	// ===== Modo de período =====
	async function cambiarModo(nuevo: ModoPeriodo) {
		if (nuevo === modo) return;
		if (!confirm('Cambiar el modo recalcula cómo se agrupan tus gastos e ingresos por período. ¿Continuar?')) return;
		try {
			await query('UPDATE perfil SET modo_periodo=? WHERE id=1', [nuevo]);
			location.reload();
		} catch (e: any) { flash('Error: ' + (e?.message ?? e)); }
	}

	// ===== Categorías =====
	async function crearCat() {
		const n = nuevaCat.trim(); if (!n) return;
		try { await query('INSERT INTO categoria (perfil_id, nombre) VALUES (1, ?)', [n]); nuevaCat=''; await cargar(); flash('Categoría creada ✅'); }
		catch (e:any) { flash(esUnique(e) ? 'Ya existe esa categoría.' : 'Error: '+(e?.message??e)); }
	}
	function abrirEditCat(c:any){ editCatId=c.id; editCatNombre=c.nombre; }
	async function guardarCat(){
		const n=editCatNombre.trim(); if(editCatId==null||!n){editCatId=null;return;}
		try { await query('UPDATE categoria SET nombre=? WHERE id=? AND perfil_id=1',[n,editCatId]); editCatId=null; await cargar(); flash('Categoría renombrada ✅'); }
		catch(e:any){ flash(esUnique(e)?'Ya existe esa categoría.':'Error: '+(e?.message??e)); }
	}
	async function borrarCat(c:any){
		if(c.usos>0){ alert(`No se puede eliminar "${c.nombre}": tiene ${c.usos} gasto(s) asociado(s).`); return; }
		if(!confirm(`¿Eliminar la categoría "${c.nombre}"?`)) return;
		try { await query('DELETE FROM categoria WHERE id=? AND perfil_id=1',[c.id]); await cargar(); flash('Categoría eliminada ✅'); }
		catch(e:any){ flash('Error: '+(e?.message??e)); }
	}

	// ===== Subcategorías =====
	async function crearSub() {
		const n = nuevaSub.trim(); if (!n) return;
		try { await query('INSERT INTO subcategoria (perfil_id, nombre) VALUES (1, ?)', [n]); nuevaSub=''; await cargar(); flash('Subcategoría creada ✅'); }
		catch (e:any) { flash(esUnique(e) ? 'Ya existe esa subcategoría.' : 'Error: '+(e?.message??e)); }
	}
	function abrirEditSub(s:any){ editSubId=s.id; editSubNombre=s.nombre; }
	async function guardarSub(){
		const n=editSubNombre.trim(); if(editSubId==null||!n){editSubId=null;return;}
		try { await query('UPDATE subcategoria SET nombre=? WHERE id=? AND perfil_id=1',[n,editSubId]); editSubId=null; await cargar(); flash('Subcategoría renombrada ✅'); }
		catch(e:any){ flash(esUnique(e)?'Ya existe esa subcategoría.':'Error: '+(e?.message??e)); }
	}
	async function borrarSub(s:any){
		if(s.usos>0){ alert(`No se puede eliminar "${s.nombre}": está usada en ${s.usos} regla(s)/gasto(s).`); return; }
		if(!confirm(`¿Eliminar la subcategoría "${s.nombre}"?`)) return;
		try { await query('DELETE FROM subcategoria WHERE id=? AND perfil_id=1',[s.id]); await cargar(); flash('Subcategoría eliminada ✅'); }
		catch(e:any){ flash('Error: '+(e?.message??e)); }
	}

	// ===== Tarjetas =====
	async function crearTar() {
		const n = ntNombre.trim(); if (!n) return;
		try { await query('INSERT INTO tarjeta (perfil_id, nombre, proveedor, tipo) VALUES (1, ?, ?, ?)', [n, ntProveedor, ntTipo]); ntNombre=''; await cargar(); flash('Tarjeta creada ✅'); }
		catch (e:any) { flash(esUnique(e)?'Ya existe esa tarjeta.':'Error: '+(e?.message??e)); }
	}
	function abrirEditTar(t:any){ editTarId=t.id; editTarNombre=t.nombre; }
	async function guardarTar(){
		const n=editTarNombre.trim(); if(editTarId==null||!n){editTarId=null;return;}
		try { await query('UPDATE tarjeta SET nombre=? WHERE id=? AND perfil_id=1',[n,editTarId]); editTarId=null; await cargar(); flash('Tarjeta renombrada ✅'); }
		catch(e:any){ flash(esUnique(e)?'Ya existe esa tarjeta.':'Error: '+(e?.message??e)); }
	}
	async function borrarTar(t:any){
		if(t.usos>0){ alert(`No se puede eliminar "${t.nombre}": tiene ${t.usos} registro(s) asociado(s).`); return; }
		if(!confirm(`¿Eliminar la tarjeta "${t.nombre}"?`)) return;
		try { await query('DELETE FROM tarjeta WHERE id=? AND perfil_id=1',[t.id]); await cargar(); flash('Tarjeta eliminada ✅'); }
		catch(e:any){ flash('Error: '+(e?.message??e)); }
	}

	// ===== Diccionario: asignar subcategoría a un detalle =====
	async function asignarDetalle(detalle: string, valor: string) {
		const scid = valor === '' ? null : Number(valor);
		try {
			if (scid == null) {
				// "Sin asignar": borrar la regla si existía
				await query('DELETE FROM mapeo_detalle WHERE perfil_id=1 AND detalle=?', [detalle]);
			} else {
				// Upsert: si existe la regla la actualizo, si no la creo
				const ex = (await query('SELECT id FROM mapeo_detalle WHERE perfil_id=1 AND detalle=?', [detalle])) as any[];
				if (ex.length) {
					await query('UPDATE mapeo_detalle SET subcategoria_id=? WHERE perfil_id=1 AND detalle=?', [scid, detalle]);
				} else {
					await query('INSERT INTO mapeo_detalle (perfil_id, detalle, subcategoria_id) VALUES (1, ?, ?)', [detalle, scid]);
				}
			}
			await cargar();
			flash('Clasificación actualizada ✅');
		} catch (e: any) { flash('Error: ' + (e?.message ?? e)); }
	}
</script>

<div class="titulo-guia">
	<h1>Configuración</h1>
	<Guia clave="configuracion" texto="El cerebro de la clasificación: categorías, tarjetas y el diccionario que conecta cada detalle con su subcategoría. Cambiar el diccionario reclasifica todo tu historial de una." />
</div>

{#if msg}<p class="msg">{msg}</p>{/if}

{#if cargando}
	<p>Cargando…</p>
{:else}
	<!-- ===== MODO DE PERÍODO ===== -->
	<h2>Modo de período</h2>
	<p class="sub">Define cómo se agrupan tus gastos e ingresos. Cambiarlo recalcula todo (no borra datos).</p>
	<div class="modo-btns">
		<button type="button" class:activo={modo === 'sueldo'} onclick={() => cambiarModo('sueldo')}>Por mi sueldo</button>
		<button type="button" class:activo={modo === 'calendario'} onclick={() => cambiarModo('calendario')}>Por mes calendario</button>
	</div>
	<p class="modo-exp">{explicacionModo[modo]}</p>

	<!-- ===== TARJETAS ===== -->
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

	<!-- ===== CATEGORÍAS ===== -->
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
	<p class="nota">Renombrar no afecta los gastos ya cargados. Solo se puede eliminar lo que no tenga registros asociados.</p>
	<!-- ===== SUBCATEGORÍAS ===== -->
	<h2>Subcategorías</h2>
	<div class="alta">
		<input bind:value={nuevaSub} placeholder="Nueva subcategoría" onkeydown={(e) => e.key === 'Enter' && crearSub()} />
		<button class="add" onclick={crearSub}>+ Agregar</button>
	</div>
	<table>
		<thead><tr><th>Nombre</th><th class="num">Usos</th><th></th></tr></thead>
		<tbody>
			{#each subcategorias as s (s.id)}
				<tr>
					<td>
						{#if editSubId === s.id}
							<input class="edit" bind:value={editSubNombre} onkeydown={(e) => e.key === 'Enter' && guardarSub()} />
							<button class="okp" onclick={guardarSub}>✓</button>
							<button class="cancp" onclick={() => (editSubId = null)}>✕</button>
						{:else}{s.nombre}{/if}
					</td>
					<td class="num">{s.usos}</td>
					<td class="acciones">
						{#if editSubId !== s.id}
							<button class="lapiz" onclick={() => abrirEditSub(s)} title="Renombrar">✏️</button>
							<button class="del" class:off={s.usos > 0} onclick={() => borrarSub(s)} title={s.usos > 0 ? 'Está en uso' : 'Eliminar'}>🗑</button>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	<!-- ===== DICCIONARIO DE DETALLES ===== -->
	<h2>Diccionario de detalles</h2>
	<p class="sub">Cada detalle que usás en tus gastos, y la subcategoría a la que va. Cambiá el selector para reclasificar todo el historial con ese detalle.</p>
	<table>
		<thead><tr><th>Detalle</th><th>Subcategoría</th></tr></thead>
		<tbody>
			{#each detalles as d (d.detalle)}
				<tr>
					<td>{d.detalle}</td>
					<td>
						<select value={d.subcategoria_id ?? ''} onchange={(e) => asignarDetalle(d.detalle, e.currentTarget.value)}>
							<option value="">— Sin asignar —</option>
							{#each subcategorias as s (s.id)}
								<option value={String(s.id)}>{s.nombre}</option>
							{/each}
						</select>
					</td>
				</tr>
			{:else}
				<tr><td colspan="2" class="vacio">Todavía no hay detalles cargados.</td></tr>
			{/each}
		</tbody>
	</table>

	
{/if}

<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	h2 { font-size: 1.05rem; margin-top: 24px; }
	.sub { font-size: 0.8rem; color: var(--text-dim); margin: 4px 0 8px; }
	.msg { font-weight: 600; color: var(--pos); margin: 6px 0; }
	.alta { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
	.alta input { padding: 7px; flex: 1; min-width: 160px; }
	.alta select { padding: 7px; }
	.add { background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 7px 14px; cursor: pointer; font-weight: 600; white-space: nowrap; }
	table { border-collapse: collapse; width: 100%; font-size: 0.9rem; margin-bottom: 8px; }
	th, td { padding: 6px 8px; text-align: left; }
	td.num, th.num { text-align: right; }
	td.acciones { text-align: right; white-space: nowrap; }
	td select { padding: 4px 6px; }
	.edit { width: 60%; padding: 3px 6px; }
	.vacio { text-align: center; color: var(--text-dim); font-style: italic; }
	.lapiz { background: none; border: none; cursor: pointer; font-size: 0.85rem; opacity: 0.6; }
	.lapiz:hover { opacity: 1; }
	.okp { background: var(--pos); color: #06281a; border: none; border-radius: 4px; cursor: pointer; padding: 1px 7px; margin-left: 2px; }
	.cancp { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 4px; cursor: pointer; padding: 1px 7px; margin-left: 2px; }
	.del { background: rgba(248, 113, 113, 0.15); color: var(--neg); border: none; border-radius: 5px; padding: 2px 8px; cursor: pointer; font-size: 0.85rem; }
	.del:hover { background: rgba(248, 113, 113, 0.28); }
	.del.off { opacity: 0.35; cursor: not-allowed; }
	.nota { font-size: 0.8rem; color: var(--text-dim); margin-top: 12px; }
	.modo-btns { display: flex; gap: 8px; margin: 8px 0; }
	.modo-btns button { flex: 1; max-width: 220px; padding: 8px 6px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
	.modo-btns button.activo { background: var(--accent); color: #fff; border-color: var(--accent); }
	.modo-exp { font-size: 0.8rem; color: var(--text-dim); margin: 0 0 4px; line-height: 1.35; }
</style>
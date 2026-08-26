<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import { cargarModo, type ModoPeriodo } from '$lib/periodo';
	import Guia from '$lib/Guia.svelte';

	let cargando = $state(true);
	let categorias = $state<any[]>([]);
	let tarjetas = $state<any[]>([]);
	let subcategorias = $state<any[]>([]);
	// Diccionario enriquecido: cada detalle con su subcat y las categorías
	// (de gastos reales) bajo las que aparece. Orden alfabético.
	let dicc = $state<any[]>([]);

	// Modo de período
	let modo = $state<ModoPeriodo>('sueldo');

	// Acordeón: una sección abierta a la vez. Arranca con la primera.
	let abierta = $state<string>('tarjetas');
	function toggle(s: string) { abierta = abierta === s ? '' : s; }

	// Filtros del diccionario
	let filtroCat = $state('');   // '' = Todas (incluye huérfanos)
	let buscador = $state('');
	let editDetalle = $state<string | null>(null);

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
	let editTarProveedor = $state('Visa');
	let editSubId = $state<number | null>(null);
	let editSubNombre = $state('');

	let msg = $state('');
	let msgErr = $state(false);

	const explicacionModo: Record<ModoPeriodo, string> = {
		sueldo: 'Cada período arranca el día que cobrás tu sueldo. Ideal si tenés un ingreso principal fijo.',
		calendario: 'Cada período es un mes corrido (del 1 al último día). Ideal si tus ingresos varían o no tenés un sueldo fijo.'
	};

	async function cargar() {
		modo = await cargarModo();

		categorias = (await query(`
			SELECT c.id, c.nombre, c.es_ahorro,
				(SELECT COUNT(*) FROM gasto g WHERE g.categoria_id = c.id)
				+ (SELECT COUNT(*) FROM suscripcion s WHERE s.categoria_id = c.id) AS usos
			FROM categoria c WHERE c.perfil_id=1 ORDER BY c.nombre
		`)) as any[];

		tarjetas = (await query(`
			SELECT t.id, t.nombre, t.proveedor, t.tipo,
				(SELECT COUNT(*) FROM gasto g WHERE g.tarjeta_id = t.id)
				+ (SELECT COUNT(*) FROM suscripcion s WHERE s.tarjeta_id = t.id) AS usos
			FROM tarjeta t WHERE t.perfil_id=1 ORDER BY t.nombre
		`)) as any[];

		subcategorias = (await query(`
			SELECT sc.id, sc.nombre, sc.es_meta_ahorro,
				(SELECT COUNT(*) FROM mapeo_detalle m WHERE m.subcategoria_id = sc.id)
				+ (SELECT COUNT(*) FROM gasto g WHERE g.subcategoria_id = sc.id) AS usos
			FROM subcategoria sc WHERE sc.perfil_id=1 ORDER BY sc.nombre
		`)) as any[];

		// Diccionario: se FILTRA por categoría usando los gastos reales (no se
		// agrupa: un detalle puede aparecer bajo varias categorías). Los detalles
		// mapeados sin gasto asociado (huérfanos) entran solo en "Todas".
		const dg = (await query(
			"SELECT DISTINCT detalle, categoria_id FROM gasto WHERE perfil_id=1 AND detalle IS NOT NULL AND detalle <> ''"
		)) as any[];
		const mp = (await query('SELECT detalle, subcategoria_id FROM mapeo_detalle WHERE perfil_id=1')) as any[];
		const by = new Map<string, { detalle: string; subcategoria_id: number | null; cats: Set<number> }>();
		for (const r of dg) {
			if (!by.has(r.detalle)) by.set(r.detalle, { detalle: r.detalle, subcategoria_id: null, cats: new Set() });
			by.get(r.detalle)!.cats.add(r.categoria_id);
		}
		for (const r of mp) {
			if (!by.has(r.detalle)) by.set(r.detalle, { detalle: r.detalle, subcategoria_id: null, cats: new Set() });
			by.get(r.detalle)!.subcategoria_id = r.subcategoria_id;
		}
		dicc = [...by.values()]
			.map((d) => ({ detalle: d.detalle, subcategoria_id: d.subcategoria_id, cats: [...d.cats] }))
			.sort((a, b) => a.detalle.localeCompare(b.detalle, 'es', { sensitivity: 'base' }));

		cargando = false;
	}
	onMount(cargar);

	// Vista filtrada del diccionario (categoría + buscador).
	let diccFiltrado = $derived.by(() => {
		const q = buscador.trim().toLowerCase();
		let arr = dicc;
		if (filtroCat !== '') {
			const cid = Number(filtroCat);
			arr = arr.filter((d) => d.cats.includes(cid));
		}
		if (q) arr = arr.filter((d) => d.detalle.toLowerCase().includes(q));
		return arr;
	});

	function subNombre(id: number | null): string {
		if (id == null) return '— sin subcategoría —';
		return subcategorias.find((s) => s.id === id)?.nombre ?? '?';
	}

	function flash(t: string, isErr = false) { msg = t; msgErr = isErr; setTimeout(() => (msg = ''), 3000); }
	function esUnique(e: any) { return e?.message?.includes('UNIQUE'); }
	// Error técnico: nunca el mensaje crudo en pantalla (Brief H / B3) — detalle a consola.
	function flashError(e: any) { console.error(e); flash('Ocurrió un error. Contactá al administrador.', true); }

	// ===== Modo de período =====
	async function cambiarModo(nuevo: ModoPeriodo) {
		if (nuevo === modo) return;
		if (!confirm('Cambiar el modo recalcula cómo se agrupan tus gastos e ingresos por período. ¿Continuar?')) return;
		try {
			await query('UPDATE perfil SET modo_periodo=? WHERE id=1', [nuevo]);
			location.reload();
		} catch (e: any) { flashError(e); }
	}

	// ===== Categorías =====
	async function crearCat() {
		const n = nuevaCat.trim(); if (!n) return;
		try { await query('INSERT INTO categoria (perfil_id, nombre) VALUES (1, ?)', [n]); nuevaCat=''; await cargar(); flash('Categoría creada ✅'); }
		catch (e:any) { if (esUnique(e)) flash('Ya existe esa categoría.'); else flashError(e); }
	}
	function abrirEditCat(c:any){ editCatId=c.id; editCatNombre=c.nombre; }
	async function guardarCat(){
		const n=editCatNombre.trim(); if(editCatId==null||!n){editCatId=null;return;}
		try { await query('UPDATE categoria SET nombre=? WHERE id=? AND perfil_id=1',[n,editCatId]); editCatId=null; await cargar(); flash('Categoría renombrada ✅'); }
		catch(e:any){ if (esUnique(e)) flash('Ya existe esa categoría.'); else flashError(e); }
	}
	async function borrarCat(c:any){
		if(c.es_ahorro){ alert('No se puede eliminar — es tu categoría de ahorro. Registrá acá cualquier plata que apartes del gasto (dólares, plazo fijo, colchón, etc.).'); return; }
		if(c.usos>0){ alert(`No se puede eliminar "${c.nombre}": tiene ${c.usos} gasto(s) asociado(s).`); return; }
		if(!confirm(`¿Eliminar la categoría "${c.nombre}"?`)) return;
		try { await query('DELETE FROM categoria WHERE id=? AND perfil_id=1',[c.id]); await cargar(); flash('Categoría eliminada ✅'); }
		catch(e:any){ flashError(e); }
	}

	// ===== Subcategorías =====
	async function crearSub() {
		const n = nuevaSub.trim(); if (!n) return;
		try { await query('INSERT INTO subcategoria (perfil_id, nombre) VALUES (1, ?)', [n]); nuevaSub=''; await cargar(); flash('Subcategoría creada ✅'); }
		catch (e:any) { if (esUnique(e)) flash('Ya existe esa subcategoría.'); else flashError(e); }
	}
	function abrirEditSub(s:any){ editSubId=s.id; editSubNombre=s.nombre; }
	async function guardarSub(){
		const n=editSubNombre.trim(); if(editSubId==null||!n){editSubId=null;return;}
		try { await query('UPDATE subcategoria SET nombre=? WHERE id=? AND perfil_id=1',[n,editSubId]); editSubId=null; await cargar(); flash('Subcategoría renombrada ✅'); }
		catch(e:any){ if (esUnique(e)) flash('Ya existe esa subcategoría.'); else flashError(e); }
	}
	async function borrarSub(s:any){
		if(s.es_meta_ahorro){ alert('No se puede eliminar — es tu subcategoría de meta de ahorro, vinculada a Capacidad de ahorro.'); return; }
		if(s.usos>0){ alert(`No se puede eliminar "${s.nombre}": está usada en ${s.usos} regla(s)/gasto(s).`); return; }
		if(!confirm(`¿Eliminar la subcategoría "${s.nombre}"?`)) return;
		try {
			await query('DELETE FROM presupuesto WHERE subcategoria_id=? AND perfil_id=1',[s.id]);
			await query("DELETE FROM meta WHERE clave='susc_subcat_id' AND valor=?",[String(s.id)]);
			await query('DELETE FROM subcategoria WHERE id=? AND perfil_id=1',[s.id]);
			await cargar(); flash('Subcategoría eliminada ✅');
		}
		catch(e:any){ flashError(e); }
	}

	// ===== Tarjetas =====
	async function crearTar() {
		const n = ntNombre.trim(); if (!n) return;
		try { await query('INSERT INTO tarjeta (perfil_id, nombre, proveedor, tipo) VALUES (1, ?, ?, ?)', [n, ntProveedor, ntTipo]); ntNombre=''; await cargar(); flash('Tarjeta creada ✅'); }
		catch (e:any) { if (esUnique(e)) flash('Ya existe esa tarjeta.'); else flashError(e); }
	}
	function abrirEditTar(t:any){ editTarId=t.id; editTarNombre=t.nombre; editTarProveedor=t.proveedor ?? 'Visa'; }
	async function guardarTar(){
		const n=editTarNombre.trim(); if(editTarId==null||!n){editTarId=null;return;}
		try { await query('UPDATE tarjeta SET nombre=?, proveedor=? WHERE id=? AND perfil_id=1',[n,editTarProveedor,editTarId]); editTarId=null; await cargar(); flash('Tarjeta actualizada ✅'); }
		catch(e:any){ if (esUnique(e)) flash('Ya existe esa tarjeta.'); else flashError(e); }
	}
	async function borrarTar(t:any){
		if(t.usos>0){ alert(`No se puede eliminar "${t.nombre}": tiene ${t.usos} registro(s) asociado(s).`); return; }
		if(!confirm(`¿Eliminar la tarjeta "${t.nombre}"?`)) return;
		try { await query('DELETE FROM tarjeta WHERE id=? AND perfil_id=1',[t.id]); await cargar(); flash('Tarjeta eliminada ✅'); }
		catch(e:any){ flashError(e); }
	}

	// ===== Diccionario: asignar subcategoría a un detalle =====
	async function asignarDetalle(detalle: string, valor: string) {
		const scid = valor === '' ? null : Number(valor);
		try {
			if (scid == null) {
				await query('DELETE FROM mapeo_detalle WHERE perfil_id=1 AND detalle=?', [detalle]);
			} else {
				const ex = (await query('SELECT id FROM mapeo_detalle WHERE perfil_id=1 AND detalle=?', [detalle])) as any[];
				if (ex.length) {
					await query('UPDATE mapeo_detalle SET subcategoria_id=? WHERE perfil_id=1 AND detalle=?', [scid, detalle]);
				} else {
					await query('INSERT INTO mapeo_detalle (perfil_id, detalle, subcategoria_id) VALUES (1, ?, ?)', [detalle, scid]);
				}
			}
			await cargar();
			flash('Clasificación actualizada ✅');
		} catch (e: any) { flashError(e); }
	}
</script>

<div class="titulo-guia">
	<h1>Configuración</h1>
	<Guia
		clave="configuracion"
		para="Definir cómo se clasifica todo lo que cargás."
		uso="Administrá categorías, tarjetas y el diccionario que conecta cada detalle con su subcategoría. Ojo: cambiar el diccionario reclasifica todo tu historial de una."
	/>
</div>

{#if msg}<p class="msg" class:err={msgErr}>{#if msgErr}<span class="err-x">✗</span> {/if}{msg}</p>{/if}

{#if cargando}
	<p>Cargando…</p>
{:else}
	<h2>Modo de período</h2>
	<p class="sub">Define cómo se agrupan tus gastos e ingresos. Cambiarlo recalcula todo (no borra datos).</p>
	<div class="modo-btns">
		<button type="button" class:activo={modo === 'sueldo'} onclick={() => cambiarModo('sueldo')}>Por mi sueldo</button>
		<button type="button" class:activo={modo === 'calendario'} onclick={() => cambiarModo('calendario')}>Por mes calendario</button>
	</div>
	<p class="modo-exp">{explicacionModo[modo]}</p>

	<section class="acc">
		<button class="acc-h" onclick={() => toggle('tarjetas')}>
			<span class="flecha">{abierta === 'tarjetas' ? '▾' : '▸'}</span> Edición de Tarjetas
		</button>
		{#if abierta === 'tarjetas'}
			<div class="acc-body">
				<div class="alta">
					<input bind:value={ntNombre} placeholder="Nombre de la tarjeta" onkeydown={(e) => e.key === 'Enter' && crearTar()} />
					<select bind:value={ntProveedor}><option>Visa</option><option>Mastercard</option><option>Amex</option></select>
					<select bind:value={ntTipo}><option value="credito">Crédito</option><option value="debito">Débito</option></select>
					<button class="btn btn-primary" onclick={crearTar}>+ Agregar</button>
				</div>
				<div class="tabla-scroll">
				<table>
					<thead><tr><th>Nombre</th><th>Proveedor</th><th>Tipo</th><th class="num">Usos</th><th></th></tr></thead>
					<tbody>
						{#each tarjetas as t (t.id)}
							<tr>
								<td>
									{#if editTarId === t.id}
										<input class="edit" bind:value={editTarNombre} onkeydown={(e) => e.key === 'Enter' && guardarTar()} />
										<button aria-label="Guardar" class="okp" onclick={guardarTar}>✓</button>
										<button aria-label="Cancelar" class="cancp" onclick={() => (editTarId = null)}>✕</button>
									{:else}{t.nombre}{/if}
								</td>
								<td>
									{#if editTarId === t.id}
										<select class="edit" bind:value={editTarProveedor}><option>Visa</option><option>Mastercard</option><option>Amex</option></select>
									{:else}{t.proveedor ?? '—'}{/if}
								</td>
								<td>{t.tipo === 'credito' ? 'Crédito' : 'Débito'}</td>
								<td class="num">{t.usos}</td>
								<td class="acciones">
									{#if editTarId !== t.id}
										<button aria-label="Editar" class="lapiz" onclick={() => abrirEditTar(t)} title="Renombrar">✏</button>
										<button aria-label="Eliminar" class="del" class:off={t.usos > 0} onclick={() => borrarTar(t)} title={t.usos > 0 ? 'Tiene registros asociados' : 'Eliminar'}>✕</button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				</div>
			</div>
		{/if}
	</section>

	<section class="acc">
		<button class="acc-h" onclick={() => toggle('categorias')}>
			<span class="flecha">{abierta === 'categorias' ? '▾' : '▸'}</span> Edición de Categorías
		</button>
		{#if abierta === 'categorias'}
			<div class="acc-body">
				<div class="alta">
					<input bind:value={nuevaCat} placeholder="Nueva categoría" onkeydown={(e) => e.key === 'Enter' && crearCat()} />
					<button class="btn btn-primary" onclick={crearCat}>+ Agregar</button>
				</div>
				<div class="tabla-scroll">
				<table>
					<thead><tr><th>Nombre</th><th class="num">Gastos</th><th></th></tr></thead>
					<tbody>
						{#each categorias as c (c.id)}
							<tr>
								<td>
									{#if editCatId === c.id}
										<input class="edit" bind:value={editCatNombre} onkeydown={(e) => e.key === 'Enter' && guardarCat()} />
										<button aria-label="Guardar" class="okp" onclick={guardarCat}>✓</button>
										<button aria-label="Cancelar" class="cancp" onclick={() => (editCatId = null)}>✕</button>
									{:else}{c.nombre}{/if}
								</td>
								<td class="num">{c.usos}</td>
								<td class="acciones">
									{#if editCatId !== c.id}
										<button aria-label="Editar" class="lapiz" onclick={() => abrirEditCat(c)} title="Renombrar">✏</button>
										<button aria-label="Eliminar" class="del" class:off={c.usos > 0 || c.es_ahorro} onclick={() => borrarCat(c)} title={c.es_ahorro ? 'Es tu categoría de ahorro' : c.usos > 0 ? 'Tiene gastos asociados' : 'Eliminar'}>✕</button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				</div>
				<p class="nota">Renombrar no afecta los gastos ya cargados. Solo se puede eliminar lo que no tenga registros asociados.</p>
			</div>
		{/if}
	</section>

	<section class="acc">
		<button class="acc-h" onclick={() => toggle('subcategorias')}>
			<span class="flecha">{abierta === 'subcategorias' ? '▾' : '▸'}</span> Edición de Subcategorías
		</button>
		{#if abierta === 'subcategorias'}
			<div class="acc-body">
				<div class="alta">
					<input bind:value={nuevaSub} placeholder="Nueva subcategoría" onkeydown={(e) => e.key === 'Enter' && crearSub()} />
					<button class="btn btn-primary" onclick={crearSub}>+ Agregar</button>
				</div>
				<div class="tabla-scroll">
				<table>
					<thead><tr><th>Nombre</th><th class="num">Usos</th><th></th></tr></thead>
					<tbody>
						{#each subcategorias as s (s.id)}
							<tr>
								<td>
									{#if editSubId === s.id}
										<input class="edit" bind:value={editSubNombre} onkeydown={(e) => e.key === 'Enter' && guardarSub()} />
										<button aria-label="Guardar" class="okp" onclick={guardarSub}>✓</button>
										<button aria-label="Cancelar" class="cancp" onclick={() => (editSubId = null)}>✕</button>
									{:else}{s.nombre}{/if}
								</td>
								<td class="num">{s.usos}</td>
								<td class="acciones">
									{#if editSubId !== s.id}
										<button aria-label="Editar" class="lapiz" onclick={() => abrirEditSub(s)} title="Renombrar">✏</button>
										<button aria-label="Eliminar" class="del" class:off={s.usos > 0 || s.es_meta_ahorro} onclick={() => borrarSub(s)} title={s.es_meta_ahorro ? 'Es tu subcategoría de meta de ahorro' : s.usos > 0 ? 'Está en uso' : 'Eliminar'}>✕</button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				</div>
				<p class="nota">Podés crear o renombrar subcategorías aunque todavía no tengan detalle ni gasto.</p>
			</div>
		{/if}
	</section>

	<section class="acc">
		<button class="acc-h" onclick={() => toggle('diccionario')}>
			<span class="flecha">{abierta === 'diccionario' ? '▾' : '▸'}</span> Diccionario de detalles
		</button>
		{#if abierta === 'diccionario'}
			<div class="acc-body">
				<p class="sub">Cada detalle y la subcategoría a la que va. Tocá el chip para reclasificar (cambia todo el historial con ese detalle). El filtro por categoría usa tus gastos reales.</p>
				<div class="dicc-controls">
					<select bind:value={filtroCat}>
						<option value="">Todas (+ huérfanos)</option>
						{#each categorias as c (c.id)}<option value={String(c.id)}>{c.nombre}</option>{/each}
					</select>
					<input placeholder="Buscar detalle…" bind:value={buscador} />
				</div>
				<div class="tabla-scroll">
				<table>
					<thead><tr><th>Detalle</th><th>Subcategoría</th></tr></thead>
					<tbody>
						{#each diccFiltrado as d (d.detalle)}
							<tr>
								<td>{d.detalle}</td>
								<td>
									{#if editDetalle === d.detalle}
										<select class="edit" value={d.subcategoria_id ?? ''}
											onchange={(e) => { asignarDetalle(d.detalle, e.currentTarget.value); editDetalle = null; }}>
											<option value="">— Sin asignar —</option>
											{#each subcategorias as s (s.id)}
												<option value={String(s.id)}>{s.nombre}</option>
											{/each}
										</select>
										<button aria-label="Cancelar" class="cancp" onclick={() => (editDetalle = null)}>✕</button>
									{:else}
										<button class="chip" class:sin={d.subcategoria_id == null} onclick={() => (editDetalle = d.detalle)}>
											{subNombre(d.subcategoria_id)}
										</button>
									{/if}
								</td>
							</tr>
						{:else}
							<tr><td colspan="2" class="vacio">No hay detalles para este filtro.</td></tr>
						{/each}
					</tbody>
				</table>
				</div>
			</div>
		{/if}
	</section>
{/if}

<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	h2 { font-size: 1.02rem; margin-top: 26px; border-left: 3px solid var(--accent); padding-left: 12px; }
	.sub { font-size: 0.8rem; color: var(--text-dim); margin: 4px 0 8px; }
	.msg { font-weight: 600; color: var(--pos); margin: 6px 0; }
	.msg.err { color: var(--neg); display: flex; align-items: center; gap: 6px; }
	.err-x { font-size: 1.3em; line-height: 1; }
	.alta { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
	.alta input { padding: 7px; flex: 1; min-width: 160px; }
	.alta select { padding: 7px; }
	table { border-collapse: collapse; width: 100%; font-size: 0.9rem; margin-bottom: 8px; }
	th, td { padding: 6px 8px; text-align: left; }
	td.num, th.num { text-align: right; }
	td.acciones { text-align: right; white-space: nowrap; }
	td select { padding: 4px 6px; }
	.edit { width: 60%; padding: 3px 6px; }
	.vacio { text-align: center; color: var(--text-dim); font-style: italic; }
	.nota { font-size: 0.8rem; color: var(--text-dim); margin-top: 12px; }
	.modo-btns { display: flex; gap: 8px; margin: 8px 0; }
	.modo-exp { font-size: 0.8rem; color: var(--text-dim); margin: 0 0 4px; line-height: 1.35; }

	.acc { border: 1px solid transparent; border-radius: 8px; margin-top: 10px; overflow: hidden; background: var(--surface); }
	.acc-h {
		width: 100%; text-align: left; background: none; color: var(--text);
		border: none; padding: 12px 14px; font-family: var(--font-display); font-size: 0.95rem; font-weight: 600; cursor: pointer;
		display: flex; align-items: center; gap: 8px;
		transition: background 0.12s ease;
	}
	.acc-h:hover { background: var(--surface-2); }
	.flecha { color: var(--text-dim); font-size: 0.85rem; width: 14px; display: inline-block; }
	.acc-body { padding: 12px 14px; }
	.acc-body table { margin-bottom: 0; }

	.dicc-controls { display: flex; gap: 8px; flex-wrap: wrap; margin: 4px 0 12px; }
	.dicc-controls select { padding: 7px; }
	.dicc-controls input { padding: 7px; flex: 1; min-width: 160px; }
	.chip {
		background: var(--surface-2); color: var(--text); border: 1px solid var(--border);
		border-radius: 999px; padding: 3px 12px; font-size: 0.82rem; cursor: pointer;
	}
	.chip:hover { border-color: var(--accent); }
	.chip.sin { color: var(--text-dim); border-style: dashed; }
</style>

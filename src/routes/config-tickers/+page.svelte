<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import {
		actualizarPreciosYFoto,
		sincronizarCatalogoData912,
		especieDeTicker,
		type Especie
	} from '$lib/db/precios';
	import { backfillHistoricoActivo, tieneHistoricoData912 } from '$lib/db/precios_historicos';
	import { Toast } from '$lib/toast.svelte';
	import { unidades } from '$lib/format';
	import Guia from '$lib/Guia.svelte';
	import GraficoPrecio from '$lib/GraficoPrecio.svelte';

	const TIPOS_ACTIVO = ['Bono', 'ON', 'FCI', 'Accion', 'CEDEAR', 'Indice'];
	const RENTAS = ['Fija', 'Mixta', 'Variable', 'Liquido'];
	// Exposición al tipo de cambio (a qué FX sigue el valor del activo), distinta de
	// la moneda de cotización: un CEDEAR o una ON dollar-linked cotizan en ARS pero
	// su exposición es 'Dolar'. Alimenta la tabla de Exposición en Inversiones.
	const EXPOSICIONES = ['Dolar', 'CER', 'Peso'];
	const ESPECIES: Especie[] = ['Pesos', 'MEP', 'CCL'];

	// Tope de fichas dibujadas por grupo. Con el catálogo de data912 sincronizado
	// la tabla `activo` pasa de ~15 filas a varios cientos (cada instrumento
	// aparece además en sus especies pesos/MEP/CCL): montar todas las fichas de una
	// se nota en mobile. Mismo criterio que ya usaba el buscador de mercado.
	const TOPE_GRUPO = 30;

	let activos = $state<any[]>([]);
	let cargando = $state(true);
	let actualizando = $state(false);
	let sincronizando = $state(false);
	const toast = new Toast();

	// Filtro de la lista (combinable): tipo + especie + texto contra ticker/nombre.
	let filtroTipo = $state('Todos');
	let filtroEspecie = $state('Todas');
	let filtroTexto = $state('');

	// Formulario unificado (alta + edición). editId null = alta, número = edición.
	let formAbierto = $state(false);
	let editId = $state<number | null>(null);
	let fTicker = $state('');
	let fNombre = $state('');
	let fTipo = $state('Accion');
	let fRenta = $state('Variable');
	let fMoneda = $state<'ARS' | 'USD'>('ARS');
	let fExposicion = $state<'Dolar' | 'CER' | 'Peso'>('Peso');
	// Marca si el usuario tocó la exposición a mano; si no, se sugiere por regla.
	let fExpoTocada = $state(false);
	// Símbolo de cotización del activo en edición (null en alta). Si ya está
	// resuelto, el ticker queda readonly: cambiarlo desincronizaría el activo del
	// símbolo que usa el auto-refresh de precios (ver guardar(): simbolo se
	// deriva del ticker en cada guardado).
	let fSimboloCotizacion = $state<string | null>(null);
	const tickerReadonly = $derived(editId !== null && fSimboloCotizacion != null);

	// Activo dibujado en el gráfico fijo de arriba.
	let graficoId = $state<string>('');

	async function cargar() {
		// Todos los activos del perfil (incluidos FCI): esta pantalla es el catálogo
		// de referencia y el único lugar de alta/edición manual. Orden: por tipo y,
		// dentro, por ticker.
		activos = (await query(
			"SELECT id, ticker, nombre, tipo, renta, moneda, precio_actual, simbolo_cotizacion, COALESCE(exposicion, CASE WHEN moneda='USD' OR tipo IN ('CEDEAR','Indice') THEN 'Dolar' ELSE 'Peso' END) AS exposicion FROM activo WHERE perfil_id=1 AND activo=1 ORDER BY tipo COLLATE NOCASE, ticker COLLATE NOCASE"
		)) as any[];
		cargando = false;
		if (!graficoId) await elegirDefaultGrafico();
	}
	onMount(cargar);

	// El gráfico no arranca vacío. Default = el activo con mayor tenencia valuada;
	// si todavía no hay ninguna operación cargada, el primero del catálogo por
	// orden alfabético de ticker. La valuación acá es aproximada a propósito (no
	// convierte ARS/USD a una moneda común): es solo para elegir cuál mostrar
	// primero, no un número que se muestre en pantalla.
	async function elegirDefaultGrafico() {
		try {
			const r = (await query(
				`SELECT t.activo_id AS id,
				        SUM(CASE WHEN t.operacion='Compra' THEN t.unidades ELSE -t.unidades END) * COALESCE(a.precio_actual, 0) AS val
				 FROM transaccion t JOIN activo a ON a.id = t.activo_id
				 WHERE t.perfil_id = 1
				 GROUP BY t.activo_id HAVING val > 0 ORDER BY val DESC LIMIT 1`
			)) as any[];
			if (r[0]?.id != null) { graficoId = String(r[0].id); return; }
		} catch (e) {
			console.error('[mercado] no se pudo determinar el activo de mayor tenencia:', e);
		}
		const primero = [...activos].sort((x, y) =>
			String(x.ticker).localeCompare(String(y.ticker), 'es')
		)[0];
		if (primero) graficoId = String(primero.id);
	}

	// Filtro combinable: tipo + especie + texto (substring case-insensitive contra
	// ticker y nombre). Solo reduce qué fichas se ven; no altera orden ni agrupado.
	const activosFiltrados = $derived.by(() => {
		const q = filtroTexto.trim().toLowerCase();
		return activos.filter((a) =>
			(filtroTipo === 'Todos' || a.tipo === filtroTipo) &&
			(filtroEspecie === 'Todas' || especieDeTicker(a.ticker, a.moneda) === filtroEspecie) &&
			(!q || a.ticker.toLowerCase().includes(q) || a.nombre.toLowerCase().includes(q))
		);
	});

	// Agrupa por tipo: grupos en orden alfabético; los ítems ya vienen por ticker
	// del ORDER BY. En esta pantalla el ticker es el dato central visible.
	const activosPorTipo = $derived.by(() => {
		const grupos = new Map<string, any[]>();
		for (const a of activosFiltrados) {
			if (!grupos.has(a.tipo)) grupos.set(a.tipo, []);
			grupos.get(a.tipo)!.push(a);
		}
		return [...grupos.entries()]
			.sort((x, y) => x[0].localeCompare(y[0], 'es'))
			.map(([tipo, items]) => ({ tipo, items, total: items.length }));
	});

	// Misma regla que usaba Movimientos al crear un activo al vuelo.
	function exposicionSugerida(moneda: string, tipo: string): 'Dolar' | 'CER' | 'Peso' {
		return moneda === 'USD' || tipo === 'CEDEAR' || tipo === 'Indice' ? 'Dolar' : 'Peso';
	}
	// En alta, mientras el usuario no toque exposición a mano, la seguimos sugiriendo
	// según moneda/tipo. En edición respetamos lo guardado.
	$effect(() => {
		const m = fMoneda, t = fTipo;
		if (editId === null && !fExpoTocada) fExposicion = exposicionSugerida(m, t);
	});

	function resetForm() {
		editId = null;
		fTicker = ''; fNombre = ''; fTipo = 'Accion'; fRenta = 'Variable';
		fMoneda = 'ARS'; fExposicion = 'Peso'; fExpoTocada = false; fSimboloCotizacion = null;
	}

	function editar(a: any) {
		editId = a.id;
		fTicker = a.ticker;
		fNombre = a.nombre;
		fTipo = a.tipo;
		fRenta = a.renta;
		fMoneda = a.moneda;
		fExposicion = a.exposicion;
		fExpoTocada = true; // en edición respetamos lo guardado
		fSimboloCotizacion = a.simbolo_cotizacion;
		formAbierto = true;
		toast.limpiar();
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	async function guardar() {
		toast.limpiar();
		const ticker = fTicker.trim().toUpperCase();
		const nombre = fNombre.trim();
		// Símbolo autosync determinístico: los FCI no cotizan en data912 (símbolo
		// vacío); el resto usa su propio ticker. Se recalcula en cada guardado, así
		// que cambiar el tipo a/desde FCI actualiza el símbolo solo.
		const simbolo = fTipo === 'FCI' ? null : ticker;
		if (!ticker) return toast.error('Falta el ticker');
		if (!nombre) return toast.error('Falta el nombre');
		try {
			// Unicidad (perfil, ticker): bloquear duplicado con aviso claro antes de
			// que salte el UNIQUE de la tabla.
			const dup = (await query('SELECT id FROM activo WHERE perfil_id=1 AND ticker=? AND id<>?',
				[ticker, editId ?? -1])) as any[];
			if (dup.length) return toast.error(`Ya existe un activo con el ticker "${ticker}"`);

			let activoId: number;
			if (editId) {
				await query(
					'UPDATE activo SET ticker=?, nombre=?, tipo=?, renta=?, moneda=?, exposicion=?, simbolo_cotizacion=? WHERE id=? AND perfil_id=1',
					[ticker, nombre, fTipo, fRenta, fMoneda, fExposicion, simbolo, editId]
				);
				activoId = editId;
				toast.exito('Activo actualizado ✅');
			} else {
				// Se crea sin transacciones (tenencia cero): existe hasta que se le
				// carguen movimientos. precio_actual queda null hasta la 1ª cotización.
				const r = (await query(
					'INSERT INTO activo (perfil_id,ticker,nombre,tipo,renta,moneda,exposicion,simbolo_cotizacion) VALUES (1,?,?,?,?,?,?,?) RETURNING id',
					[ticker, nombre, fTipo, fRenta, fMoneda, fExposicion, simbolo]
				)) as any[];
				activoId = r[0].id;
				toast.exito('Activo creado ✅');
			}
			// Precio histórico: si el tipo tiene endpoint de data912 y hay símbolo,
			// baja la serie completa en segundo plano. Se hace SOLO acá (alta/edición
			// manual, que son los activos que el usuario efectivamente opera) y no en
			// el sync masivo ni al mirar el gráfico, para no llenar la base con el
			// histórico de cientos de activos del catálogo. Fire-and-forget: no
			// bloquea el guardado ni el toast; si falla, la cadena de respaldo sigue
			// funcionando igual.
			if (simbolo && tieneHistoricoData912(fTipo)) {
				backfillHistoricoActivo(activoId).catch(() => {});
			}
			resetForm(); // el panel NO se cierra: permite crear varios seguidos
			await cargar();
		} catch (e: any) {
			const m = String(e?.message ?? e);
			// Caso amigable ya identificado (violación UNIQUE) se mantiene; cualquier
			// otro error técnico pasa por el patrón único de B3 (detalle solo a consola).
			if (/unique/i.test(m)) toast.error(`Ya existe un activo con el ticker "${ticker}"`);
			else toast.errorTecnico(e);
		}
	}

	async function actualizarAhora() {
		actualizando = true;
		try { toast.exito(await actualizarPreciosYFoto()); await cargar(); }
		catch (e: any) { toast.errorTecnico(e); }
		actualizando = false;
	}

	// Alta masiva del catálogo de data912. Acción manual y explícita: son 5 fetches
	// y cientos de altas, no algo para disparar en cada visita. Es idempotente, así
	// que volver a correrlo más adelante solo suma los símbolos nuevos.
	async function sincronizarCatalogo() {
		sincronizando = true;
		toast.limpiar();
		try { toast.exito(await sincronizarCatalogoData912()); await cargar(); }
		catch (e: any) { toast.errorTecnico(e); }
		sincronizando = false;
	}

	// Delega el formateo numérico al helper único de format.ts (ver Brief H / A1).
	// OJO: acá el precio se muestra hasta 2 decimales SIN forzar los dos (150 → "150",
	// no "150,00") — comportamiento original de esta ficha, distinto del de la tabla
	// de Cartera en Inversiones (que sí fuerza 2 fijos); por eso usa unidades(), no
	// pesos(). Se conserva además el caso especial "sin precio todavía" (→ "—").
	const money = (n: number | null, mon: string) =>
		n == null ? '—' : (mon === 'USD' ? 'U$D ' : '$') + unidades(n, 2);
</script>

<div class="titulo-guia">
	<h1>Mercado</h1>
	<Guia
		clave="config-tickers"
		para="Tener el catálogo de activos al día y los precios actualizados."
		uso="Sincronizar catálogo da de alta de una vez todos los instrumentos que publica la fuente; los que no cotizan ahí, como FCI o activos del exterior, se cargan con Nuevo activo. Tocá una ficha del listado o buscá en el selector para ver su gráfico."
	/>
</div>

<a href="/inversiones" class="btn-volver">← Volver a Inversiones</a>

<!-- Gráfico fijo: acompaña el scroll del listado, así tocar una ficha de abajo
     cambia lo que se ve arriba sin tener que volver al tope de la pantalla. -->
<section class="grafico-fijo">
	<GraficoPrecio {activos} bind:value={graficoId} especieDe={(a) => especieDeTicker(a.ticker, a.moneda)} />
</section>

<details class="form-panel" bind:open={formAbierto}>
	<summary>{editId ? '✏ Editar activo' : '➕ Nuevo activo'}</summary>
	<div class="form">
		{#if editId}<p class="editando">✏ Editando {fTicker} · <button class="link" onclick={resetForm}>cancelar</button></p>{/if}
		<label>Ticker
			<input bind:value={fTicker} placeholder="Ej: GD35, AL30, AAPL" class="up" class:readonly={tickerReadonly} readonly={tickerReadonly} />
			{#if tickerReadonly}<span class="hint">Bloqueado: ya tiene símbolo de cotización resuelto ({fSimboloCotizacion}).</span>{/if}
		</label>
		<label>Nombre<input bind:value={fNombre} placeholder="Nombre del activo" /></label>
		<label>Tipo
			<select bind:value={fTipo}>{#each TIPOS_ACTIVO as t}<option value={t}>{t}</option>{/each}</select>
		</label>
		<label>Renta
			<select bind:value={fRenta}>{#each RENTAS as r}<option value={r}>{r}</option>{/each}</select>
		</label>
		<label>Moneda de cotización
			<select bind:value={fMoneda}><option value="ARS">ARS</option><option value="USD">USD</option></select>
		</label>
		<label>Exposición
			<select bind:value={fExposicion} onchange={() => (fExpoTocada = true)}>{#each EXPOSICIONES as e}<option value={e}>{e}</option>{/each}</select>
		</label>
		<button class="btn btn-primary" onclick={guardar}>{editId ? 'Actualizar activo' : 'Guardar activo'}</button>
		{#if toast.texto}<p class="msg" class:err={toast.esError}>{#if toast.esError}<span class="err-x">✗</span> {/if}{toast.texto}</p>{/if}
	</div>
</details>

<p class="nota">Los FCI no se actualizan por aplicación, sus valores deben ajustarse a mano desde la tabla "Cartera Actual".</p>

<div class="acciones">
	<button class="btn btn-primary" onclick={actualizarAhora} disabled={actualizando}>{actualizando ? 'Actualizando…' : '⟳ Actualizar precios ahora'}</button>
	<button class="btn btn-secondary" onclick={sincronizarCatalogo} disabled={sincronizando}>{sincronizando ? 'Sincronizando…' : '⬇ Sincronizar catálogo'}</button>
</div>

{#if cargando}
	<p>Cargando…</p>
{:else if activos.length === 0}
	<p class="vacio">No tenés activos cargados. Traé el catálogo con “⬇ Sincronizar catálogo”, o creá el primero a mano con “➕ Nuevo activo”.</p>
{:else}
	<div class="filtros">
		<label>Tipo
			<select bind:value={filtroTipo}>
				<option value="Todos">Todos</option>
				{#each TIPOS_ACTIVO as t}<option value={t}>{t}</option>{/each}
			</select>
		</label>
		<label>Especie
			<select bind:value={filtroEspecie}>
				<option value="Todas">Todas</option>
				{#each ESPECIES as e}<option value={e}>{e}</option>{/each}
			</select>
		</label>
		<label>Buscar
			<input type="search" bind:value={filtroTexto} placeholder="Ticker o nombre…" />
		</label>
		{#if filtroTipo !== 'Todos' || filtroEspecie !== 'Todas' || filtroTexto.trim()}
			<button class="btn btn-secondary" onclick={() => { filtroTipo = 'Todos'; filtroEspecie = 'Todas'; filtroTexto = ''; }}>Limpiar</button>
		{/if}
	</div>
	{#if activosPorTipo.length === 0}
		<p class="vacio">No hay activos para el filtro.</p>
	{:else}
	{#each activosPorTipo as g (g.tipo)}
		<h2 class="grupo">{g.tipo} <span class="grupo-cuenta">{g.total}</span></h2>
		<div class="fichas">
			{#each g.items.slice(0, TOPE_GRUPO) as a (a.id)}
				<div class="ficha" class:editrow={editId === a.id} class:enGrafico={graficoId === String(a.id)}>
					<div class="ficha-top" role="button" tabindex="0" onclick={() => (graficoId = String(a.id))} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); graficoId = String(a.id); } }}>
						<span class="ficha-detalle"><strong class="tk">{a.ticker}</strong>{a.nombre && a.nombre !== a.ticker ? ' · ' + a.nombre : ''}</span>
						<span class="ficha-monto">{money(a.precio_actual, a.moneda)}</span>
					</div>
					<div class="ficha-bot">
						<span class="ficha-meta">{a.moneda} · {especieDeTicker(a.ticker, a.moneda)} · exp. {a.exposicion}</span>
						<span class="ficha-acc">
							<button aria-label="Editar" class="lapiz" onclick={() => editar(a)} title="Editar">✏</button>
						</span>
					</div>
				</div>
			{/each}
			{#if g.total > TOPE_GRUPO}
				<p class="nota">Mostrando {TOPE_GRUPO} de {g.total} — afiná la búsqueda para ver el resto.</p>
			{/if}
		</div>
	{/each}
	{/if}
	<p class="nota">El precio se muestra en la moneda de cotización del activo. <strong>Cambiar la moneda reinterpreta los precios de ese activo en la nueva moneda.</strong></p>
{/if}

<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	label { display: flex; flex-direction: column; font-size: 0.85rem; color: var(--text-dim); gap: 3px; }
	input, select { padding: 7px; font-size: 1rem; }
	.up { text-transform: uppercase; }
	input.readonly { opacity: 0.6; cursor: not-allowed; background: var(--surface-2); }
	.hint { font-size: 0.78rem; color: var(--text-dim); font-weight: 400; }

	/* Filtro de la lista (mismo patrón que Gastos) */
	.filtros { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end; margin: 8px 0 12px; }
	.filtros label { flex: 1 1 140px; min-width: 0; }
	.filtros input, .filtros select { width: 100%; min-width: 0; box-sizing: border-box; }
	.nota { font-size: 0.8rem; color: var(--text-dim); margin: 12px 0; line-height: 1.5; }
	.nota strong { color: var(--text); }
	.acciones { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
	.msg { font-weight: 600; color: var(--text); }
	.msg.err { color: var(--neg); display: flex; align-items: center; gap: 6px; }
	.msg .err-x { font-size: 1.3em; line-height: 1; }
	.editando { font-size: 0.85rem; color: var(--warn); background: rgba(251, 191, 36, 0.1); padding: 6px 10px; border-radius: 6px; margin: 0; }

	/* Gráfico fijo. El fondo opaco es necesario: sin él, las fichas del listado se
	   ven por debajo del gráfico al hacer scroll. */
	.grafico-fijo {
		position: sticky;
		top: 0;
		z-index: 20;
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 12px 0;
		padding: 10px 0 12px;
		background: var(--bg);
		border-bottom: 1px solid var(--border);
	}

	/* Encabezado de grupo por tipo */
	.grupo { font-size: 1rem; margin: 18px 0 8px; border-left: 3px solid var(--accent); padding-left: 12px; }
	.grupo-cuenta { font-size: 0.78rem; font-weight: 400; color: var(--text-dim); }

	/* Fichas por activo */
	.fichas { display: flex; flex-direction: column; gap: 8px; }
	.ficha { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 10px 12px; }
	.ficha.editrow { border-color: var(--accent); background: rgba(91, 157, 255, 0.08); }
	.ficha.enGrafico { border-color: var(--accent); }
	.ficha-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; cursor: pointer; }
	.ficha-detalle { font-weight: 600; font-size: 0.95rem; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.tk { font-family: var(--font-mono, monospace); color: var(--accent); }
	.ficha-monto { font-weight: 700; white-space: nowrap; flex-shrink: 0; }
	.ficha-bot { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 4px; }
	.ficha-meta { font-size: 0.78rem; color: var(--text-dim); line-height: 1.35; }
	.ficha-acc { white-space: nowrap; flex-shrink: 0; }
	.vacio { color: var(--text-dim); font-style: italic; }
</style>

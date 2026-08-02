<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import { actualizarPreciosYFoto, listarCatalogoData912, type CatalogoItem } from '$lib/db/precios';
	import { backfillHistoricoActivo, tieneHistoricoData912 } from '$lib/db/precios_historicos';
	import { Toast } from '$lib/toast.svelte';
	import { unidades } from '$lib/format';
	import Guia from '$lib/Guia.svelte';

	const TIPOS_ACTIVO = ['Bono', 'ON', 'FCI', 'Accion', 'CEDEAR', 'Indice'];
	const RENTAS = ['Fija', 'Mixta', 'Variable', 'Liquido'];
	// Exposición al tipo de cambio (a qué FX sigue el valor del activo), distinta de
	// la moneda de cotización: un CEDEAR o una ON dollar-linked cotizan en ARS pero
	// su exposición es 'Dolar'. Alimenta la tabla de Exposición en Inversiones.
	const EXPOSICIONES = ['Dolar', 'CER', 'Peso'];

	let activos = $state<any[]>([]);
	let cargando = $state(true);
	let actualizando = $state(false);
	const toast = new Toast();

	// Filtro de la lista (combinable): tipo + texto contra ticker/nombre.
	let filtroTipo = $state('Todos');
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

	async function cargar() {
		// Todos los activos del perfil (incluidos FCI): esta pantalla es el único
		// lugar de alta/edición. Orden: por tipo y, dentro, por ticker.
		activos = (await query(
			"SELECT id, ticker, nombre, tipo, renta, moneda, precio_actual, COALESCE(exposicion, CASE WHEN moneda='USD' OR tipo IN ('CEDEAR','Indice') THEN 'Dolar' ELSE 'Peso' END) AS exposicion FROM activo WHERE perfil_id=1 AND activo=1 ORDER BY tipo COLLATE NOCASE, ticker COLLATE NOCASE"
		)) as any[];
		cargando = false;
	}
	onMount(cargar);

	// Filtro combinable: tipo + texto (substring case-insensitive contra ticker y
	// nombre). Solo reduce qué fichas se ven; no altera orden ni agrupado.
	const activosFiltrados = $derived.by(() => {
		const q = filtroTexto.trim().toLowerCase();
		return activos.filter((a) =>
			(filtroTipo === 'Todos' || a.tipo === filtroTipo) &&
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
			.map(([tipo, items]) => ({ tipo, items }));
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
		fMoneda = 'ARS'; fExposicion = 'Peso'; fExpoTocada = false;
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
			// Precio histórico (Bloque 1): si el tipo tiene endpoint de data912 y hay
			// símbolo, baja la serie completa en segundo plano. Fire-and-forget: no
			// bloquea el guardado ni el toast; si falla (sin internet, símbolo sin
			// serie), no rompe nada — la cadena de respaldo sigue funcionando igual.
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

	// --- Bloque 7: catálogo de instrumentos de data912 -----------------------
	// Se baja una sola vez, al abrir el panel por primera vez (no en onMount:
	// son 5 fetches extra que no hacen falta si el usuario nunca abre el buscador).
	let catalogoAbierto = $state(false);
	let catalogo = $state<CatalogoItem[]>([]);
	let catalogoCargando = $state(false);
	let catalogoErr = $state('');
	let catFiltroTipo = $state('Todos');
	let catFiltroTexto = $state('');

	async function abrirCatalogo() {
		catalogoAbierto = true;
		if (catalogo.length > 0 || catalogoCargando) return;
		catalogoCargando = true;
		catalogoErr = '';
		try { catalogo = await listarCatalogoData912(); }
		catch (e) { console.error(e); catalogoErr = 'No se pudo conectar con data912.'; }
		catalogoCargando = false;
	}

	// Símbolos ya cargados como activo (para el badge "Ya cargado ✓" en vez de
	// ofrecer un alta duplicada).
	const simbolosCargados = $derived(new Set(activos.map((a) => String(a.ticker).toUpperCase())));

	const catalogoFiltrado = $derived.by(() => {
		const q = catFiltroTexto.trim().toLowerCase();
		return catalogo.filter((c) =>
			(catFiltroTipo === 'Todos' || c.tipo === catFiltroTipo) &&
			(!q || c.simbolo.toLowerCase().includes(q))
		);
	});

	// Precarga el form de alta con lo que ya sabemos del catálogo (ticker/tipo/
	// precio-moneda) y deja el resto (nombre, renta, exposición) a completar a
	// mano — el alta/edición manual sigue siendo el mismo formulario de siempre.
	function cargarDesdeCatalogo(c: CatalogoItem) {
		resetForm();
		fTicker = c.simbolo;
		fTipo = c.tipo;
		fRenta = c.tipo === 'Bono' || c.tipo === 'ON' ? 'Fija' : 'Variable';
		formAbierto = true;
		toast.limpiar();
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	// --- Bloque 7: gráfico de precio in-place (tap-to-expand) -----------------
	// Mismo patrón que otras pantallas (tocar el cuerpo de una ficha para
	// desplegar el detalle). Un solo activo expandido por vez.
	let expandidoId = $state<number | null>(null);
	let serieActivo = $state<{ fecha: string; precio: number }[]>([]);
	let serieCargando = $state(false);

	const VENTANAS: [string, string][] = [['1m', '1M'], ['3m', '3M'], ['6m', '6M'], ['1a', '1A'], ['total', 'Todo']];
	const DIAS_VENTANA: Record<string, number | null> = { '1m': 30, '3m': 91, '6m': 182, '1a': 365, total: null };
	let ventanaActiva = $state('6m');

	async function toggleExpandir(a: any) {
		if (expandidoId === a.id) { expandidoId = null; return; }
		expandidoId = a.id;
		serieCargando = true;
		const traer = () => query(
			'SELECT fecha, precio FROM precio_historico WHERE perfil_id=1 AND activo_id=? ORDER BY fecha',
			[a.id]
		) as Promise<any[]>;
		serieActivo = await traer();
		// Backfill al vuelo: el backfill de precio_historico (Bloque 1) solo se
		// dispara al guardar/editar un activo desde este formulario — los activos
		// que ya estaban cargados antes de esta pantalla nunca lo corrieron, así
		// que su gráfico arrancaba vacío. Si hay menos de 2 puntos y el tipo tiene
		// serie en data912, se baja acá (mismo mecanismo, on-demand).
		if (serieActivo.length < 2 && tieneHistoricoData912(a.tipo)) {
			try { await backfillHistoricoActivo(a.id); serieActivo = await traer(); } catch {}
		}
		serieCargando = false;
	}

	const serieVentana = $derived.by(() => {
		const dias = DIAS_VENTANA[ventanaActiva];
		if (dias == null || serieActivo.length === 0) return serieActivo;
		const ultima = serieActivo[serieActivo.length - 1].fecha;
		const [y, m, d] = ultima.split('-').map(Number);
		const corte = new Date(Date.UTC(y, m - 1, d) - dias * 86400000);
		const corteISO = corte.getUTCFullYear() + '-' + String(corte.getUTCMonth() + 1).padStart(2, '0') + '-' + String(corte.getUTCDate()).padStart(2, '0');
		return serieActivo.filter((s) => s.fecha >= corteISO);
	});

	// SVG propio (sin librerías de terceros), mismo espíritu que el gráfico de
	// Evolución de cartera: una sola línea, escala lineal, piso en 0.
	const CW = 320, CH = 110, CPAD = { l: 4, r: 4, t: 8, b: 6 };
	const chartActivo = $derived.by(() => {
		const s = serieVentana;
		if (s.length < 2) return null;
		const xs = s.map((p) => new Date(p.fecha + 'T00:00:00Z').getTime());
		const minX = xs[0], maxX = xs[xs.length - 1];
		const px = (x: number) => CPAD.l + ((x - minX) / (maxX - minX || 1)) * (CW - CPAD.l - CPAD.r);
		const vals = s.map((p) => p.precio);
		let minY = Math.min(...vals), maxY = Math.max(...vals);
		const pad = (maxY - minY) * 0.1 || Math.max(1, maxY * 0.05);
		minY = Math.max(0, minY - pad); maxY += pad;
		const py = (y: number) => CH - CPAD.b - ((y - minY) / (maxY - minY || 1)) * (CH - CPAD.t - CPAD.b);
		const pts = s.map((p, i) => ({ x: px(xs[i]), y: py(p.precio) }));
		const linea = pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
		const primero = s[0].precio, ultimo = s[s.length - 1].precio;
		const variacion = primero ? ultimo / primero - 1 : 0;
		return { linea, ultimo, variacion, ultimaX: pts[pts.length - 1].x, ultimaY: pts[pts.length - 1].y };
	});

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
	<Guia clave="config-tickers" texto="Acá se dan de alta y se editan todos los activos. Cada uno se crea sin tenencia: recién tiene posición cuando le cargás movimientos. Buscá en '🔍 Buscar en el mercado' para precargar ticker y tipo desde data912, o cargalo a mano. Tocá una ficha para ver su gráfico de precio." />
</div>

<a href="/inversiones" class="btn-volver">← Volver a Inversiones</a>

<details class="form-panel" bind:open={formAbierto}>
	<summary>{editId ? '✏ Editar activo' : '➕ Nuevo activo'}</summary>
	<div class="form">
		{#if editId}<p class="editando">✏ Editando {fTicker} · <button class="link" onclick={resetForm}>cancelar</button></p>{/if}
		<label>Ticker<input bind:value={fTicker} placeholder="Ej: GD35, AL30, AAPL" class="up" /></label>
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

<details class="form-panel" bind:open={catalogoAbierto} ontoggle={() => { if (catalogoAbierto) abrirCatalogo(); }}>
	<summary>🔍 Buscar en el mercado</summary>
	<div class="form">
		{#if catalogoCargando}
			<p class="nota">Buscando en data912…</p>
		{:else if catalogoErr}
			<p class="msg err"><span class="err-x">✗</span> {catalogoErr}</p>
		{:else}
			<div class="filtros">
				<label>Tipo
					<select bind:value={catFiltroTipo}>
						<option value="Todos">Todos</option>
						<option value="Accion">Accion</option>
						<option value="CEDEAR">CEDEAR</option>
						<option value="Bono">Bono</option>
						<option value="ON">ON</option>
					</select>
				</label>
				<label>Buscar
					<input type="search" bind:value={catFiltroTexto} placeholder="Símbolo…" />
				</label>
			</div>
			<div class="fichas cat-fichas">
				{#each catalogoFiltrado.slice(0, 60) as c (c.simbolo)}
					<div class="ficha cat-ficha">
						<span class="ficha-detalle"><strong class="tk">{c.simbolo}</strong> · {c.tipo}</span>
						<span class="ficha-monto">{money(c.precio, 'ARS')}</span>
						{#if simbolosCargados.has(c.simbolo)}
							<span class="ya-cargado">Ya cargado ✓</span>
						{:else}
							<button class="btn btn-secondary" onclick={() => cargarDesdeCatalogo(c)}>Cargar</button>
						{/if}
					</div>
				{/each}
				{#if catalogoFiltrado.length === 0}<p class="vacio">Sin resultados.</p>{/if}
				{#if catalogoFiltrado.length > 60}<p class="nota">Mostrando 60 de {catalogoFiltrado.length} — afiná la búsqueda.</p>{/if}
			</div>
		{/if}
	</div>
</details>

<ul class="nota">
	<li>El ticker (código) de un instrumento cambia según nombre y moneda de cotización. Validar asegura la carga intra-app de las cotizaciones.</li>
	<li>Los FCI no se actualizan por aplicación, sus valores deben ajustarse a mano desde la tabla "Cartera Actual".</li>
</ul>

<div class="acciones">
	<button class="btn btn-primary" onclick={actualizarAhora} disabled={actualizando}>{actualizando ? 'Actualizando…' : '⟳ Actualizar precios ahora'}</button>
</div>

{#if cargando}
	<p>Cargando…</p>
{:else if activos.length === 0}
	<p class="vacio">No tenés activos cargados. Creá el primero con “➕ Nuevo activo”.</p>
{:else}
	<div class="filtros">
		<label>Tipo
			<select bind:value={filtroTipo}>
				<option value="Todos">Todos</option>
				{#each TIPOS_ACTIVO as t}<option value={t}>{t}</option>{/each}
			</select>
		</label>
		<label>Buscar
			<input type="search" bind:value={filtroTexto} placeholder="Ticker o nombre…" />
		</label>
		{#if filtroTipo !== 'Todos' || filtroTexto.trim()}<button class="btn btn-secondary" onclick={() => { filtroTipo = 'Todos'; filtroTexto = ''; }}>Limpiar</button>{/if}
	</div>
	{#if activosPorTipo.length === 0}
		<p class="vacio">No hay activos para el filtro.</p>
	{:else}
	{#each activosPorTipo as g (g.tipo)}
		<h2 class="grupo">{g.tipo}</h2>
		<div class="fichas">
			{#each g.items as a (a.id)}
				<div class="ficha" class:editrow={editId === a.id}>
					<div class="ficha-top" role="button" tabindex="0" onclick={() => toggleExpandir(a)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpandir(a); } }}>
						<span class="ficha-detalle"><strong class="tk">{a.ticker}</strong> · {a.nombre}</span>
						<span class="ficha-monto">{money(a.precio_actual, a.moneda)}</span>
					</div>
					<div class="ficha-bot">
						<span class="ficha-meta">{a.moneda} · exp. {a.exposicion}</span>
						<span class="ficha-acc">
							<button aria-label="Editar" class="lapiz" onclick={() => editar(a)} title="Editar">✏</button>
						</span>
					</div>
					{#if expandidoId === a.id}
						<div class="chart-panel">
							{#if serieCargando}
								<p class="nota">Cargando historial…</p>
							{:else if !chartActivo}
								<p class="nota">Sin serie histórica para este activo todavía.</p>
							{:else}
								<div class="chart-head">
									<span class="chart-precio">{money(chartActivo.ultimo, a.moneda)}</span>
									<span class="chart-var" class:pos={chartActivo.variacion >= 0} class:neg={chartActivo.variacion < 0}>{chartActivo.variacion >= 0 ? '+' : ''}{(chartActivo.variacion * 100).toFixed(1)}%</span>
								</div>
								<svg viewBox="0 0 {CW} {CH}" class="mini-chart" preserveAspectRatio="none">
									<path d={chartActivo.linea} fill="none" stroke="var(--accent)" stroke-width="1.6" />
									<circle cx={chartActivo.ultimaX} cy={chartActivo.ultimaY} r="2.4" fill="var(--accent)" />
								</svg>
							{/if}
							<div class="ventanas">
								{#each VENTANAS as [k, lbl] (k)}
									<button type="button" class:activo={ventanaActiva === k} onclick={() => (ventanaActiva = k)}>{lbl}</button>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/each}
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

	/* Filtro de la lista (mismo patrón que Gastos) */
	.filtros { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end; margin: 8px 0 12px; }
	.filtros label { flex: 1 1 140px; min-width: 0; }
	.filtros input, .filtros select { width: 100%; min-width: 0; box-sizing: border-box; }
	.nota { font-size: 0.8rem; color: var(--text-dim); margin: 12px 0; line-height: 1.5; }
	.nota strong { color: var(--text); }
	ul.nota { padding-left: 18px; }
	ul.nota li { margin: 4px 0; }
	.acciones { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
	.msg { font-weight: 600; color: var(--text); }
	.msg.err { color: var(--neg); display: flex; align-items: center; gap: 6px; }
	.msg .err-x { font-size: 1.3em; line-height: 1; }
	.editando { font-size: 0.85rem; color: var(--warn); background: rgba(251, 191, 36, 0.1); padding: 6px 10px; border-radius: 6px; margin: 0; }

	/* Panel de carga colapsable (patrón estándar, igual que Gastos/Ingresos) */
	/* .form-panel vive ahora en +layout.svelte (global, Brief H / A3). */

	/* Encabezado de grupo por tipo */
	.grupo { font-size: 1rem; margin: 18px 0 8px; border-left: 3px solid var(--accent); padding-left: 12px; }

	/* Fichas por activo */
	.fichas { display: flex; flex-direction: column; gap: 8px; }
	.ficha { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 10px 12px; }
	.ficha.editrow { border-color: var(--accent); background: rgba(91, 157, 255, 0.08); }
	.ficha-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; cursor: pointer; }
	.ficha-detalle { font-weight: 600; font-size: 0.95rem; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.tk { font-family: var(--font-mono, monospace); color: var(--accent); }
	.ficha-monto { font-weight: 700; white-space: nowrap; flex-shrink: 0; }
	.ficha-bot { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 4px; }
	.ficha-meta { font-size: 0.78rem; color: var(--text-dim); line-height: 1.35; }
	.ficha-acc { white-space: nowrap; flex-shrink: 0; }
	.vacio { color: var(--text-dim); font-style: italic; }

	/* Catálogo de instrumentos de data912 (Bloque 7) — mismo patrón visual de
	   ficha que la lista de activos, en fila (sin apilar top/bot: acá no hay
	   edición, solo símbolo/tipo/precio + acción). */
	.cat-fichas { max-height: 360px; overflow-y: auto; }
	.cat-ficha { display: flex; align-items: center; gap: 10px; }
	.cat-ficha .ficha-detalle { flex: 1; }
	.ya-cargado { font-size: 0.78rem; color: var(--pos); white-space: nowrap; flex-shrink: 0; }

	/* Gráfico de precio in-place (tap-to-expand sobre la ficha) */
	.chart-panel { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border); }
	.chart-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
	.chart-precio { font-weight: 700; font-size: 0.95rem; }
	.chart-var { font-size: 0.82rem; font-weight: 600; }
	.chart-var.pos { color: var(--pos); }
	.chart-var.neg { color: var(--neg); }
	.mini-chart { width: 100%; height: 90px; display: block; }
	.ventanas { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
	.ventanas button { font-size: 0.72rem; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-dim); cursor: pointer; }
	.ventanas button.activo { background: var(--accent); border-color: var(--accent); color: #fff; }
</style>

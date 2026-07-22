<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import { previsualizarPrecios, actualizarPrecios, ajustarEscala } from '$lib/db/precios';
	import { Toast } from '$lib/toast.svelte';
	import Guia from '$lib/Guia.svelte';

	const TIPOS_ACTIVO = ['Bono', 'ON', 'FCI', 'Accion', 'CEDEAR', 'Indice'];
	const RENTAS = ['Fija', 'Mixta', 'Variable', 'Liquido'];
	// Exposición al tipo de cambio (a qué FX sigue el valor del activo), distinta de
	// la moneda de cotización: un CEDEAR o una ON dollar-linked cotizan en ARS pero
	// su exposición es 'Dolar'. Alimenta la tabla de Exposición en Inversiones.
	const EXPOSICIONES = ['Dolar', 'CER', 'Peso'];

	let activos = $state<any[]>([]);
	let cargando = $state(true);
	let preview = $state<Record<string, number> | null>(null);
	let probando = $state(false);
	let actualizando = $state(false);
	const toast = new Toast();

	// Formulario unificado (alta + edición). editId null = alta, número = edición.
	let formAbierto = $state(false);
	let editId = $state<number | null>(null);
	let fTicker = $state('');
	let fNombre = $state('');
	let fTipo = $state('Accion');
	let fRenta = $state('Variable');
	let fMoneda = $state<'ARS' | 'USD'>('ARS');
	let fSimbolo = $state('');
	let fExposicion = $state<'Dolar' | 'CER' | 'Peso'>('Peso');
	// Marca si el usuario tocó la exposición a mano; si no, se sugiere por regla.
	let fExpoTocada = $state(false);

	async function cargar() {
		// Todos los activos del perfil (incluidos FCI): esta pantalla es el único
		// lugar de alta/edición. Orden: por tipo y, dentro, por ticker.
		activos = (await query(
			"SELECT id, ticker, nombre, tipo, renta, moneda, precio_actual, simbolo_cotizacion, COALESCE(exposicion, CASE WHEN moneda='USD' OR tipo IN ('CEDEAR','Indice') THEN 'Dolar' ELSE 'Peso' END) AS exposicion FROM activo WHERE perfil_id=1 AND activo=1 ORDER BY tipo COLLATE NOCASE, ticker COLLATE NOCASE"
		)) as any[];
		cargando = false;
	}
	onMount(cargar);

	// Agrupa por tipo: grupos en orden alfabético; los ítems ya vienen por ticker
	// del ORDER BY. En esta pantalla el ticker es el dato central visible.
	const activosPorTipo = $derived.by(() => {
		const grupos = new Map<string, any[]>();
		for (const a of activos) {
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
		fMoneda = 'ARS'; fSimbolo = ''; fExposicion = 'Peso'; fExpoTocada = false;
	}

	function editar(a: any) {
		editId = a.id;
		fTicker = a.ticker;
		fNombre = a.nombre;
		fTipo = a.tipo;
		fRenta = a.renta;
		fMoneda = a.moneda;
		fSimbolo = a.simbolo_cotizacion ?? '';
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
		const simbolo = fSimbolo.trim().toUpperCase() || null;
		if (!ticker) return toast.error('Falta el ticker');
		if (!nombre) return toast.error('Falta el nombre');
		try {
			// Unicidad (perfil, ticker): bloquear duplicado con aviso claro antes de
			// que salte el UNIQUE de la tabla.
			const dup = (await query('SELECT id FROM activo WHERE perfil_id=1 AND ticker=? AND id<>?',
				[ticker, editId ?? -1])) as any[];
			if (dup.length) return toast.error(`Ya existe un activo con el ticker "${ticker}"`);

			if (editId) {
				await query(
					'UPDATE activo SET ticker=?, nombre=?, tipo=?, renta=?, moneda=?, exposicion=?, simbolo_cotizacion=? WHERE id=? AND perfil_id=1',
					[ticker, nombre, fTipo, fRenta, fMoneda, fExposicion, simbolo, editId]
				);
				toast.exito('Activo actualizado ✅');
			} else {
				// Se crea sin transacciones (tenencia cero): existe hasta que se le
				// carguen movimientos. precio_actual queda null hasta la 1ª cotización.
				await query(
					'INSERT INTO activo (perfil_id,ticker,nombre,tipo,renta,moneda,exposicion,simbolo_cotizacion) VALUES (1,?,?,?,?,?,?,?)',
					[ticker, nombre, fTipo, fRenta, fMoneda, fExposicion, simbolo]
				);
				toast.exito('Activo creado ✅');
			}
			resetForm(); // el panel NO se cierra: permite crear varios seguidos
			await cargar();
		} catch (e: any) {
			const m = String(e?.message ?? e);
			toast.error(/unique/i.test(m) ? `Ya existe un activo con el ticker "${ticker}"` : 'Error: ' + m);
		}
	}

	async function probar() {
		probando = true; preview = null;
		try { preview = await previsualizarPrecios(); toast.exito('Precios traídos de data912 ✅'); }
		catch (e: any) { toast.error('Error: ' + (e?.message ?? e)); }
		probando = false;
	}

	// Precio de la fuente para un activo, ya escalado (bonos/ONs ÷100).
	function precioFuente(a: any): number | null {
		if (!preview || !a.simbolo_cotizacion) return null;
		const raw = preview[String(a.simbolo_cotizacion).trim().toUpperCase()];
		return raw == null ? null : ajustarEscala(raw, a.tipo);
	}

	async function actualizarAhora() {
		actualizando = true;
		try { toast.exito(await actualizarPrecios()); await cargar(); }
		catch (e: any) { toast.error('Error: ' + (e?.message ?? e)); }
		actualizando = false;
	}

	const money = (n: number | null, mon: string) =>
		n == null ? '—' : (mon === 'USD' ? 'U$D ' : '$') + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 });
</script>

<div class="titulo-guia">
	<h1>Tickers</h1>
	<Guia clave="config-tickers" texto="Acá se dan de alta y se editan todos los activos. Cada uno se crea sin tenencia: recién tiene posición cuando le cargás movimientos. Asociá su símbolo de data912 para que el precio se actualice solo; dejalo en blanco para manejarlo a mano." />
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
		<label>Símbolo data912 <span class="opt">(opcional)</span>
			<input bind:value={fSimbolo} placeholder="—" class="up" />
		</label>
		<button class="btn btn-primary" onclick={guardar}>{editId ? 'Actualizar activo' : 'Guardar activo'}</button>
		{#if toast.texto}<p class="msg">{toast.texto}</p>{/if}
	</div>
</details>

<p class="nota">
	Cada instrumento de BYMA tiene tres símbolos: el pelado en <strong>pesos</strong> (ej. <code>GD35</code>),
	con <strong>D</strong> = dólar MEP (<code>GD35D</code>) y con <strong>C</strong> = dólar CCL (<code>GD35C</code>).
	Para un activo en <strong>USD</strong>, usá el símbolo con D o C; para uno en <strong>pesos</strong>, el pelado.
	Los <strong>FCI</strong> no cotizan en data912: dejá su símbolo vacío y actualizá el precio a mano desde Inversiones.
</p>

<div class="acciones">
	<button class="btn btn-secondary" onclick={probar} disabled={probando}>{probando ? 'Probando…' : '🔎 Probar precios'}</button>
	<button class="btn btn-primary" onclick={actualizarAhora} disabled={actualizando}>{actualizando ? 'Actualizando…' : '⟳ Actualizar precios ahora'}</button>
</div>

{#if cargando}
	<p>Cargando…</p>
{:else if activos.length === 0}
	<p class="vacio">No tenés activos cargados. Creá el primero con “➕ Nuevo activo”.</p>
{:else}
	{#each activosPorTipo as g (g.tipo)}
		<h2 class="grupo">{g.tipo}</h2>
		<div class="fichas">
			{#each g.items as a (a.id)}
				<div class="ficha" class:editrow={editId === a.id}>
					<div class="ficha-top">
						<span class="ficha-detalle"><strong class="tk">{a.ticker}</strong> · {a.nombre}</span>
						<span class="ficha-monto">{money(a.precio_actual, a.moneda)}</span>
					</div>
					<div class="ficha-bot">
						<span class="ficha-meta">
							{a.renta} · {a.moneda} · exp. {a.exposicion} · {a.simbolo_cotizacion ? `data912: ${a.simbolo_cotizacion}` : 'sin símbolo'}
							{#if preview && a.simbolo_cotizacion}
								· fuente {#if precioFuente(a) != null}<span class="ok">{money(precioFuente(a), a.moneda)}</span>{:else}<span class="bad">sin match</span>{/if}
							{/if}
						</span>
						<span class="ficha-acc">
							<button aria-label="Editar" class="lapiz" onclick={() => editar(a)} title="Editar">✏</button>
						</span>
					</div>
				</div>
			{/each}
		</div>
	{/each}
	<p class="nota">El precio se guarda en la moneda que implica el símbolo. Si la fuente dice <span class="bad">sin match</span>, revisá el símbolo (mayúsculas, sufijo D/C). <strong>Cambiar la moneda reinterpreta los precios de ese activo en la nueva moneda.</strong></p>
{/if}

<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	label { display: flex; flex-direction: column; font-size: 0.85rem; color: var(--text-dim); gap: 3px; }
	input, select { padding: 7px; font-size: 1rem; }
	.up { text-transform: uppercase; }
	.opt { color: var(--text-dim); font-weight: 400; }
	.nota { font-size: 0.8rem; color: var(--text-dim); margin: 12px 0; line-height: 1.5; }
	.nota strong { color: var(--text); }
	.nota code { background: var(--surface-2); padding: 1px 5px; border-radius: 4px; color: var(--text); }
	.acciones { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
	.msg { font-weight: 600; color: var(--text); }
	.editando { font-size: 0.85rem; color: var(--warn); background: rgba(251, 191, 36, 0.1); padding: 6px 10px; border-radius: 6px; margin: 0; }

	/* Panel de carga colapsable (patrón estándar, igual que Gastos/Ingresos) */
	.form-panel { border: 1px solid var(--border); border-radius: 8px; background: var(--surface); margin: 12px 0; }
	.form-panel summary { cursor: pointer; padding: 11px 14px; font-family: var(--font-display); font-weight: 600; font-size: 0.92rem; color: var(--accent); list-style: none; }
	.form-panel summary::-webkit-details-marker { display: none; }
	.form-panel[open] summary { border-bottom: 1px solid var(--border); }
	.form-panel .form { background: none; border-color: transparent; border-radius: 0; margin: 0; padding: 12px 14px; }

	/* Encabezado de grupo por tipo */
	.grupo { font-size: 1rem; margin: 18px 0 8px; border-left: 3px solid var(--accent); padding-left: 12px; }

	/* Fichas por activo */
	.fichas { display: flex; flex-direction: column; gap: 8px; }
	.ficha { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 10px 12px; }
	.ficha.editrow { border-color: var(--accent); background: rgba(91, 157, 255, 0.08); }
	.ficha-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
	.ficha-detalle { font-weight: 600; font-size: 0.95rem; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.tk { font-family: var(--font-mono, monospace); color: var(--accent); }
	.ficha-monto { font-weight: 700; white-space: nowrap; flex-shrink: 0; }
	.ficha-bot { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 4px; }
	.ficha-meta { font-size: 0.78rem; color: var(--text-dim); line-height: 1.35; }
	.ficha-acc { white-space: nowrap; flex-shrink: 0; }
	.ok { color: var(--pos); font-weight: 600; }
	.bad { color: var(--neg); }
	.vacio { color: var(--text-dim); font-style: italic; }
</style>

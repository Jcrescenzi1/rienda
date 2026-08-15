<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import { fechaISO, pesos, mesCorto, fmtFecha, unidades } from '$lib/format';
	import { calcularFIFO } from '$lib/cartera';
	import { descargarHistoricoData912, tieneHistoricoData912 } from '$lib/db/precios_historicos';
	import Guia from '$lib/Guia.svelte';
	import NotaVisual from '$lib/NotaVisual.svelte';
	import Skeleton from '$lib/Skeleton.svelte';
	import CountUp from '$lib/CountUp.svelte';
	import ComboActivo from '$lib/ComboActivo.svelte';
	import { progresoReplay } from '$lib/anim';

	let cargando = $state(true);
	let snaps = $state<any[]>([]);
	let periodo = $state<'total' | '1a' | '6m' | '3m' | '1m' | '1s'>('total');
	const periodos: [string, string][] = [['total', 'Total'], ['1a', '1A'], ['6m', '6M'], ['3m', '3M'], ['1m', '1M'], ['1s', '1S']];

	let realizadoMes = $state<any[]>([]);

	async function cargar() {
		const rows = (await query('SELECT fecha, valor_usd, flujo_usd, valor_ars, dolar FROM snapshot WHERE perfil_id=1 ORDER BY fecha')) as any[];
		let idx = 100; let prev: number | null = null;
		snaps = rows.map((s) => {
			let r = 0;
			if (prev !== null && prev > 0) { r = (s.valor_usd - s.flujo_usd) / prev - 1; idx *= 1 + r; }
			prev = s.valor_usd;
			return { ...s, ret: r, idx };
		});
		// Ganancia realizada por mes (USD) — FIFO compartido con Inversiones
		const { realPorMes } = await calcularFIFO();
		realizadoMes = Object.keys(realPorMes).sort().reverse().map((m) => ({ mes: m, valor: realPorMes[m] }));
		cargando = false;
	}

	// Benchmark opcional: catálogo completo (todos los activo sincronizados, no
	// solo los operados — misma query que usa Mercado/config-tickers). Última
	// elección se guarda en localStorage (no en perfil/DB): es una preferencia de
	// vista, no un dato de cartera.
	const LS_BENCH = 'rienda_evolucion_benchmark';
	let catalogo = $state<{ id: number; ticker: string; nombre: string; tipo: string; moneda?: string }[]>([]);
	let benchActivoId = $state('');

	async function cargarCatalogo() {
		const rows = (await query(
			"SELECT id, ticker, nombre, tipo, moneda FROM activo WHERE perfil_id=1 AND activo=1 ORDER BY tipo COLLATE NOCASE, ticker COLLATE NOCASE"
		)) as any[];
		// Solo activos cuyo tipo tiene endpoint histórico en data912 (Acción, CEDEAR,
		// Índice, Bono — ON y FCI no publican serie ahí). No depende de si ya hay
		// algo guardado en precio_historico: la serie se pide en vivo, ver abajo.
		catalogo = rows.filter((a) => tieneHistoricoData912(a.tipo));
	}
	function elegirBenchmark(a: { id: number }) {
		try { localStorage.setItem(LS_BENCH, String(a.id)); } catch { /* ignore */ }
	}
	function quitarBenchmark() {
		benchActivoId = '';
		try { localStorage.removeItem(LS_BENCH); } catch { /* ignore */ }
	}

	onMount(() => {
		cargar();
		cargarCatalogo();
		try {
			const guardado = localStorage.getItem(LS_BENCH);
			if (guardado) benchActivoId = guardado;
		} catch { /* ignore */ }
	});

	// Alias locales al helper único de format.ts (ver Brief H / A1).
	const usd = (n: number, d = 0) => pesos(n, 'USD', d);
	const pct = (n: number) => (n >= 0 ? '+' : '') + (n * 100).toFixed(1) + '%';
	// mesCorto viene de $lib/format (helper único, Brief H / A2).

	// Escalas de los ejes del gráfico con números "lindos": la referencia sirve
	// para ubicarse (¿estoy cerca de 10mil? ¿por encima del 50%?), el valor
	// exacto se lee tocando el gráfico (CountUp de las tarjetas de arriba). Por
	// eso las etiquetas de los ejes van SIN decimales y en pasos redondos (1-2-5
	// × 10ⁿ), aunque eso implique que el borde del gráfico no coincida con el
	// dato real — el margen de arriba/abajo ya existe para eso.
	function pasoLindo(rango: number, objetivo = 4): number {
		const bruto = Math.max(rango, 1e-9) / objetivo;
		const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
		const norm = bruto / mag;
		const paso = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
		return Math.max(1, paso * mag); // nunca sub-unidad: ni centavos ni décimas de punto
	}
	function fmtEjeUsd(v: number): string {
		const signo = v < 0 ? '-' : '';
		const a = Math.abs(v);
		// 'm' minúscula = mil, 'M' mayúscula = millón — misma distinción que ya usa
		// fmtVol en GraficoPrecio.svelte, para no inventar una convención nueva.
		if (a >= 1_000_000) return signo + unidades(a / 1_000_000, a % 1_000_000 === 0 ? 0 : 1) + 'M';
		if (a >= 1000) return signo + unidades(a / 1000, a % 1000 === 0 ? 0 : 1) + 'm';
		return signo + unidades(a, 0);
	}
	function fmtEjePct(v: number): string {
		// v en índice (100 = 0%); acá nunca llega exactamente 100 — ese tick tiene
		// su propia etiqueta destacada (yCero) — pero se cubre por las dudas.
		const pts = Math.round(v - 100);
		return (pts >= 0 ? '+' : '') + pts + '%';
	}

	let actual = $derived(snaps.length ? snaps[snaps.length - 1] : null);

	// Corte por período: fecha de inicio de la ventana
	let cutoff = $derived.by(() => {
		const d = new Date();
		if (periodo === '1a') d.setFullYear(d.getFullYear() - 1);
		else if (periodo === '6m') d.setMonth(d.getMonth() - 6);
		else if (periodo === '3m') d.setMonth(d.getMonth() - 3);
		else if (periodo === '1m') d.setMonth(d.getMonth() - 1);
		else if (periodo === '1s') d.setDate(d.getDate() - 7);
		else return null;
		return fechaISO(d);
	});
	// snapshot base = el último en/antes del corte (o el primero)
	let baseSnap = $derived.by(() => {
		if (!snaps.length) return null;
		if (!cutoff) return snaps[0];
		let base = snaps[0];
		for (const s of snaps) if (s.fecha <= cutoff) base = s;
		return base;
	});
	// snaps de la ventana, con índice re-basado a 100 al inicio
	let vsnaps = $derived.by(() => {
		if (!baseSnap) return [];
		return snaps.filter((s) => s.fecha >= baseSnap.fecha).map((s) => ({ ...s, cidx: (s.idx / baseSnap.idx) * 100 }));
	});
	let twrVentana = $derived(vsnaps.length ? vsnaps[vsnaps.length - 1].cidx / 100 - 1 : 0);
	let flujoVentana = $derived(vsnaps.slice(1).reduce((s, x) => s + x.flujo_usd, 0));

	// Serie completa del benchmark, bajada de data912 EN MEMORIA — igual que el
	// gráfico de Mercado (GraficoPrecio.svelte): nunca se guarda en
	// precio_historico, así que no depende de que el activo haya pasado por un
	// alta/edición manual que dispare el backfill. Se pide una sola vez por
	// activo y queda en una cache de sesión (se pierde al salir de la pantalla).
	type PuntoBench = { fecha: string; precio: number };
	const cacheBench = new Map<number, PuntoBench[]>();
	let benchSerieCruda = $state<PuntoBench[]>([]);
	let benchCargando = $state(false);
	let benchError = $state('');
	let benchCargadoId = $state<number | null>(null);

	async function traerSerieBenchmark(a: { id: number; ticker: string; tipo: string }) {
		benchCargando = true;
		benchError = '';
		try {
			const datos = (await descargarHistoricoData912(a.ticker, a.tipo)).slice().sort((x, y) => x.fecha.localeCompare(y.fecha));
			if (Number(benchActivoId) !== a.id) return; // cambiaron de activo mientras bajaba
			cacheBench.set(a.id, datos);
			benchSerieCruda = datos;
			benchCargadoId = a.id;
		} catch {
			if (Number(benchActivoId) !== a.id) return;
			benchError = 'No se pudo traer la serie de precios. Revisá la conexión y probá de nuevo.';
		} finally {
			if (Number(benchActivoId) === a.id) benchCargando = false;
		}
	}
	$effect(() => {
		const id = benchActivoId ? Number(benchActivoId) : null;
		if (id == null) { benchSerieCruda = []; benchCargadoId = null; benchError = ''; return; }
		if (id === benchCargadoId) return;
		const a = catalogo.find((c) => c.id === id);
		if (!a) return; // catálogo todavía no cargó; el effect vuelve a correr cuando cargue
		const cacheada = cacheBench.get(id);
		if (cacheada) { benchSerieCruda = cacheada; benchCargadoId = id; benchError = ''; return; }
		traerSerieBenchmark(a);
	});
	function reintentarBenchmark() {
		const id = benchActivoId ? Number(benchActivoId) : null;
		const a = id != null ? catalogo.find((c) => c.id === id) : null;
		if (a) { cacheBench.delete(a.id); benchCargadoId = null; traerSerieBenchmark(a); }
	}

	// Precio del benchmark en una fecha dada, sobre la serie ya bajada: exacto si
	// coincide, si no el último anterior conocido (arrastre) — nunca hacia
	// adelante. Misma cadena de respaldo que resolverPrecioEnFecha, pero resuelta
	// en memoria en vez de contra precio_historico.
	function resolverEnSerie(serie: PuntoBench[], fecha: string): number | null {
		let precio: number | null = null;
		for (const p of serie) {
			if (p.fecha > fecha) break;
			precio = p.precio;
		}
		return precio;
	}
	// Rebase a 100 en la primera fecha de la ventana donde el benchmark SÍ tiene
	// precio resuelto. Normalmente coincide con baseSnap.fecha; si el activo tiene
	// historia más corta que la ventana, arranca más tarde — la línea queda
	// cortada donde empiezan sus datos reales, no se inventa ni se arrastra nada.
	let benchIdxSerie = $derived.by(() => {
		if (!benchActivoId || !benchSerieCruda.length) return [];
		const resueltos = vsnaps.map((s, i) => ({ i, precio: resolverEnSerie(benchSerieCruda, s.fecha) }));
		const baseI = resueltos.findIndex((r) => r.precio != null);
		if (baseI === -1) return [];
		const basePrecio = resueltos[baseI].precio as number;
		return resueltos
			.slice(baseI)
			.filter((r) => r.precio != null)
			.map((r) => ({ i: r.i, cidx: ((r.precio as number) / basePrecio) * 100 }));
	});
	let benchNombre = $derived(catalogo.find((a) => String(a.id) === String(benchActivoId))?.ticker ?? '');
	// La serie ya terminó de bajar (mismo activo pedido = cargado, sin error) pero
	// ninguna fecha de la ventana resolvió precio — activo sin serie publicada, o
	// con serie más nueva que toda la ventana elegida.
	let benchSinDatos = $derived(
		!!benchActivoId && benchCargadoId === Number(benchActivoId) && !benchCargando && !benchError && benchIdxSerie.length === 0
	);

	// Selección por tap/drag sobre el gráfico: mientras se mantiene el toque, las
	// tarjetas muestran el valor del punto tocado; al soltar, vuelven al último
	// valor del período. `tocando` distingue "presionado" de "índice ya resuelto"
	// para que pointermove solo reaccione mientras el dedo/mouse está abajo.
	let tocando = $state(false);
	let puntoTacto = $state<number | null>(null);
	let snapTacto = $derived(puntoTacto != null ? vsnaps[puntoTacto] : null);
	let valorMostrado = $derived(snapTacto ? snapTacto.valor_usd : actual?.valor_usd ?? 0);
	let twrMostrado = $derived(snapTacto ? snapTacto.cidx / 100 - 1 : twrVentana);
	let aportesMostrado = $derived(
		snapTacto && puntoTacto != null ? vsnaps.slice(1, puntoTacto + 1).reduce((s, x) => s + x.flujo_usd, 0) : flujoVentana
	);

	// Retorno del benchmark en el MISMO punto que se está mostrando (tocado, o
	// cierre de ventana si no hay toque). null si ese punto cae antes de que el
	// benchmark tenga dato (arrancó más tarde) — ahí no hay con qué comparar.
	let benchRetMostrado = $derived.by(() => {
		if (!benchActivoId || !benchIdxSerie.length) return null;
		if (puntoTacto != null) {
			const m = benchIdxSerie.find((b) => b.i === puntoTacto);
			return m ? m.cidx / 100 - 1 : null;
		}
		return benchIdxSerie[benchIdxSerie.length - 1].cidx / 100 - 1;
	});
	// Semáforo del TWR: sin benchmark, verde si el período dio positivo (como
	// siempre). Con benchmark elegido, el verde pasa a significar "le ganó al
	// benchmark en este mismo punto" — empate no es verde. Si el punto tocado
	// queda antes del arranque del benchmark, no hay con qué comparar: neutro.
	let claseTwr = $derived.by(() => {
		if (benchActivoId && benchIdxSerie.length) {
			if (benchRetMostrado == null) return 'warn';
			return twrMostrado > benchRetMostrado ? 'pos' : 'neg';
		}
		return twrMostrado >= 0 ? 'pos' : 'neg';
	});

	function indiceMasCercano(xViewBox: number): number | null {
		if (!chart) return null;
		let best = 0, bestD = Infinity;
		chart.ptsValor.forEach((p, i) => { const d = Math.abs(p.x - xViewBox); if (d < bestD) { bestD = d; best = i; } });
		return best;
	}
	function actualizarTacto(e: PointerEvent) {
		const svg = e.currentTarget as SVGSVGElement;
		const rect = svg.getBoundingClientRect();
		const x = ((e.clientX - rect.left) / rect.width) * W;
		puntoTacto = indiceMasCercano(x);
	}
	function iniciarTacto(e: PointerEvent) {
		tocando = true;
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		actualizarTacto(e);
	}
	function moverTacto(e: PointerEvent) {
		if (!tocando) return;
		actualizarTacto(e);
	}
	function soltarTacto() {
		tocando = false;
		puntoTacto = null;
	}

	// Gráfico de doble eje: Valor de cartera USD (eje izq.) + TWR base 100 (eje der.).
	// Escalas independientes — un cruce visual entre las curvas no significa nada.
	const W = 720, H = 300, P = { l: 52, r: 56, t: 16, b: 28 };
	let chart = $derived.by(() => {
		if (vsnaps.length < 2) return null;
		const n = vsnaps.length;
		const xs = vsnaps.map((s) => new Date(s.fecha).getTime());
		const minX = xs[0], maxX = xs[xs.length - 1];
		const px = (x: number) => P.l + ((x - minX) / (maxX - minX || 1)) * (W - P.l - P.r);

		const vVal = vsnaps.map((s) => s.valor_usd);
		let minL = Math.min(...vVal), maxL = Math.max(...vVal);
		const padL = (maxL - minL) * 0.1 || 1; minL -= padL; maxL += padL;
		minL = Math.max(0, minL); // el valor de cartera nunca es negativo: el eje no baja de 0
		// Números lindos: se redondea el rango YA CON el margen de arriba/abajo hacia
		// afuera (floor/ceil), nunca hacia adentro — así el margen nunca se achica.
		const pasoL = pasoLindo(maxL - minL);
		minL = Math.max(0, Math.floor(minL / pasoL) * pasoL);
		maxL = Math.ceil(maxL / pasoL) * pasoL;
		const pyL = (y: number) => H - P.b - ((y - minL) / (maxL - minL || 1)) * (H - P.t - P.b);

		const vTwr = vsnaps.map((s) => s.cidx);
		// Eje derecho: mismo eje para TWR y benchmark (no se agrega un tercer eje).
		// Sin benchmark, el dominio sale solo de vTwr — igual que siempre. Con
		// benchmark, se autoescala incluyendo también su serie para que no quede
		// cortada visualmente.
		//
		// El 0% (índice 100, "ni gané ni perdí") SIEMPRE tiene que verse, marcado
		// con su propia etiqueta — pero no siempre como piso: si todos los valores
		// son positivos, el cero es el piso exacto (sin margen debajo, igual que ya
		// hace el eje izquierdo con el 0 real). Si hay algún valor negativo, el piso
		// pasa a ser el mínimo real de la serie con su margen normal, y el cero
		// puede quedar más arriba en el gráfico — no se lo fuerza a ser el techo,
		// solo se garantiza que entre en el rango (con margen arriba también) para
		// que quede destacado y no pegado al borde.
		const benchVals = benchIdxSerie.map((b) => b.cidx);
		const combinadoR = benchActivoId && benchVals.length ? [...vTwr, ...benchVals] : vTwr;
		const minRaw = Math.min(...combinadoR), maxRaw = Math.max(...combinadoR);
		let minR = minRaw, maxR = maxRaw;
		if (maxR < 100) maxR = 100; // todos negativos: el cero entra en el cálculo del margen de arriba
		const padR = (maxR - minR) * 0.1 || 1;
		if (minRaw >= 100) minR = 100; // todos positivos: piso exacto en el cero, sin margen debajo
		else minR -= padR;
		maxR += padR;
		// Números lindos, redondeando en el dominio "puntos porcentuales" (valor-100):
		// al redondear ANCLADO en 0 (floor/ceil de algo que ya pasa por 0), el 0%
		// siempre cae justo en un escalón de la grilla — no hace falta forzarlo aparte.
		// Si el piso ya estaba fijado exacto en 100 (todos positivos), floor(0/paso)
		// da 0 siempre: ese piso exacto no se mueve.
		const pasoR = pasoLindo(maxR - minR);
		minR = Math.floor((minR - 100) / pasoR) * pasoR + 100;
		maxR = Math.ceil((maxR - 100) / pasoR) * pasoR + 100;
		const pyR = (y: number) => H - P.b - ((y - minR) / (maxR - minR || 1)) * (H - P.t - P.b);
		const yCero = pyR(100);

		const ptsValor = vsnaps.map((s, i) => ({ x: px(xs[i]), y: pyL(s.valor_usd) }));
		const ptsTwr = vsnaps.map((s, i) => ({ x: px(xs[i]), y: pyR(s.cidx) }));
		const ptsBench = benchIdxSerie.map((b) => ({ x: px(xs[b.i]), y: pyR(b.cidx) }));
		const lineaValor = ptsValor.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
		const lineaTwr = ptsTwr.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
		const lineaBench = ptsBench.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
		const areaValor = lineaValor + ` L${ptsValor[n - 1].x.toFixed(1)},${H - P.b} L${ptsValor[0].x.toFixed(1)},${H - P.b} Z`;

		const yticksL: { y: number; label: string }[] = [];
		for (let v = minL; v <= maxL + pasoL * 1e-9; v += pasoL) yticksL.push({ y: pyL(v), label: fmtEjeUsd(v) });
		// Grilla pareja en escalón redondo, salvo el 0% exacto: ese ya tiene su
		// propia etiqueta destacada (yCero) y mostrarlo dos veces es ruido.
		const yticksR: { y: number; label: string }[] = [];
		for (let v = minR; v <= maxR + pasoR * 1e-9; v += pasoR) if (Math.abs(v - 100) > 1e-6) yticksR.push({ y: pyR(v), label: fmtEjePct(v) });
		const step = Math.max(1, Math.floor(n / 6));
		const xticks = vsnaps.filter((_, i) => i % step === 0).map((s) => ({ x: px(new Date(s.fecha).getTime()), label: mesCorto(s.fecha) }));
		return { lineaValor, lineaTwr, lineaBench, areaValor, ptsValor, ptsTwr, ptsBench, yticksL, yticksR, yCero, xticks };
	});

	// Reveal de izquierda a derecha al montar y en cada cambio de período.
	let sigChart = $derived(chart ? chart.ptsValor.map((p) => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ') : '');
	const { p: pArea, replay: replayArea } = progresoReplay();
	$effect(() => { sigChart; replayArea(); });

	// Ganancia realizada agrupada por año, con detalle mensual desplegable in-place
	// (mismo patrón tap-expande que usa Categorías con sus subcategorías).
	let realizadoPorAnio = $derived.by(() => {
		const porAnio = new Map<string, { total: number; meses: { mes: string; valor: number }[] }>();
		for (const r of realizadoMes) {
			const anio = r.mes.slice(0, 4);
			let a = porAnio.get(anio);
			if (!a) { a = { total: 0, meses: [] }; porAnio.set(anio, a); }
			a.total += r.valor;
			a.meses.push(r);
		}
		return [...porAnio.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([anio, d]) => ({ anio, total: d.total, meses: d.meses }));
	});
	let anioExpandido = $state<string | null>(null);
</script>

<div class="titulo-guia">
	<h1>Evolución de cartera</h1>
	<Guia
		clave="evolucion"
		para="Ver la historia de tu cartera y cuánto rindió tu estrategia."
		uso="Elegí el período arriba y mantené el dedo sobre el gráfico para leer una foto puntual. Las fotos se sacan solas cada vez que se actualizan los precios: no hace falta ninguna acción manual."
	/>
</div>

<h2>Valor y rendimiento (TWR)</h2>

{#if cargando}
	<div class="resumen">
		<div class="card sk-card"><Skeleton w="68%" h="0.62rem" /><Skeleton w="80%" h="1.1rem" /></div>
		<div class="card sk-card"><Skeleton w="68%" h="0.62rem" /><Skeleton w="80%" h="1.1rem" /></div>
		<div class="card sk-card"><Skeleton w="68%" h="0.62rem" /><Skeleton w="80%" h="1.1rem" /></div>
	</div>
	<div class="sk-chart"><Skeleton w="100%" h="clamp(150px, 42vw, 300px)" /></div>
{:else if snaps.length < 2}
	<p>Necesitás al menos 2 fotos para ver evolución.</p>
{:else}
	<div class="resumen">
		<div class="card destacado"><span>Cartera total{snapTacto ? ` · ${fmtFecha(snapTacto.fecha)}` : ''}</span><strong><CountUp value={valorMostrado} format={usd} /></strong></div>
		<div class="card"><span>Aportes netos{snapTacto ? ` · hasta ${fmtFecha(snapTacto.fecha)}` : ' (período)'}</span><strong><CountUp value={aportesMostrado} format={usd} /></strong></div>
		<div class="card big destacado"><span>TWR{snapTacto ? ` · ${fmtFecha(snapTacto.fecha)}` : ' del período'}</span><strong class={claseTwr}><CountUp value={twrMostrado} format={pct} /></strong></div>
	</div>

	<div class="bench-picker">
		<label for="bench-combo">Comparar contra:</label>
		<div class="bench-row">
			<ComboActivo activos={catalogo} bind:value={benchActivoId} id="bench-combo" placeholder="Buscar activo…" onselect={elegirBenchmark} />
			{#if benchActivoId}
				<button type="button" class="bench-quitar" onclick={quitarBenchmark} aria-label="Quitar benchmark">✕</button>
			{/if}
		</div>
		{#if benchCargando}
			<p class="nota bench-aviso">Trayendo cotizaciones de {benchNombre || 'este activo'}…</p>
		{:else if benchError}
			<p class="nota bench-aviso bench-error">
				{benchError}
				<button type="button" class="bench-reintentar" onclick={reintentarBenchmark}>Reintentar</button>
			</p>
		{:else if benchSinDatos}
			<p class="nota bench-aviso">{benchNombre || 'Este activo'} no tiene serie histórica publicada para el rango elegido.</p>
		{/if}
	</div>

	<div class="periodos">
		{#each periodos as [k, lbl]}
			<button class:activo={periodo === k} onclick={() => (periodo = k as any)}>{lbl}</button>
		{/each}
	</div>

	{#if chart}
		<div class="leyenda">
			<span class="leg"><span class="sw sw-valor"></span> Valor de cartera (USD, eje izq.)</span>
			<span class="leg"><span class="sw sw-twr"></span> TWR (%, eje der.)</span>
			{#if benchActivoId && chart.ptsBench.length}
				<span class="leg"><span class="sw sw-bench"></span> {benchNombre} (%, eje der.)</span>
			{/if}
		</div>
		<svg viewBox="0 0 {W} {H}" class="chart tacto"
			role="img" aria-label="Valor de cartera y rendimiento TWR en el tiempo"
			onpointerdown={iniciarTacto} onpointermove={moverTacto} onpointerup={soltarTacto} onpointercancel={soltarTacto}>
			<defs><clipPath id="reveal-cartera"><rect x="0" y="0" width={W * $pArea} height={H} /></clipPath></defs>
			{#each chart.yticksL as t}<line x1={P.l} y1={t.y} x2={W - P.r} y2={t.y} class="grid" /><text x={P.l - 6} y={t.y + 3} class="ylbl">{t.label}</text>{/each}
			{#each chart.yticksR as t}<text x={W - P.r + 6} y={t.y + 3} class="ylbl-r">{t.label}</text>{/each}
			<line x1={P.l} y1={chart.yCero} x2={W - P.r} y2={chart.yCero} class="grid-cero" />
			<text x={W - P.r + 6} y={chart.yCero + 3} class="ylbl-r ylbl-r-cero">0%</text>
			{#each chart.xticks as t}<text x={t.x} y={H - 8} class="xlbl">{t.label}</text>{/each}
			<g clip-path="url(#reveal-cartera)">
				<path d={chart.areaValor} class="area" />
				<path d={chart.lineaValor} class="line" />
				<path d={chart.lineaTwr} class="line-twr" />
				{#if benchActivoId && chart.ptsBench.length}
					<path d={chart.lineaBench} class="line-bench" />
				{/if}
				{#each chart.ptsValor as p}<circle cx={p.x} cy={p.y} r="2.5" class="dot" />{/each}
				{#each chart.ptsTwr as p}<circle cx={p.x} cy={p.y} r="2" class="dot-twr" />{/each}
			</g>
			{#if puntoTacto != null}
				<line x1={chart.ptsValor[puntoTacto].x} y1={P.t} x2={chart.ptsValor[puntoTacto].x} y2={H - P.b} class="guia-tacto" />
				<circle cx={chart.ptsValor[puntoTacto].x} cy={chart.ptsValor[puntoTacto].y} r="5" class="dot-tacto" />
				<circle cx={chart.ptsTwr[puntoTacto].x} cy={chart.ptsTwr[puntoTacto].y} r="4.5" class="dot-tacto-twr" />
			{/if}
		</svg>
		<NotaVisual objetivo="Cuánto vale tu cartera y cuánto rindió" glosario="tenencia" glosarioTexto="Qué es el TWR">
			{#snippet muestra()}Dos series sobre el mismo eje de tiempo: el <strong>valor de cartera</strong> en cada foto y el <strong>TWR</strong> acumulado desde el inicio de la ventana.{/snippet}
			{#snippet leer()}El valor sube y baja también cuando metés o sacás plata; el TWR no —descuenta ese efecto— así que mide el rendimiento de tus decisiones y no el tamaño de la cartera. Si el valor crece y el TWR está plano, creciste por aporte, no por rendimiento.{/snippet}
			{#snippet usar()}Separar cuánto de tu crecimiento vino de ahorrar y cuánto de invertir bien.{/snippet}
		</NotaVisual>
	{:else}
		<p class="nota">Sin datos suficientes en este rango.</p>
	{/if}

	<h2>Ganancia realizada por año (USD)</h2>
	{#if realizadoPorAnio.length}
		<div class="real-lista">
			{#each realizadoPorAnio as a (a.anio)}
				<button type="button" class="real-row real-click" class:abierto={anioExpandido === a.anio}
						aria-expanded={anioExpandido === a.anio}
						onclick={() => (anioExpandido = anioExpandido === a.anio ? null : a.anio)}>
					<span class="real-lbl"><span class="real-caret">{anioExpandido === a.anio ? '▾' : '▸'}</span>{a.anio}</span>
					<span class="real-valor {a.total >= 0 ? 'pos' : 'neg'}">{usd(a.total, 2)}</span>
				</button>
				{#if anioExpandido === a.anio}
					<div class="real-desglose">
						{#each a.meses as r (r.mes)}
							<div class="real-row sub">
								<span class="real-lbl">{r.mes}</span>
								<span class="real-valor {r.valor >= 0 ? 'pos' : 'neg'}">{usd(r.valor, 2)}</span>
							</div>
						{/each}
					</div>
				{/if}
			{/each}
		</div>
	{:else}
		<p class="nota">Todavía no hay ventas registradas.</p>
	{/if}

	<NotaVisual objetivo="Resultado que cerraste cada año" glosario="tenencia" glosarioTexto="Cómo funciona el FIFO">
		{#snippet muestra()}La ganancia o pérdida que quedó fija al vender, año por año, en dólares.{/snippet}
		{#snippet leer()}Solo cuenta lo vendido, calculado por <strong>FIFO</strong> (cada venta consume primero los lotes más viejos). Lo que todavía tenés en cartera no aparece acá: esa es ganancia en papel y ya está dentro del valor de cartera de arriba.{/snippet}
		{#snippet usar()}Ver qué años cerraste en ganancia de verdad, sin que lo tape la valorización de lo que no vendiste.{/snippet}
	</NotaVisual>
{/if}

<style>
:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	h2 { font-size: 1.02rem; margin-top: 26px; border-left: 3px solid var(--accent); padding-left: 12px; }
	.periodos { display: flex; gap: 6px; margin: 12px 0 4px; }
	.periodos button { flex: 1; text-align: center; padding-left: 4px; padding-right: 4px; }
	.bench-picker { margin: 14px 0 0; }
	.bench-picker label { display: block; font-size: 0.78rem; color: var(--text-dim); margin-bottom: 4px; }
	.bench-row { display: flex; align-items: center; gap: 6px; }
	.bench-row :global(.combo) { flex: 1; min-width: 0; }
	.bench-quitar {
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--surface);
		color: var(--text-dim);
		cursor: pointer;
		font-size: 0.9rem;
		line-height: 1;
	}
	.bench-quitar:hover { color: var(--text); border-color: var(--text-dim); }
	.bench-aviso { margin: 6px 0 0; }
	.bench-error { color: var(--warn); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
	.bench-reintentar {
		border: 1px solid var(--warn);
		color: var(--warn);
		background: none;
		border-radius: 6px;
		padding: 2px 10px;
		font-size: 0.78rem;
		cursor: pointer;
	}
	.warn { color: var(--warn); }
	.sk-chart { margin-top: 12px; }
	.leyenda { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; font-size: 0.8rem; color: var(--text-dim); margin: 6px 0; }
	.leg { display: inline-flex; align-items: center; gap: 5px; }

	.sw { width: 16px; height: 3px; border-radius: 2px; display: inline-block; flex-shrink: 0; }
	.sw-valor { background: var(--accent); }
	.sw-twr { background: #e8975b; }
	.sw-bench { background: #3ecf8e; }
	.chart { width: 100%; height: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
	.chart.tacto { touch-action: none; cursor: crosshair; }
	.grid { stroke: var(--border); stroke-width: 1; }
	.grid-cero { stroke: var(--text-dim); stroke-width: 1; stroke-dasharray: 2 2; opacity: 0.7; }
	.ylbl { font-size: 12px; fill: var(--text-dim); text-anchor: end; }
	.ylbl-r { font-size: 12px; fill: var(--text-dim); text-anchor: start; }
	.ylbl-r-cero { fill: var(--text); font-weight: 700; }
	.xlbl { font-size: 10px; fill: var(--text-dim); text-anchor: middle; }
	.area { fill: rgba(91, 157, 255, 0.10); stroke: none; }
	.line { fill: none; stroke: var(--accent); stroke-width: 2; }
	.line-twr { fill: none; stroke: #e8975b; stroke-width: 2; stroke-dasharray: 5 3; }
	.line-bench { fill: none; stroke: #3ecf8e; stroke-width: 2; stroke-dasharray: 1.5 3; }
	.dot { fill: var(--accent); }
	.dot-twr { fill: #e8975b; }
	.guia-tacto { stroke: var(--text-dim); stroke-width: 1; stroke-dasharray: 3 2; pointer-events: none; }
	.dot-tacto { fill: var(--accent); stroke: var(--surface); stroke-width: 2; pointer-events: none; }
	.dot-tacto-twr { fill: #e8975b; stroke: var(--surface); stroke-width: 2; pointer-events: none; }
	.real-lista { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
	.real-row { display: flex; justify-content: space-between; align-items: center; padding: 7px 4px; }
	.real-click { background: none; border: none; width: 100%; text-align: left; cursor: pointer; font: inherit; color: inherit; border-radius: 6px; }
	.real-click:hover .real-lbl { color: var(--accent); }
	.real-caret { color: var(--text-dim); font-size: 0.7rem; margin-right: 6px; display: inline-block; width: 10px; }
	.real-lbl { font-size: 0.88rem; font-weight: 600; }
	.real-valor { font-size: 0.88rem; font-weight: 600; }
	.real-desglose { padding-left: 16px; border-left: 2px solid var(--border); margin: -2px 0 4px; display: flex; flex-direction: column; }
	.real-row.sub .real-lbl { font-weight: 400; color: var(--text-dim); font-size: 0.82rem; }
	.real-row.sub .real-valor { font-weight: 400; font-size: 0.82rem; }
	.nota { font-size: 0.8rem; color: var(--text-dim); margin-top: 12px; }
</style>
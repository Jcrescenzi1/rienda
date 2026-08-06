<script lang="ts">
	// Gráfico de precio de un activo, con ejes, grilla, media móvil, volumen y
	// lectura por tacto. Reemplaza al mini-gráfico que se desplegaba dentro de cada
	// ficha de Mercado: ahora es uno solo, fijo arriba de la pantalla, que cambia
	// de activo desde su propio selector.
	//
	// De dónde salen los datos, en orden:
	//   1) data912, bajado EN MEMORIA — no se guarda en `precio_historico`. Mirar
	//      el gráfico de un activo del catálogo no tiene por qué dejar cientos de
	//      filas permanentes en la base ni en el backup.
	//   2) Si el tipo no tiene endpoint histórico en data912 (ON y FCI no lo
	//      tienen), se cae a la serie local de `precio_historico`. Para las ONs y
	//      FCI que el usuario SÍ opera hay serie igual: el refresco de precios
	//      loguea su cierre día a día (ver actualizarPrecios). Esa serie local no
	//      tiene volumen: la tabla guarda precio, nada más.
	//   3) Si no hay ninguna de las dos, se avisa que la fuente no publica
	//      histórico para ese tipo de instrumento — que no es lo mismo que un error.
	//
	// El patrón de tacto (Pointer Events + setPointerCapture + guía vertical) es el
	// mismo que ya usan los gráficos de Evolución de Gastos e Ingresos.

	import { goto } from '$app/navigation';
	import { query } from '$lib/db/client';
	import { descargarSerieData912, tieneHistoricoData912, type PuntoHistorico } from '$lib/db/precios_historicos';
	import { especieDeTicker } from '$lib/db/precios';
	import { unidades } from '$lib/format';
	import ComboActivo from '$lib/ComboActivo.svelte';
	import NotaVisual from '$lib/NotaVisual.svelte';

	let {
		activos = [],
		value = $bindable(''),
		especieDe = undefined,
		// false en la propia vista expandida (/mercado/grafico/[id]), para no
		// mostrar un botón que reapunte a la misma pantalla en la que ya está.
		expandible = true
	}: { activos?: any[]; value?: string; especieDe?: (a: any) => string; expandible?: boolean } = $props();

	const activo = $derived(activos.find((a) => String(a.id) === String(value)) ?? null);
	const mon = $derived(activo?.moneda ?? 'ARS');

	// Ruedas de la media móvil. 200 es el estándar de referencia de tendencia de
	// largo plazo; hacen falta ~10 meses de cotizaciones para que exista.
	const RUEDAS_MEDIA = 200;
	// Espera antes de disparar la descarga al cambiar de activo. Sin esto, pasar
	// rápido por varias fichas del listado largaría un pedido por cada una.
	const ESPERA_MS = 250;

	let serie = $state<PuntoHistorico[]>([]);
	let cargando = $state(false);
	let mensaje = $state('');
	// Naturaleza del mensaje, para ofrecer la salida que corresponde en cada caso:
	// 'conexion' es lo único que tiene sentido reintentar (falló la red, los datos
	// podrían estar la próxima). 'especie' y 'vacio' son respuestas firmes de la
	// fuente: reintentar da exactamente lo mismo.
	let tipoMensaje = $state<'' | 'conexion' | 'especie' | 'vacio'>('');
	// Activo al que conviene saltar cuando el elegido es especie dólar y el
	// histórico solo existe para el símbolo en pesos. Null si ese símbolo base no
	// está en el catálogo (por ejemplo, si todavía no se sincronizó).
	let sugerido = $state<{ id: number; ticker: string } | null>(null);
	let verMedia = $state(true);
	// Id del activo cuya serie está efectivamente dibujada.
	let cargadoId = $state<number | null>(null);

	// Resultado ya resuelto para cada activo en esta visita a la pantalla. Volver a
	// uno que ya se miró no vuelve a pegarle a la API. Se guarda el desenlace
	// COMPLETO, no solo la serie: un "no hay datos" también es una respuesta firme
	// de la fuente y no hay por qué volver a preguntarla. Se pierde al salir de la
	// pantalla: es cache de sesión, no persistencia (la serie sigue sin guardarse
	// en la base).
	type Resuelto = {
		datos: PuntoHistorico[];
		mensaje: string;
		tipo: '' | 'conexion' | 'especie' | 'vacio';
		sugerido: { id: number; ticker: string } | null;
	};
	const cache = new Map<number, Resuelto>();
	// Contador de pedidos: si el usuario cambia de activo mientras una descarga
	// está en vuelo, la respuesta vieja llega después y no debe pisar a la nueva.
	let pedido = 0;

	// '1s' (1 semana): data912 da un cierre por rueda, sin intradía — en esa
	// ventana la curva va a tener ~5 puntos (los días hábiles de la semana), no
	// una serie continua. Es una limitación de la fuente, no un bug del gráfico.
	const VENTANAS: [string, string][] = [['1s', '1S'], ['1m', '1M'], ['3m', '3M'], ['6m', '6M'], ['1a', '1A'], ['total', 'Todo']];
	const DIAS_VENTANA: Record<string, number | null> = { '1s': 7, '1m': 30, '3m': 91, '6m': 182, '1a': 365, total: null };
	const LABEL_VENTANA: Record<string, string> = { '1s': '1 semana', '1m': '1 mes', '3m': '3 meses', '6m': '6 meses', '1a': '1 año', total: 'todo el período' };
	let ventanaActiva = $state('6m');

	async function traerSerie(a: any, mio: number) {
		cargando = true;
		mensaje = '';
		tipoMensaje = '';
		sugerido = null;
		try {
			let datos: PuntoHistorico[] = [];
			// 1) Histórico de data912, en memoria. El ticker es el símbolo de
			//    cotización para todo lo que no sea FCI (misma regla que usa el alta).
			if (tieneHistoricoData912(a.tipo)) {
				datos = await descargarSerieData912(a.ticker, a.tipo);
			}
			// 2) Serie local acumulada (única fuente para ON y FCI operados, y red
			//    para símbolos que cotizan pero no están en el histórico de data912).
			if (datos.length === 0) {
				datos = (await query(
					'SELECT fecha, precio FROM precio_historico WHERE perfil_id=1 AND activo_id=? ORDER BY fecha',
					[a.id]
				)) as any[];
			}
			if (mio !== pedido) return; // llegó tarde: ya se está mirando otro activo
			serie = datos;
			cargadoId = a.id;
			if (datos.length === 0) {
				const especie = especieDeTicker(a.ticker, a.moneda);
				if (!tieneHistoricoData912(a.tipo)) {
					tipoMensaje = 'vacio';
					mensaje = `La fuente de precios no publica histórico para ${a.tipo === 'FCI' ? 'los FCI' : 'las ONs'}, y todavía no hay precios propios guardados de ${a.ticker}. No es un error: es un límite de la fuente.`;
				} else if (especie !== 'Pesos') {
					// El histórico de data912 lista tickers de la especie en pesos; las
					// especies dólar (D/C) no están. NO se dibuja la curva en pesos
					// haciéndola pasar por la de la especie dólar (son precios distintos:
					// mostrar una por la otra sería un dato falso). En cambio se ofrece
					// saltar al símbolo base, que es la acción que el usuario iba a hacer
					// igual — reintentar acá no cambiaría nada, la fuente ya contestó.
					const base = a.ticker.slice(0, -1).toUpperCase();
					const enCatalogo = activos.find((x) => String(x.ticker).toUpperCase() === base);
					sugerido = enCatalogo ? { id: enCatalogo.id, ticker: enCatalogo.ticker } : null;
					tipoMensaje = 'especie';
					mensaje = enCatalogo
						? `${a.ticker} es especie ${especie} y la fuente publica el histórico por la especie en pesos.`
						: `${a.ticker} es especie ${especie} y la fuente publica el histórico por la especie en pesos (${base}), que todavía no está en tu catálogo.`;
				} else {
					tipoMensaje = 'vacio';
					mensaje = `La fuente de precios no tiene serie histórica publicada para ${a.ticker}. No es un error: hay instrumentos que cotizan pero no están en el histórico.`;
				}
			} else if (datos.length < 2) {
				tipoMensaje = 'vacio';
				mensaje = 'Hay un solo precio guardado: hacen falta al menos dos para dibujar una evolución.';
			}
		} catch (e) {
			if (mio !== pedido) return;
			console.error('[grafico-precio] no se pudo obtener la serie:', e);
			tipoMensaje = 'conexion';
			mensaje = 'No se pudo obtener la serie de precios. Revisá la conexión y probá de nuevo.';
		} finally {
			if (mio === pedido) {
				cargando = false;
				// Un fallo de red NO se cachea: es transitorio, y volver al activo
				// tiene que poder intentarlo de nuevo. Todo lo demás sí.
				if (tipoMensaje !== 'conexion') {
					cache.set(a.id, { datos: serie, mensaje, tipo: tipoMensaje, sugerido });
				}
			}
		}
	}

	// La serie se baja sola al elegir un activo. No hay botón "Presentar": como el
	// resultado no se persiste, el costo de mirar un activo es un pedido HTTP y
	// nada más — pedir un toque extra para eso no compraba nada. Lo que sí hace
	// falta es no disparar un pedido por cada ficha que se toca de paso: de eso se
	// ocupan la espera de ESPERA_MS y la cache.
	$effect(() => {
		const a = activo;
		const id = a?.id ?? null;
		if (id == null) { serie = []; mensaje = ''; tipoMensaje = ''; sugerido = null; cargadoId = null; return; }
		if (id === cargadoId) return;

		pedido++;
		const mio = pedido;
		serie = [];
		mensaje = '';
		tipoMensaje = '';
		sugerido = null;
		puntoTacto = null;

		const guardada = cache.get(id);
		if (guardada) {
			serie = guardada.datos;
			mensaje = guardada.mensaje;
			tipoMensaje = guardada.tipo;
			sugerido = guardada.sugerido;
			cargadoId = id;
			return;
		}

		const t = setTimeout(() => traerSerie(a, mio), ESPERA_MS);
		return () => clearTimeout(t);
	});

	function reintentar() {
		if (!activo) return;
		cache.delete(activo.id);
		cargadoId = null;
		pedido++;
		traerSerie(activo, pedido);
	}

	type PuntoCalc = PuntoHistorico & { media: number | null; sube: boolean | null; varDia: number | null };

	// Media móvil calculada sobre la serie COMPLETA, no sobre la ventana visible.
	// Es la diferencia que hace que funcione: una media de 200 ruedas mirando 1M
	// necesita los 200 días anteriores al primer día visible; si se calculara
	// dentro de la ventana no existiría nunca fuera de "Todo".
	const serieCalc = $derived.by((): PuntoCalc[] => {
		const s = serie;
		const out: PuntoCalc[] = new Array(s.length);
		let suma = 0;
		for (let i = 0; i < s.length; i++) {
			suma += s[i].precio;
			if (i >= RUEDAS_MEDIA) suma -= s[i - RUEDAS_MEDIA].precio;
			// Dirección de la rueda: cerró arriba o abajo del cierre anterior. OJO con
			// la lectura del gráfico: esto pinta la barra de volumen, pero NO describe
			// al volumen — describe al precio. Una barra roja más alta que la anterior
			// significa "se operó más monto que ayer y el papel cerró abajo", no una
			// contradicción. El volumen en sí nunca es negativo (es monto operado, y
			// toda operación tiene comprador y vendedor), así que el color es el único
			// lugar donde puede aparecer un signo. Se calcula sobre la serie completa
			// para que la primera barra de una ventana también tenga referencia: su
			// día anterior existe aunque no esté visible.
			const previo = i === 0 ? null : s[i - 1].precio;
			out[i] = {
				...s[i],
				media: i >= RUEDAS_MEDIA - 1 ? suma / RUEDAS_MEDIA : null,
				sube: previo == null ? null : s[i].precio >= previo,
				varDia: previo ? s[i].precio / previo - 1 : null
			};
		}
		return out;
	});

	// Última cotización de la serie COMPLETA (no la de la ventana): es "el precio
	// de hoy", y se muestra siempre, con ventana chica o grande y con o sin tacto.
	const ultima = $derived(serie.length ? serie[serie.length - 1] : null);

	const hayMedia = $derived(serie.length >= RUEDAS_MEDIA);
	const hayVolumen = $derived(serie.some((p) => p.volumen != null && p.volumen > 0));

	const serieVentana = $derived.by(() => {
		const dias = DIAS_VENTANA[ventanaActiva];
		const s = serieCalc;
		if (dias == null || s.length === 0) return s;
		const ultimaFecha = s[s.length - 1].fecha;
		const [y, m, d] = ultimaFecha.split('-').map(Number);
		const corte = new Date(Date.UTC(y, m - 1, d) - dias * 86400000);
		const corteISO =
			corte.getUTCFullYear() + '-' +
			String(corte.getUTCMonth() + 1).padStart(2, '0') + '-' +
			String(corte.getUTCDate()).padStart(2, '0');
		return s.filter((p) => p.fecha >= corteISO);
	});

	// SVG propio, sin librerías, igual que el resto de los gráficos de la app.
	// El padding izquierdo deja lugar a las etiquetas del eje Y y el de abajo a
	// las fechas del eje X (el gráfico anterior no tenía ninguno de los dos).
	const W = 720, H = 320, P = { l: 58, r: 14, t: 14, b: 26 };
	// Cuando hay volumen, la banda de abajo se reserva para las barras y el precio
	// se dibuja en el 72% de arriba. Sin volumen, el precio usa todo el alto.
	const FRAC_PRECIO = 0.72, FRAC_VOL = 0.2;

	// Etiqueta compacta de precio para el eje: los precios van de centavos a
	// decenas de miles según el instrumento, así que la escala se elige por
	// magnitud en vez de forzar un formato único.
	//
	// `paso` es la distancia entre ticks consecutivos (rango visible / 3). En un
	// rango angosto relativo al valor absoluto (ej. entre 1.502.000 y 1.508.000),
	// la precisión fija de antes hacía que las 3 etiquetas redondearan al mismo
	// "1,5m". Acá la cantidad de decimales sube hasta que el paso deje de
	// colapsar a cero en esa escala, así los ticks se leen distintos entre sí.
	function fmtEjeY(v: number, paso: number): string {
		const a = Math.abs(v);
		const usaMil = a >= 1000;
		const escala = usaMil ? v / 1000 : v;
		const pasoEscala = Math.abs(usaMil ? paso / 1000 : paso);
		let decimales = usaMil ? 1 : a >= 1 ? 0 : 2;
		while (decimales < 4 && pasoEscala > 0 && Math.round(pasoEscala * 10 ** decimales) === 0) decimales++;
		return unidades(escala, decimales) + (usaMil ? 'm' : '');
	}
	function fmtEjeX(iso: string): string {
		const [y, m] = iso.split('-');
		return `${m}/${y.slice(2)}`;
	}
	// El volumen de data912 es NOCIONAL: monto operado, no cantidad de papeles.
	// Por eso se formatea con signo de moneda y en múltiplos (M / k).
	function fmtVol(v: number): string {
		const s = mon === 'USD' ? 'U$D ' : '$';
		const a = Math.abs(v);
		if (a >= 1e6) return s + unidades(v / 1e6, 1) + 'M';
		if (a >= 1e3) return s + unidades(v / 1e3, 1) + 'k';
		return s + unidades(v, 0);
	}

	const chart = $derived.by(() => {
		const s = serieVentana;
		if (s.length < 2) return null;
		const conVol = hayVolumen;
		const alto = H - P.t - P.b;
		const altoPrecio = conVol ? alto * FRAC_PRECIO : alto;
		const baseVol = H - P.b;
		const altoVol = alto * FRAC_VOL;

		const xs = s.map((p) => new Date(p.fecha + 'T00:00:00Z').getTime());
		const minX = xs[0], maxX = xs[xs.length - 1];
		const px = (x: number) => P.l + ((x - minX) / (maxX - minX || 1)) * (W - P.l - P.r);

		// La escala vertical incluye la media: si el precio se despegó fuerte, la
		// media puede quedar fuera del rango de precios de la ventana visible.
		const vals: number[] = [];
		for (const p of s) {
			vals.push(p.precio);
			if (verMedia && p.media != null) vals.push(p.media);
		}
		let minY = Math.min(...vals), maxY = Math.max(...vals);
		// Margen del 10% arriba y abajo. A diferencia del gráfico anterior, el piso
		// NO se fuerza a cero: en una serie de precios eso aplasta la curva contra
		// el techo y esconde justamente la variación que se quiere leer.
		const pad = (maxY - minY) * 0.1 || Math.max(maxY * 0.05, 1e-6);
		minY -= pad; maxY += pad;
		if (minY < 0) minY = 0;
		const py = (y: number) => P.t + altoPrecio - ((y - minY) / (maxY - minY || 1)) * altoPrecio;

		const pts = s.map((p, i) => ({ x: px(xs[i]), y: py(p.precio) }));
		const linea = pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
		const pieDelArea = (P.t + altoPrecio).toFixed(1);
		const area = linea + ` L${pts[pts.length - 1].x.toFixed(1)},${pieDelArea} L${pts[0].x.toFixed(1)},${pieDelArea} Z`;

		// La media se dibuja en tramos: si arranca a mitad de la ventana (porque
		// antes no había 200 ruedas), no se la une con una recta desde el borde.
		let media = '';
		if (verMedia) {
			let abierto = false;
			s.forEach((p, i) => {
				if (p.media == null) { abierto = false; return; }
				media += (abierto ? 'L' : 'M') + px(xs[i]).toFixed(1) + ',' + py(p.media).toFixed(1) + ' ';
				abierto = true;
			});
		}

		// Volumen: barras en la banda de abajo. La altura es RELATIVA al máximo de la
		// ventana visible, no a una escala fija — cambiar de ventana reescala las
		// barras. Por eso se rotula ese máximo (`volMax`): sin la referencia, la
		// altura sola no dice nada. El color viene de `sube`: verde si la rueda
		// cerró arriba de la anterior, rojo si cerró abajo.
		const anchoBarra = Math.max(1, (W - P.l - P.r) / s.length - 1);
		const maxVol = conVol ? Math.max(...s.map((p) => p.volumen ?? 0), 1) : 1;
		const barras = conVol
			? s.map((p, i) => {
					const h = ((p.volumen ?? 0) / maxVol) * altoVol;
					return { x: px(xs[i]) - anchoBarra / 2, y: baseVol - h, w: anchoBarra, h, sube: p.sube !== false };
				})
			: [];
		const volTicks = conVol
			? [
					{ y: baseVol - altoVol, label: fmtVol(maxVol) },
					{ y: baseVol, label: '0' }
				]
			: [];

		const pasoY = (maxY - minY) / 3;
		const yticks = Array.from({ length: 4 }, (_, k) => {
			const v = minY + pasoY * k;
			return { y: py(v), label: fmtEjeY(v, pasoY) };
		});
		const paso = Math.max(1, Math.floor(s.length / 6));
		const xticks = s
			.map((p, i) => ({ i, fecha: p.fecha }))
			.filter((_, i) => i % paso === 0)
			.map((o) => ({ x: px(xs[o.i]), label: fmtEjeX(o.fecha) }));

		const primero = s[0].precio, ultimoVentana = s[s.length - 1].precio;
		return {
			linea, area, media, pts, barras, volTicks, yticks, xticks, conVol,
			topeGuia: P.t, pieGuia: H - P.b, baseVol, topeVol: baseVol - altoVol,
			variacion: primero ? ultimoVentana / primero - 1 : 0
		};
	});

	// ===== Lectura por tacto (mismo patrón que evol/Gastos e Ingresos) =====
	let tocando = $state(false);
	let puntoTacto = $state<number | null>(null);
	const snapTacto = $derived(puntoTacto != null ? serieVentana[puntoTacto] ?? null : null);

	// Variación que se muestra al lado de la última cotización:
	//  - con un día tocado: cuánto se movió el papel DESDE ese día HASTA hoy;
	//  - sin tocar nada: cuánto se movió dentro de la ventana elegida.
	const variacionMostrada = $derived.by(() => {
		if (snapTacto && ultima && snapTacto.precio) return ultima.precio / snapTacto.precio - 1;
		return chart?.variacion ?? null;
	});
	const etiquetaVariacion = $derived(
		snapTacto ? 'desde el día marcado' : LABEL_VENTANA[ventanaActiva] ?? ''
	);

	function indiceMasCercano(xViewBox: number): number | null {
		if (!chart) return null;
		let best = 0, bestD = Infinity;
		chart.pts.forEach((p, i) => {
			const d = Math.abs(p.x - xViewBox);
			if (d < bestD) { bestD = d; best = i; }
		});
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
		if (tocando) actualizarTacto(e);
	}
	function soltarTacto() {
		tocando = false;
		puntoTacto = null;
	}

	const money = (n: number | null | undefined, mon: string) =>
		n == null ? '—' : (mon === 'USD' ? 'U$D ' : '$') + unidades(n, 2);

	function fmtFechaCorta(iso: string): string {
		const [y, m, d] = iso.split('-');
		return `${d}/${m}/${y.slice(2)}`;
	}
</script>

<div class="gp">
	<!-- El chip de especie arranca en "Pesos": es la única con serie histórica
	     publicada, así que el camino por defecto lleva a activos que sí grafican. -->
	<ComboActivo {activos} bind:value {especieDe} especieInicial="Pesos" placeholder="Buscar por ticker o nombre…" />

	{#if ultima}
		<!-- La última cotización queda siempre a la vista: es el dato de referencia
		     contra el que se lee todo lo demás, incluida la variación al marcar un día. -->
		<div class="gp-head">
			<span class="gp-lbl">Última cotización</span>
			<span class="gp-precio">{money(ultima.precio, mon)}</span>
			<span class="gp-fecha">{fmtFechaCorta(ultima.fecha)}</span>
			{#if variacionMostrada != null}
				<span class="gp-var" class:pos={variacionMostrada >= 0} class:neg={variacionMostrada < 0}>
					{variacionMostrada >= 0 ? '+' : ''}{(variacionMostrada * 100).toFixed(1)}%
				</span>
				<span class="gp-varlbl">{etiquetaVariacion}</span>
			{/if}
		</div>
		{#if snapTacto}
			<div class="gp-marcado">
				<span class="gp-lbl">Día marcado</span>
				<span class="gp-marcado-v">{fmtFechaCorta(snapTacto.fecha)} · {money(snapTacto.precio, mon)}</span>
				{#if snapTacto.varDia != null}
					<!-- Cierre del día contra el día anterior: es EXACTAMENTE el signo que
					     pinta la barra de volumen de esa rueda. Mostrarlo acá es lo que
					     vuelve legible por qué una barra más alta puede estar en rojo. -->
					<span class="gp-marcado-dia" class:pos={snapTacto.varDia >= 0} class:neg={snapTacto.varDia < 0}>
						{snapTacto.varDia >= 0 ? '+' : ''}{(snapTacto.varDia * 100).toFixed(1)}% en el día
					</span>
				{/if}
				{#if snapTacto.media != null}<span class="gp-marcado-x">media {money(snapTacto.media, mon)}</span>{/if}
				{#if snapTacto.volumen != null}<span class="gp-marcado-x">vol {fmtVol(snapTacto.volumen)}</span>{/if}
			</div>
		{/if}
	{/if}

	{#if chart}
		<svg
			viewBox="0 0 {W} {H}"
			class="gp-chart"
			role="img"
			aria-label="Evolución del precio de {activo?.ticker ?? 'el activo'}"
			onpointerdown={iniciarTacto}
			onpointermove={moverTacto}
			onpointerup={soltarTacto}
			onpointercancel={soltarTacto}
		>
			<defs>
				<linearGradient id="gpGrad" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color="var(--accent)" stop-opacity="0.28" />
					<stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02" />
				</linearGradient>
			</defs>
			{#each chart.yticks as t}
				<line x1={P.l} y1={t.y} x2={W - P.r} y2={t.y} class="gp-grid" />
				<text x={P.l - 6} y={t.y + 3} class="gp-ylbl">{t.label}</text>
			{/each}
			{#each chart.xticks as t}
				<text x={t.x} y={H - 8} class="gp-xlbl">{t.label}</text>
			{/each}
			{#if chart.conVol}
				<!-- Banda de volumen: línea de base en cero y rótulo del máximo de la
				     ventana, que es contra lo que se escalan las barras. -->
				<line x1={P.l} y1={chart.baseVol} x2={W - P.r} y2={chart.baseVol} class="gp-grid" />
				{#each chart.volTicks as t}
					<text x={P.l - 6} y={t.y + 3} class="gp-ylbl gp-vollbl">{t.label}</text>
				{/each}
				<text x={P.l + 2} y={chart.topeVol - 3} class="gp-vollbl gp-volcap">volumen operado · alto = monto, color = cierre</text>
			{/if}
			{#each chart.barras as b}
				<rect x={b.x} y={b.y} width={b.w} height={b.h} class="gp-vol" class:baja={!b.sube} />
			{/each}
			<path d={chart.area} fill="url(#gpGrad)" />
			<path d={chart.linea} class="gp-linea" />
			{#if chart.media}
				<path d={chart.media} class="gp-media" />
			{/if}
			{#if puntoTacto != null && chart.pts[puntoTacto]}
				<line x1={chart.pts[puntoTacto].x} y1={chart.topeGuia} x2={chart.pts[puntoTacto].x} y2={chart.pieGuia} class="gp-guia" />
				<circle cx={chart.pts[puntoTacto].x} cy={chart.pts[puntoTacto].y} r="5" class="gp-dot" />
			{/if}
		</svg>

		<div class="gp-ventanas">
			{#each VENTANAS as [k, lbl] (k)}
				<button type="button" class:activo={ventanaActiva === k} onclick={() => (ventanaActiva = k)}>{lbl}</button>
			{/each}
			<button type="button" class="gp-toggle" class:activo={verMedia} onclick={() => (verMedia = !verMedia)} disabled={!hayMedia}>
				Media {RUEDAS_MEDIA}
			</button>
			{#if expandible && activo}
				<!-- Ruta real de SvelteKit, no modal: así el botón/gesto atrás de Android
				     cierra esta vista (pop de historial) en vez de salir de la app. -->
				<button type="button" class="gp-expandir" aria-label="Expandir gráfico" title="Expandir" onclick={() => goto(`/mercado/grafico/${activo.id}`)}>⤢</button>
			{/if}
		</div>

		<NotaVisual objetivo="Cómo se movió el precio del activo" glosario="mercado">
			{#snippet muestra()}El cierre de cada rueda en la moneda de cotización del activo, su media móvil de {RUEDAS_MEDIA} ruedas punteada en ámbar, y el volumen operado como barras abajo.{/snippet}
			{#snippet leer()}La escala vertical no arranca en cero, para no aplastar la curva contra el techo. En las barras, el <strong>alto</strong> es el monto operado y el <strong>color</strong> es el precio —verde cerró arriba del día anterior, rojo abajo—, así que una barra más alta y roja es normal. La media se calcula sobre la serie completa: mirando 1M, cada punto sigue usando los {RUEDAS_MEDIA} días previos aunque no estén en pantalla.{/snippet}
			{#snippet usar()}Mantené el dedo sobre el gráfico para marcar un día y ver cuánto varió hasta hoy; y compará el precio contra su media para ubicar si está caro o barato respecto de su propia tendencia.{/snippet}
			{#snippet fuente()}Histórico público de data912, bajado en el momento y no guardado en la base. Para las ONs y los FCI, que la fuente no publica, se usan los cierres que la app fue registrando de tus propios activos.{#if !hayMedia} La media no se dibuja acá porque hacen falta al menos {RUEDAS_MEDIA} cotizaciones y esta serie tiene {serie.length}.{/if}{#if !chart.conVol} La fuente no publica volumen para esta serie.{/if}{/snippet}
		</NotaVisual>
	{:else}
		<div class="gp-hueco">
			{#if cargando}
				<p class="gp-nota">Buscando la serie de precios…</p>
			{:else if mensaje}
				<p class="gp-nota">
					{mensaje}
					<!-- La salida que se ofrece depende de por qué no hay datos: si la
					     fuente ya contestó que no tiene esa serie, reintentar es una
					     pared; lo útil es saltar al símbolo que sí la tiene. -->
					{#if tipoMensaje === 'especie' && sugerido}
						<button class="link" onclick={() => (value = String(sugerido!.id))}>Ver {sugerido.ticker} →</button>
					{:else if tipoMensaje === 'conexion'}
						<button class="link" onclick={reintentar}>Reintentar</button>
					{/if}
				</p>
			{:else if activo}
				<p class="gp-nota">Cargando la evolución de {activo.ticker}…</p>
			{:else}
				<p class="gp-nota">Elegí un activo para ver su evolución de precio.</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.gp { display: flex; flex-direction: column; gap: 6px; }

	.gp-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
	.gp-lbl { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim); }
	.gp-precio { font-weight: 700; font-size: 1.05rem; white-space: nowrap; }
	.gp-fecha { font-size: 0.76rem; color: var(--text-dim); }
	.gp-var { font-size: 0.86rem; font-weight: 700; white-space: nowrap; }
	.gp-var.pos { color: var(--pos); }
	.gp-var.neg { color: var(--neg); }
	.gp-varlbl { font-size: 0.72rem; color: var(--text-dim); }

	.gp-marcado { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; padding: 4px 8px; border-left: 2px solid var(--accent); background: rgba(91, 157, 255, 0.07); border-radius: 0 6px 6px 0; }
	.gp-marcado-v { font-size: 0.84rem; font-weight: 600; }
	.gp-marcado-x { font-size: 0.74rem; color: var(--text-dim); }
	.gp-marcado-dia { font-size: 0.76rem; font-weight: 600; }
	.gp-marcado-dia.pos { color: var(--pos); }
	.gp-marcado-dia.neg { color: var(--neg); }

	.gp-chart { width: 100%; height: auto; max-height: 42dvh; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); touch-action: none; cursor: crosshair; }
	/* Horizontal: no se fuerza la rotación del dispositivo, pero si ya está
	   apaisado se aprovecha alto en vez de ancho — con width:100% el gráfico
	   queda achatado (el aspect-ratio del viewBox da poca altura quedando el
	   ancho de pantalla entero). dvh en vez de vh: en Android la barra de
	   sistema achica el viewport dinámico, y vh fijo dejaría el gráfico
	   parcialmente tapado. max-width:100% es el techo por si el alto derivado
	   excede el ancho real de la pantalla.
	   OJO: `orientation: landscape` solo mira la forma del viewport, no si es
	   "un celular acostado" — una ventana de escritorio normal también matchea
	   (es más ancha que alta) y disparaba esto siempre, inflando el gráfico a
	   90dvh de alto en desktop aunque el layout de la app siga siendo la columna
	   angosta de mobile (max-width:820px del body). El tope de ancho evita eso:
	   apaisado real de celular ronda los ~900px, un monitor los supera. */
	@media (orientation: landscape) and (max-width: 900px) {
		.gp-chart { width: auto; height: 90dvh; max-width: 100%; max-height: none; }
	}
	.gp-grid { stroke: var(--border); stroke-width: 1; }
	.gp-ylbl { font-size: 10px; fill: var(--text-dim); text-anchor: end; }
	.gp-xlbl { font-size: 10px; fill: var(--text-dim); text-anchor: middle; }
	.gp-linea { fill: none; stroke: var(--accent); stroke-width: 2.2; }
	/* La media va punteada y en un tono apagado: es referencia de fondo, no debe
	   competir visualmente con la serie de precio. */
	.gp-media { fill: none; stroke: var(--warn, #fbbf24); stroke-width: 1.6; stroke-dasharray: 5 3; opacity: 0.85; }
	/* El volumen nunca es negativo (cuenta papeles operados): las barras solo
	   crecen hacia arriba. El color marca la dirección del cierre de esa rueda
	   respecto de la anterior, que es lo más parecido a un "signo" que tiene. */
	.gp-vol { fill: var(--pos); opacity: 0.4; }
	.gp-vol.baja { fill: var(--neg); }
	.gp-vollbl { font-size: 9px; fill: var(--text-dim); }
	.gp-volcap { text-anchor: start; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.75; }
	.gp-guia { stroke: var(--text-dim); stroke-width: 1; stroke-dasharray: 3 2; pointer-events: none; }
	.gp-dot { fill: var(--accent); stroke: var(--surface); stroke-width: 2; pointer-events: none; }

	.gp-hueco { display: flex; align-items: center; justify-content: center; min-height: 110px; padding: 12px; border: 1px dashed var(--border); border-radius: 8px; background: var(--surface); }
	.gp-nota { font-size: 0.8rem; color: var(--text-dim); margin: 0; line-height: 1.5; text-align: center; }



	.gp-ventanas { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
	.gp-ventanas button { font-size: 0.72rem; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface-2, var(--surface)); color: var(--text-dim); cursor: pointer; }
	.gp-ventanas button.activo { background: var(--accent); border-color: var(--accent); color: #fff; }
	.gp-ventanas button:disabled { opacity: 0.4; cursor: default; }
	.gp-toggle.activo { background: var(--warn, #fbbf24); border-color: var(--warn, #fbbf24); color: #111; }
	.gp-expandir { margin-left: auto; padding: 3px 8px !important; font-size: 0.9rem !important; line-height: 1; }
</style>

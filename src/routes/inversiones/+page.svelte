<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import { fmtFecha, fechaISO, pesos, fechaHoraCorta } from '$lib/format';
	import { calcularTenencia, calcularSerieTWR, rendimientoVentana } from '$lib/cartera';
	import { actualizarPreciosYFoto } from '$lib/db/precios';
	import Guia from '$lib/Guia.svelte';
	import NotaVisual from '$lib/NotaVisual.svelte';
	import Skeleton from '$lib/Skeleton.svelte';

	let cargando = $state(true);
	let cartera = $state<any[]>([]);
	let buckets = $state<any[]>([]);
	let exposicion = $state<{ tot: number; filas: any[] }>({ tot: 0, filas: [] });
	let detalleMix = $state<any[]>([]);
	let dolar = $state(1);
	let dolarFecha = $state<string | null>(null); // fecha de la cotización MEP usada

	// Rendimiento por ventana (Bloque 5): mismo TWR encadenado que Evolución de
	// cartera (calcularSerieTWR/rendimientoVentana en cartera.ts), rebasado a
	// mes/trimestre/año en vez de a toda la historia. null = todavía no hay al
	// menos 2 fotos en esa ventana ("sin datos suficientes", no un cero). Sin
	// ventana semanal: con fotos diarias, una semana sola es ruido.
	let rendMes = $state<number | null>(null);
	let rendTrimestre = $state<number | null>(null);
	let rendAnio = $state<number | null>(null);

	// Auto-actualización de precios
	let actualizandoPrecios = $state(false);
	let preciosMsg = $state('');
	let preciosMsgErr = $state(false);
	let preciosActualizadosEn = $state<string | null>(null);

	async function cargarTodo() {
		const t = await calcularTenencia();
		dolar = t.dolar;
		cartera = t.hold;
		buckets = t.buckets;
		exposicion = t.exposicion;

		// Fecha de esa cotización MEP (para mostrar a qué dólar y qué tan fresco se valúa).
		const df = (await query("SELECT fecha FROM cotizacion_dolar WHERE perfil_id=1 AND casa='bolsa' ORDER BY fecha DESC LIMIT 1")) as any[];
		dolarFecha = df[0]?.fecha ?? null;

		const mp = (await query("SELECT valor FROM meta WHERE clave='precios_actualizados_en'")) as any[];
		preciosActualizadosEn = mp[0]?.valor ?? null;

		// Rendimiento por ventana: mismo criterio de "mes/trimestre/año" que se usa
		// como fecha calendario (restar meses a hoy), no un conteo de fotos.
		const snapRows = (await query('SELECT fecha, valor_usd, flujo_usd FROM snapshot WHERE perfil_id=1 ORDER BY fecha')) as any[];
		const serie = calcularSerieTWR(snapRows);
		const cutoffMeses = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() - n); return fechaISO(d); };
		rendMes = rendimientoVentana(serie, cutoffMeses(1));
		rendTrimestre = rendimientoVentana(serie, cutoffMeses(3));
		rendAnio = rendimientoVentana(serie, cutoffMeses(12));

		// Detalle del mix: ranking de concentración (activos + líquido), ordenado por
		// % del total de mayor a menor. El desglose por renta ya lo muestra el
		// gráfico de barras de arriba; acá interesa ver de un vistazo cuáles son las
		// apuestas más grandes cruzando categorías.
		const liqRows = (['ARS', 'USD'] as const)
			.map((mon) => {
				const saldo = t.liqSaldos[mon] ?? 0;
				const valUSD = mon === 'USD' ? saldo : saldo / dolar;
				return { renta: 'Liquido', tipo: 'Caja', nombre: 'Líquido ' + mon, mercadoUSD: valUSD, exposicion: mon === 'USD' ? 'Dolar' : 'Peso' };
			})
			.filter((r) => r.mercadoUSD > 0);
		const filasMix = [
			...cartera.map((h) => ({ renta: h.renta, tipo: h.tipo, nombre: h.nombre, mercadoUSD: h.mercadoUSD, exposicion: h.exposicion })),
			...liqRows
		];
		filasMix.sort((a, b) => b.mercadoUSD - a.mercadoUSD);
		const UMBRAL_CONCENTRACION = 0.2; // 20% del total
		// La alerta de concentración marca APUESTAS, no liquidez. Se excluye toda la
		// renta 'Liquido': la caja ARS/USD y también los activos líquidos cargados
		// como tal (un money market o un FCI de liquidez). Tener plata parada no es
		// un riesgo de concentración — es justamente lo contrario.
		detalleMix = filasMix.map((r) => {
			const pct = t.totalUSD ? r.mercadoUSD / t.totalUSD : 0;
			const esLiquidez = r.tipo === 'Caja' || r.renta === 'Liquido';
			return { ...r, pct, concentrado: !esLiquidez && pct >= UMBRAL_CONCENTRACION };
		});

		cargando = false;
	}

	onMount(cargarTodo);

	// Actualiza precios desde data912 (botón manual). El auto al abrir vive en el layout.
	async function onActualizarPrecios() {
		actualizandoPrecios = true; preciosMsg = ''; preciosMsgErr = false;
		try { preciosMsg = await actualizarPreciosYFoto(); await cargarTodo(); }
		catch (e: any) { console.error(e); preciosMsgErr = true; preciosMsg = 'Ocurrió un error. Contactá al administrador.'; }
		actualizandoPrecios = false;
	}

	// Alias al helper único de format.ts (ver Brief H / A2). Mismo formato de antes,
	// ya no reimplementado acá.
	const fmtFechaHora = fechaHoraCorta;
	// Alias locales al helper único de format.ts (ver Brief H / A1).
	const money = pesos;
	const colorRenta: Record<string, string> = { Fija: '#2e7d32', Mixta: '#1a73e8', Variable: '#e8710a', Liquido: '#888' };
	// Mismos colores que las barras de "Exposición al tipo de cambio" de arriba.
	const colorExposicion: Record<string, string> = { Dolar: 'var(--accent)', CER: '#4ade80', Peso: '#e8975b' };
	// Texto legible SOBRE una barra de color: negro para colores claros, blanco para
	// oscuros (según luminancia percibida). Sirve para el % embebido en cada barra.
	function contraste(bg: string): string {
		let h = bg.replace('#', '');
		if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
		const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
		const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
		return L > 0.6 ? 'rgba(0,0,0,0.82)' : '#fff';
	}
	// Rendimiento por ventana: porcentual, un decimal, sin semáforo de color
	// (Bloque 5 — Julián lo va a evaluar después). "sin datos suficientes" en
	// vez de un cero cuando la ventana no tiene al menos 2 fotos.
	function fmtRend(n: number | null): string {
		return n == null ? 'sin datos suficientes' : (n >= 0 ? '+' : '') + (n * 100).toFixed(1) + '%';
	}
</script>

<div class="titulo-guia">
	<h1>Tenencia Actual</h1>
	<Guia
		clave="inversiones"
		para="Consolidar tu tenencia y tomar decisiones sobre ella."
		uso="Cargá tus operaciones en Movimientos y ajustá los tickers en Mercado para que la tenencia las refleje. Los montos y las correcciones de precio viven en Tenencia en montos."
		verMas
	/>
</div>

{#if cargando}
	<div class="topbar">
		<Skeleton w="120px" h="36px" radius="6px" />
		<Skeleton w="150px" h="36px" radius="6px" />
	</div>
	<div class="resumen">
		<div class="card sk-card"><Skeleton w="70%" h="0.62rem" /><Skeleton w="86%" h="1.05rem" /></div>
		<div class="card sk-card"><Skeleton w="70%" h="0.62rem" /><Skeleton w="86%" h="1.05rem" /></div>
		<div class="card sk-card"><Skeleton w="70%" h="0.62rem" /><Skeleton w="86%" h="1.05rem" /></div>
	</div>
	<div class="sk-tabla">
		<Skeleton w="100%" h="1.4rem" />
		<Skeleton w="100%" h="1.4rem" />
		<Skeleton w="100%" h="1.4rem" />
		<Skeleton w="100%" h="1.4rem" />
		<Skeleton w="100%" h="1.4rem" />
	</div>
{:else}
	<div class="btn-row">
		<a href="/carga-inversiones" class="btn btn-primary">Movimientos</a>
		<a href="/config-tickers" class="btn btn-secondary">🎯 Mercado</a>
	</div>

	<div class="resumen">
		<div class="card"><span>Rendimiento del año</span><strong>{fmtRend(rendAnio)}</strong></div>
		<div class="card"><span>Rendimiento del trimestre</span><strong>{fmtRend(rendTrimestre)}</strong></div>
		<div class="card"><span>Rendimiento del mes</span><strong>{fmtRend(rendMes)}</strong></div>
	</div>
	<NotaVisual objetivo="Cuánto rindió tu cartera" glosario="tenencia" glosarioTexto="Qué es el TWR">
		{#snippet muestra()}El rendimiento de toda tu cartera en el último año, trimestre y mes.{/snippet}
		{#snippet leer()}Es <strong>TWR</strong>: descuenta el efecto de tus ingresos y retiros de plata, así que mide cómo rindió lo invertido y no cuánto creció el saldo. <strong>“Sin datos suficientes”</strong> significa que esa ventana todavía no tiene dos fotos de cartera.{/snippet}
		{#snippet usar()}Compararlo contra un plazo fijo, la inflación o el dólar del mismo plazo, para saber si la estrategia valió la pena.{/snippet}
	</NotaVisual>

	<div class="moneda-fija"><span class="moneda-lbl">Valuado en USD</span> <span class="moneda-badge">al dólar MEP (bolsa) {money(dolar, 'ARS')}{dolarFecha ? ' · ' + fmtFecha(dolarFecha) : ''}</span></div>

	<div class="preciosbar">
		<a href="/inversiones/montos" class="btn btn-secondary">💰 Tenencia en montos</a>
		<button class="btn btn-secondary" onclick={onActualizarPrecios} disabled={actualizandoPrecios}>{actualizandoPrecios ? 'Actualizando…' : '⟳ Actualizar precios'}</button>
		<span class="preciostamp">Precios: <strong>{fmtFechaHora(preciosActualizadosEn)}</strong>{#if preciosMsg} · <span class:err={preciosMsgErr}>{#if preciosMsgErr}<span class="err-x">✗</span> {/if}{preciosMsg}</span>{/if}</span>
	</div>

	<div class="tabla-scroll">
	<table class="tabla-cartera">
		<thead><tr><th>Activo</th>
			<th class="num hl">PPC</th><th class="num hl">PPV</th><th class="num">Precio mercado</th><th class="num hl">Rend. %</th></tr></thead>
		<tbody>
			{#each cartera as h (h.id)}
				<tr>
					<td><div class="activo-cell"><span class="tipo-mini">{h.tipo}</span><span>{h.nombre}</span></div></td>
					<td class="num hl">{money(h.ppc, h.moneda, 2)}</td><td class="num hl {h.ppv >= h.ppc ? 'pos' : 'neg'}">{money(h.ppv, h.moneda, 2)}</td>
					<td class="num">{money(h.precioActual, h.moneda, 2)}</td>
					<td class="num hl {h.rendPct != null && h.rendPct >= 0 ? 'pos' : 'neg'}">{h.rendPct != null ? (h.rendPct * 100).toFixed(1) + '%' : '—'}</td>
				</tr>
			{/each}
			{#if cartera.length === 0}<tr><td colspan="5" class="vacio">No tenés activos en cartera.</td></tr>{/if}
		</tbody>
	</table>
	</div>
	<NotaVisual objetivo="Tu tenencia consolidada" glosario="tenencia" glosarioTexto="Cómo se calculan PPC y PPV">
		{#snippet muestra()}Cada posición abierta con su precio promedio de compra (<strong>PPC</strong>), su precio promedio de salida (<strong>PPV</strong>) y el precio de mercado de hoy.{/snippet}
		{#snippet leer()}El PPV va en <strong>verde</strong> si quedó arriba del PPC —ganás en la moneda del activo— y en <strong>rojo</strong> si quedó abajo. <strong>Rend. %</strong> suma la ganancia realizada y la no realizada sobre lo invertido, en dólares.{/snippet}
		{#snippet usar()}Ver qué posiciones sostienen el resultado y cuáles lo restan, antes de decidir dónde reforzar o de dónde salir.{/snippet}
	</NotaVisual>

	<div class="graf-fila">
		<div class="graf">
			<h2>Exposición al tipo de cambio (≈USD)</h2>
			{#if exposicion.tot > 0}
				<div class="bars">
					{#each exposicion.filas as f (f.clave)}
						<div class="barrow"><span class="lbl">{f.label}</span>
							<div class="track">
								<div class="bar" style="width:{f.pct * 100}%; background:{f.color}">
									{#if f.pct >= 0.16}<span class="pct" style="color:{contraste(f.color)}">{(f.pct * 100).toFixed(1)}%</span>{/if}
								</div>
								{#if f.pct < 0.16}<span class="pct-out">{(f.pct * 100).toFixed(1)}%</span>{/if}
							</div></div>
					{/each}
				</div>
			{:else}
				<p class="nota">Sin posiciones todavía.</p>
			{/if}
		</div>
		<div class="graf">
			<h2>Estructura de renta (≈USD)</h2>
			<div class="bars">
				{#each buckets as b (b.renta)}
					<div class="barrow"><span class="lbl">{b.renta}</span>
						<div class="track">
							<div class="bar" style="width:{b.pct * 100}%; background:{colorRenta[b.renta]}">
								{#if b.pct >= 0.16}<span class="pct" style="color:{contraste(colorRenta[b.renta])}">{(b.pct * 100).toFixed(1)}%</span>{/if}
							</div>
							{#if b.pct < 0.16}<span class="pct-out">{(b.pct * 100).toFixed(1)}%</span>{/if}
						</div></div>
				{/each}
			</div>
		</div>
	</div>
	{#if exposicion.tot > 0}
		<NotaVisual objetivo="Nivel de exposición al tipo de cambio y al tipo de renta">
			{#snippet muestra()}Cómo se reparte tu cartera entre <strong>Dólar</strong>, <strong>CER</strong> y <strong>Peso</strong>, y entre renta fija, mixta, variable y líquido. Incluye la liquidez.{/snippet}
			{#snippet leer()}Es exposición, no moneda de cotización: un CEDEAR cotiza en pesos pero sigue al dólar, y una ON dollar-linked también. <strong>Peso</strong> es la porción que no te cubre ante una devaluación; <strong>CER</strong> sigue la inflación.{/snippet}
			{#snippet usar()}Chequear si estás cubierto ante un salto del tipo de cambio; la exposición de cada activo la fijás en <a href="/config-tickers" class="link">Mercado</a>.{/snippet}
		</NotaVisual>
	{/if}

	<h2>Detalle del mix — ranking de concentración</h2>
	<div class="tabla-scroll">
	<table class="mix">
		<thead><tr><th>Activo</th><th>Tipo</th><th>Renta</th><th>Exposición</th><th class="num">% del total</th></tr></thead>
		<tbody>
			{#each detalleMix as d (d.nombre)}
				<tr class:concentrado={d.concentrado}>
					<td>{d.nombre}</td>
					<td>{d.tipo}</td>
					<td class="renta" style="color:{colorRenta[d.renta]}">{d.renta}</td>
					<td class="renta" style="color:{colorExposicion[d.exposicion]}">{d.exposicion}</td>
					<td class="num">{(d.pct * 100).toFixed(1)}%{#if d.concentrado} ⚠{/if}</td>
				</tr>
			{/each}
			{#if detalleMix.length === 0}<tr><td colspan="5" class="vacio">Sin posiciones todavía.</td></tr>{/if}
		</tbody>
	</table>
	</div>
	<NotaVisual objetivo="Ponderación de cada activo en el total de tu tenencia">
		{#snippet muestra()}Todas tus posiciones, incluida la liquidez, ordenadas por peso en la cartera de mayor a menor.{/snippet}
		{#snippet leer()}El <strong>⚠</strong> marca lo que supera el 20% del total; la liquidez no se marca —ni la caja ni un money market o FCI de liquidez— porque tener plata parada no es una apuesta concentrada.{/snippet}
		{#snippet usar()}Detectar concentración de riesgo y ver qué filas componen cada barra del gráfico de exposición de arriba.{/snippet}
	</NotaVisual>
{/if}

<style>
:global(body) { max-width: 980px; margin: 0 auto; padding: 16px; }
	h2 { font-size: 1.05rem; margin-top: 20px; }
	h2 { border-left: 3px solid var(--accent); padding-left: 12px; }
	.graf h2 { border-left: none; padding-left: 0; }
	.sk-tabla { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
	.preciosbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 8px 0; }
	.preciostamp { font-size: 0.78rem; color: var(--text-dim); }
	.preciostamp strong { color: var(--text); font-family: var(--font-num); font-weight: 400; }
	.moneda-fija { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: 6px 0; }
	.moneda-lbl { font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
	.moneda-badge { font-size: 0.8rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 5px 12px; color: var(--text); }
	.preciostamp span.err { color: var(--neg); }
	.err-x { font-size: 1.3em; line-height: 1; }
	/* .resumen/.card: base global en +layout.svelte. */

	table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
	th, td { padding: 5px 7px; text-align: left; }
	td.num { text-align: right; white-space: nowrap; }
	th.num { text-align: center; }
	/* Cartera actual: las 4 columnas numéricas (PPC/PPV/Precio mercado/Rend. %)
	   con el mismo ancho, para que los valores queden alineados en vertical sin
	   importar cuántos dígitos tenga cada uno. table-layout:fixed + width fijo
	   en las .num. "Activo" tiene min-width propio (no se lo lleva puesto un
	   viewport angosto) y la tabla tiene min-width total: si no entra, scrollea
	   horizontal dentro de .tabla-scroll en vez de aplastar/superponer columnas. */
	table.tabla-cartera { table-layout: fixed; min-width: 460px; }
	table.tabla-cartera th.num, table.tabla-cartera td.num { width: 80px; }
	table.tabla-cartera th:first-child, table.tabla-cartera td:first-child { width: 140px; }
	.activo-cell { display: flex; flex-direction: column; gap: 1px; min-width: 0; overflow: hidden; }
	.activo-cell span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.tipo-mini { font-size: 0.68rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.03em; }

	/* Detalle del mix — ranking de concentración */
	table.mix { max-width: 640px; margin-top: 6px; }
	table.mix td.renta { font-weight: 700; white-space: nowrap; }
	table.mix tr.concentrado td { color: var(--warn); font-weight: 600; background: rgba(251, 191, 36, 0.08); }
	th.hl, td.hl { background: rgba(91, 157, 255, 0.06); }
	.vacio { text-align: center; color: var(--text-dim); font-style: italic; }

	/* Los textos descriptivos de cada visual viven ahora en NotaVisual (estructura
	   y estilos propios del componente): el CSS local ya no hace falta. */

	/* Los dos gráficos de barras, lado a lado. En pantallas angostas se compactan
	   (labels/altura/fuente más chicos) en vez de apilarse, para que entren en
	   paralelo en un celular; solo apilan en pantallas realmente extremas (<=320px). */
	.graf-fila { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; align-items: start; }
	.graf h2 { margin-top: 16px; }
	.bars { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
	.barrow { display: flex; align-items: center; gap: 8px; font-size: 0.82rem; }
	.lbl { width: 64px; color: var(--text-dim); flex-shrink: 0; }
	.track { flex: 1; display: flex; align-items: center; background: var(--surface-2); border-radius: 4px; height: 32px; overflow: hidden; }
	.bar { height: 100%; display: flex; align-items: center; justify-content: flex-end; }
	.pct { padding-right: 8px; font-size: 0.78rem; font-weight: 700; white-space: nowrap; }
	.pct-out { padding-left: 8px; font-size: 0.78rem; font-weight: 700; color: var(--text); white-space: nowrap; }
	@media (max-width: 620px) {
		.graf-fila { gap: 4px 10px; }
		.lbl { width: 40px; font-size: 0.72rem; }
		.track { height: 24px; }
		.pct, .pct-out { font-size: 0.68rem; padding-left: 4px; padding-right: 4px; }
	}
	@media (max-width: 320px) {
		.graf-fila { grid-template-columns: 1fr; }
	}
	.nota { font-size: 0.8rem; color: var(--text-dim); margin-top: 12px; }
	.pos { color: var(--pos); }
	.neg { color: var(--neg); }
</style>

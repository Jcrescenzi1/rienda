<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import { hoyISO, fmtFecha, parseNum, formatNum, soloNum } from '$lib/format';
	import { aUSD, dolarActual, calcularFIFO, calcularLiquidez, calcularFoto, guardarSnapshot } from '$lib/cartera';
	import { cargarDolarSerie, dolarDeFecha } from '$lib/moneda';
	import { actualizarPrecios } from '$lib/db/precios';
	import Guia from '$lib/Guia.svelte';

	let cargando = $state(true);
	let cartera = $state<any[]>([]);
	let resultadoAbiertasTotal = $state(0);
	let realizadoAnioActual = $state(0);
	let realizadoPorAnio = $state<any[]>([]);
	let buckets = $state<any[]>([]);
	// Detalle del mix: cada activo (y el líquido) con su renta, tipo y % del total
	let detalleMix = $state<any[]>([]);
	let dolar = $state(1);
	let dolarFecha = $state<string | null>(null); // fecha de la cotización MEP usada
	let totalUSD = $state(0);
	let liqSaldos = $state<Record<string, number>>({ ARS: 0, USD: 0 });

	let editId = $state<number | null>(null);
	let editPrecio = $state('');
	let editLiq = $state<string | null>(null);
	let editSaldo = $state('');

	// Auto-actualización de precios
	let actualizandoPrecios = $state(false);
	let preciosMsg = $state('');
	let preciosActualizadosEn = $state<string | null>(null);

	// Guardar Cartera (foto)
	let showFoto = $state(false);
	let fFlujo = $state(''); let fotoValorUSD = $state(0); let fotoValorARS = $state(0); let fotoDolar = $state(1);
	let fotoFecha = $state(hoyISO());
	let fotoMsg = $state('');

	const anioActual = new Date().getFullYear().toString();

	async function cargarTodo() {
		dolar = await dolarActual();
		// Fecha de esa cotización MEP (para mostrar a qué dólar y qué tan fresco se valúa).
		const df = (await query("SELECT fecha FROM cotizacion_dolar WHERE perfil_id=1 AND casa='bolsa' ORDER BY fecha DESC LIMIT 1")) as any[];
		dolarFecha = df[0]?.fecha ?? null;
		// Serie de dólar para convertir renta/amort con el MEP de SU fecha cuando el
		// movimiento no trae valor_dolar (fallback al último si no hay cotización previa).
		const serie = await cargarDolarSerie();
		const tcDe = (vd: any, fecha: string) => (Number.isFinite(vd) && vd > 0 ? vd : (dolarDeFecha(serie, fecha) ?? dolar));

		const mp = (await query("SELECT valor FROM meta WHERE clave='precios_actualizados_en'")) as any[];
		preciosActualizadosEn = mp[0]?.valor ?? null;

		// FIFO compartido con Evolución (una sola implementación)
		const { lotes, realizadoCerradoPorMes, episodioDesde, aMap, txs } = await calcularFIFO();

		// Agregados por activo para el resultado de la tabla, acotados a la POSICIÓN
		// ABIERTA ACTUAL: recorro las transacciones en orden y, cada vez que la tenencia
		// vuelve a cero (cierre total), reinicio los acumuladores. Así un ciclo viejo
		// ya cerrado no contamina el PPC/PPV de la posición que tenés hoy; las ventas
		// parciales dentro de la posición abierta sí cuentan. No usa FIFO.
		// Reusa las transacciones que ya leyó calcularFIFO (mismo ORDER BY
		// activo_id, fecha, id) en vez de re-leer la tabla. Renombra a las columnas
		// cortas que usa el agregado. episodioDesde ya viene calculado por calcularFIFO.
		const txAgg = txs.map((t: any) => ({ aid: t.activo_id, op: t.operacion, u: t.unidades, p: t.precio, vd: t.valor_dolar, f: t.fecha }));
		type Agg = { compU: number; inv: number; invUSD: number; rec: number; recUSD: number };
		const nuevoAgg = (): Agg => ({ compU: 0, inv: 0, invUSD: 0, rec: 0, recUSD: 0 });
		const agg: Record<number, Agg> = {};
		const heldRun: Record<number, number> = {};
		for (const t of txAgg) {
			const a = aMap[t.aid];
			if (!a) continue;
			agg[t.aid] ??= nuevoAgg();
			heldRun[t.aid] ??= 0;
			const nat = t.u * t.p;
			const enUSD = aUSD(t.p, a.moneda, t.vd) * t.u;
			if (t.op === 'Compra') {
				heldRun[t.aid] += t.u;
				agg[t.aid].compU += t.u; agg[t.aid].inv += nat; agg[t.aid].invUSD += enUSD;
			} else {
				heldRun[t.aid] -= t.u;
				agg[t.aid].rec += nat; agg[t.aid].recUSD += enUSD;
				// Cierre total: la posición vuelve a cero -> arranca un episodio nuevo.
				if (heldRun[t.aid] <= 1e-9) { heldRun[t.aid] = 0; agg[t.aid] = nuevoAgg(); }
			}
		}

		// Posición abierta HOY (tenencia > 0 según el FIFO de calcularFIFO).
		const posicionAbierta = (aid: number) => (lotes[aid]?.reduce((s, l) => s + l.u, 0) ?? 0) > 1e-6;

		// Renta y amortización: si cae dentro del episodio VIVO de una posición que
		// seguís teniendo, va al numerador del PPV/Result.Real (ya está adentro de
		// "Resultado Posiciones Abiertas"). Si no —posición ya cerrada, o renta de un
		// ciclo anterior—, el cupón (sin amort, que es devolución de capital) pasa a
		// "ganancia realizada" para no perderlo ni duplicarlo.
		const rentas = (await query(
			'SELECT activo_id, fecha, moneda, monto_renta, monto_amort, valor_dolar FROM renta_activo WHERE perfil_id=1 ORDER BY activo_id, fecha'
		)) as any[];
		const rentaAgg: Record<number, { rec: number; recUSD: number }> = {};
		const rentaCerradaPorMes: Record<string, number> = {};
		for (const r of rentas) {
			const a = aMap[r.activo_id];
			if (!a) continue;
			const vd = tcDe(r.valor_dolar, r.fecha); // MEP de la fecha si el mov no trae TC
			const desde = episodioDesde[r.activo_id];
			const esAbierta = posicionAbierta(r.activo_id) && !!desde && r.fecha >= desde;
			if (esAbierta) {
				const total = (r.monto_renta ?? 0) + (r.monto_amort ?? 0);
				const rUSD = aUSD(total, r.moneda, vd);            // para gananciaUSD
				const rNat = a.moneda === 'USD' ? rUSD : rUSD * vd; // en la moneda del activo, para el PPV
				(rentaAgg[r.activo_id] ??= { rec: 0, recUSD: 0 });
				rentaAgg[r.activo_id].rec += rNat;
				rentaAgg[r.activo_id].recUSD += rUSD;
			} else {
				const mes = r.fecha.slice(0, 7);
				rentaCerradaPorMes[mes] = (rentaCerradaPorMes[mes] ?? 0) + aUSD(r.monto_renta ?? 0, r.moneda, vd);
			}
		}

		// Ganancia realizada del año: solo ciclos CERRADOS (ventas + cupón). Lo de
		// posiciones que seguís teniendo ya está en "Resultado Posiciones Abiertas".
		realizadoAnioActual = Object.entries(realizadoCerradoPorMes)
			.filter(([mes]) => mes.startsWith(anioActual))
			.reduce((s, [, v]) => s + v, 0)
			+ Object.entries(rentaCerradaPorMes)
				.filter(([mes]) => mes.startsWith(anioActual))
				.reduce((s, [, v]) => s + v, 0);

		// Detalle histórico por año (ciclos cerrados), para no perder el resto del
		// historial aunque el card de arriba solo muestre el año en curso.
		const porAnio: Record<string, number> = {};
		for (const [mes, v] of Object.entries(realizadoCerradoPorMes)) porAnio[mes.slice(0, 4)] = (porAnio[mes.slice(0, 4)] ?? 0) + v;
		for (const [mes, v] of Object.entries(rentaCerradaPorMes)) porAnio[mes.slice(0, 4)] = (porAnio[mes.slice(0, 4)] ?? 0) + v;
		realizadoPorAnio = Object.keys(porAnio).sort().reverse().map((anio) => ({ anio, monto: porAnio[anio] }));

		const hold: any[] = [];
		const buck: Record<string, number> = { Fija: 0, Mixta: 0, Variable: 0, Liquido: 0 };
		let tUSD = 0;
		for (const [aid, q] of Object.entries(lotes)) {
			const u = q.reduce((s, l) => s + l.u, 0);
			if (u < 1e-6) continue;
			const a = aMap[Number(aid)];
			const costoNat = q.reduce((s, l) => s + l.u * l.pNat, 0);  // costo de lo que queda (fallback)
			const costoUSD = q.reduce((s, l) => s + l.u * l.pUSD, 0);  // costo USD de lo que queda (fallback)
			// Agregado del activo (total comprado/vendido). Fallback al remanente si faltara.
			const g = agg[Number(aid)] ?? { compU: u, inv: costoNat, invUSD: costoUSD, rec: 0, recUSD: 0 };
			// Renta/amort de la posición abierta -> al numerador del PPV y a la ganancia.
			const rp = rentaAgg[Number(aid)];
			if (rp) { g.rec += rp.rec; g.recUSD += rp.recUSD; }
			const ppc = g.compU ? g.inv / g.compU : 0;                 // promedio de compra sobre TODO lo comprado
			const pa = a.precio_actual ?? ppc; const mercado = u * pa;
			const mercadoUSD = a.moneda === 'USD' ? mercado : mercado / dolar;
			// PPV ponderado: lo recuperado en ventas + la tenencia a precio actual, sobre el total comprado.
			const ppv = g.compU ? (g.rec + mercado) / g.compU : pa;
			const gananciaUSD = (g.recUSD + mercadoUSD) - g.invUSD;                      // ganancia real ≈USD (realizada + no realizada)
			const rendPct = g.invUSD ? gananciaUSD / g.invUSD : null;                    // % sobre lo invertido en USD
			buck[a.renta] = (buck[a.renta] ?? 0) + mercadoUSD; tUSD += mercadoUSD;
			hold.push({ id: Number(aid), nombre: a.nombre, tipo: a.tipo, renta: a.renta, moneda: a.moneda,
				exposicion: a.exposicion ?? (a.moneda === 'USD' || a.tipo === 'CEDEAR' || a.tipo === 'Indice' ? 'Dolar' : 'Peso'),
				unidades: u, ppc, ppv, precioActual: pa, mercado,
				gananciaUSD, rendPct, mercadoUSD });
		}
		resultadoAbiertasTotal = hold.reduce((s, h) => s + h.gananciaUSD, 0);

		const bal = await calcularLiquidez();
		liqSaldos = bal;
		// La liquidez cuenta en el total y en la estructura de renta,
		// pero no entra en la tabla de cartera: se muestra en las cards de arriba.
		for (const mon of ['ARS', 'USD']) {
			const saldo = bal[mon] ?? 0;
			const valUSD = mon === 'USD' ? saldo : saldo / dolar;
			buck['Liquido'] += valUSD; tUSD += valUSD;
		}

		for (const h of hold) h.peso = tUSD ? h.mercadoUSD / tUSD : 0;
		hold.sort((x, y) => y.mercadoUSD - x.mercadoUSD); // la tabla sigue ordenada por mix
		cartera = hold; totalUSD = tUSD;
		buckets = Object.entries(buck).filter(([, v]) => v > 0).map(([renta, v]) => ({ renta, v, pct: tUSD ? v / tUSD : 0 })).sort((a, b) => b.v - a.v);

		// Detalle del mix: ranking de concentración (activos + líquido), ordenado por
		// % del total de mayor a menor. El desglose por renta ya lo muestra el
		// gráfico de barras de arriba; acá interesa ver de un vistazo cuáles son las
		// apuestas más grandes cruzando categorías.
		const liqRows = ['ARS', 'USD']
			.map((mon) => {
				const saldo = bal[mon] ?? 0;
				const valUSD = mon === 'USD' ? saldo : saldo / dolar;
				return { renta: 'Liquido', tipo: 'Caja', nombre: 'Líquido ' + mon, mercadoUSD: valUSD, exposicion: mon === 'USD' ? 'Dolar' : 'Peso' };
			})
			.filter((r) => r.mercadoUSD > 0);
		const filasMix = [
			...hold.map((h) => ({ renta: h.renta, tipo: h.tipo, nombre: h.nombre, mercadoUSD: h.mercadoUSD, exposicion: h.exposicion })),
			...liqRows
		];
		filasMix.sort((a, b) => b.mercadoUSD - a.mercadoUSD);
		const UMBRAL_CONCENTRACION = 0.2; // 20% del total
		detalleMix = filasMix.map((r) => {
			const pct = tUSD ? r.mercadoUSD / tUSD : 0;
			return { ...r, pct, concentrado: r.tipo !== 'Caja' && pct >= UMBRAL_CONCENTRACION };
		});

		cargando = false;
	}

	onMount(cargarTodo);

	// Exposición al TIPO DE CAMBIO (no a la moneda de cotización): a qué se mueve el
	// valor de cada activo. Tres cubos: Dólar / CER (inflación) / Peso. Lo define
	// activo.exposicion (editable en Configurar tickers). El cash: USD -> Dólar,
	// ARS -> Peso. Sirve para mapear tu posicionamiento vs. el contexto macro.
	let exposicion = $derived.by(() => {
		const b: Record<string, number> = { Dolar: 0, CER: 0, Peso: 0 };
		for (const h of cartera) b[h.exposicion] = (b[h.exposicion] ?? 0) + h.mercadoUSD;
		b.Dolar += liqSaldos.USD ?? 0;
		b.Peso += (liqSaldos.ARS ?? 0) / dolar;
		const tot = b.Dolar + b.CER + b.Peso;
		return {
			tot,
			filas: [
				{ clave: 'Dolar', label: 'Dólar', v: b.Dolar, pct: tot ? b.Dolar / tot : 0, color: 'var(--accent)' },
				{ clave: 'CER', label: 'CER / Inflación', v: b.CER, pct: tot ? b.CER / tot : 0, color: '#4ade80' },
				{ clave: 'Peso', label: 'Peso', v: b.Peso, pct: tot ? b.Peso / tot : 0, color: '#e8975b' }
			]
		};
	});

	function abrirEdit(h: any) { editId = h.id; editPrecio = formatNum(h.precioActual, 2); }
	async function guardarPrecio() {
		const p = parseNum(editPrecio);
		if (editId == null || !Number.isFinite(p) || p <= 0) { editId = null; return; }
		await query('UPDATE activo SET precio_actual=?, precio_actualizado_en=? WHERE id=? AND perfil_id=1', [p, new Date().toISOString(), editId]);
		editId = null; editPrecio = ''; await cargarTodo();
	}

	// Actualiza precios desde data912 (botón manual). El auto al abrir vive en el layout.
	async function onActualizarPrecios() {
		actualizandoPrecios = true; preciosMsg = '';
		try { preciosMsg = await actualizarPrecios(); await cargarTodo(); }
		catch (e: any) { preciosMsg = 'Error: ' + (e?.message ?? e); }
		actualizandoPrecios = false;
	}

	const fmtFechaHora = (iso: string | null): string => {
		if (!iso) return 'nunca';
		const d = new Date(iso);
		return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
	};
	function abrirEditLiq(mon: string) { editLiq = mon; editSaldo = formatNum(liqSaldos[mon] ?? 0, 2); }
	async function guardarLiq() {
		const s = parseNum(editSaldo);
		if (editLiq == null || !Number.isFinite(s) || s < 0) { editLiq = null; return; }
		const ajuste = s - (liqSaldos[editLiq] ?? 0);
		if (Math.abs(ajuste) > 1e-6)
			await query('INSERT INTO mov_caja (perfil_id,fecha,accion,moneda,monto,nota) VALUES (1,?,?,?,?,?)',
				[hoyISO(), 'Ajuste', editLiq, ajuste, 'Ajuste de saldo (rendimiento fondo)']);
		editLiq = null; editSaldo = ''; await cargarTodo();
	}

	// Guardar Cartera (snapshot) — cálculo compartido con Evolución
	async function prepararFoto() {
		fotoMsg = '';
		const f = await calcularFoto();
		fotoDolar = f.dolar;
		fotoValorUSD = f.valorUSD;
		fotoValorARS = f.valorARS;
		fFlujo = formatNum(f.flujo, 2);
		showFoto = true;
	}
	async function guardarFoto() {
		try {
			const flujo = parseNum(fFlujo);
			await guardarSnapshot(fotoFecha, fotoValorUSD, Number.isFinite(flujo) ? flujo : 0, fotoDolar, fotoValorARS);
			showFoto = false; fotoMsg = '📸 Cartera guardada en Evolución ✅';
			setTimeout(() => (fotoMsg = ''), 3000);
		} catch (e: any) { fotoMsg = 'Error: ' + (e?.message ?? String(e)); }
	}

	const money = (n: number, mon: string, dec = 0) => (mon === 'USD' ? 'U$D ' : '$') + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
	const usd = (n: number, dec = 0) => 'U$D ' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
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
</script>

<div class="titulo-guia">
	<h1>Tenencia Actual</h1>
	<Guia clave="inversiones" texto="Tu cartera a precio de mercado: tenencia, PPC vs PPV, liquidez en ARS/USD y estructura de renta. Actualizá precios con el lápiz ✏. Las operaciones se cargan desde '➕ Cargar movimiento'; '📸 Guardar Cartera' saca la foto que alimenta Evolución." />
</div>

{#if cargando}
	<p>Cargando…</p>
{:else}
	<div class="topbar">
		<a href="/carga-inversiones" class="btn btn-primary">➕ Cargar movimiento</a>
		<button class="btn btn-success" onclick={prepararFoto}>📸 Guardar Cartera</button>
	</div>
	{#if fotoMsg}<p class="msg">{fotoMsg}</p>{/if}

	{#if showFoto}
		<div class="form">
			<h3>Guardar foto de cartera — {fotoFecha}</h3>
			<label>Fecha<input type="date" bind:value={fotoFecha} /></label>
			<p class="hint">Valor actual: <strong>{usd(fotoValorUSD)}</strong> ({money(fotoValorARS, 'ARS')} · dólar {fotoDolar})</p>
			<label>Flujo neto desde la última foto (USD)<input type="text" inputmode="decimal" use:soloNum bind:value={fFlujo} /></label>
			<div class="botones"><button class="btn btn-success" onclick={guardarFoto}>Guardar</button><button class="btn btn-secondary" onclick={() => (showFoto = false)}>Cancelar</button></div>
		</div>
	{/if}

	<div class="resumen">
		<div class="card"><span>Cartera total (≈USD)</span><strong>{usd(totalUSD)}</strong></div>
		<div class="card"><span>Resultado Posiciones Abiertas (USD)</span><strong class={resultadoAbiertasTotal >= 0 ? 'pos' : 'neg'}>{usd(resultadoAbiertasTotal, 2)}</strong></div>
		<div class="card"><span>Ganancia realizada {anioActual} (USD)</span><strong class={realizadoAnioActual >= 0 ? 'pos' : 'neg'}>{usd(realizadoAnioActual, 2)}</strong></div>
	</div>

	<div class="moneda-fija"><span class="moneda-lbl">Valuado en USD</span> <span class="moneda-badge">al dólar MEP (bolsa) {money(dolar, 'ARS')}{dolarFecha ? ' · ' + fmtFecha(dolarFecha) : ''}</span></div>

	{#if realizadoPorAnio.length}
		<details class="por-anio">
			<summary>Ganancia realizada por año (ciclos cerrados)</summary>
			<table class="chica">
				<thead><tr><th>Año</th><th class="num">Realizado (USD)</th></tr></thead>
				<tbody>
					{#each realizadoPorAnio as r (r.anio)}
						<tr><td>{r.anio}</td><td class="num {r.monto >= 0 ? 'pos' : 'neg'}">{usd(r.monto, 2)}</td></tr>
					{/each}
				</tbody>
			</table>
		</details>
	{/if}

	<h2>Cartera actual</h2>
	<div class="liquidez">
		{#each ['ARS', 'USD'] as mon}
			<div class="liqcard">
				<span>Líquido {mon}</span>
				{#if editLiq === mon}
					<div class="liqedit">
						<input type="text" inputmode="decimal" use:soloNum bind:value={editSaldo} onkeydown={(e) => e.key === 'Enter' && guardarLiq()} />
						<button aria-label="Guardar" class="okp" onclick={guardarLiq}>✓</button>
						<button aria-label="Cancelar" class="cancp" onclick={() => (editLiq = null)}>✕</button>
					</div>
				{:else}
					<div class="liqval">
						<strong>{money(liqSaldos[mon] ?? 0, mon)}</strong>
						<button aria-label="Editar" class="lapiz" onclick={() => abrirEditLiq(mon)} title="Editar saldo">✏</button>
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<div class="preciosbar">
		<button class="btn btn-secondary" onclick={onActualizarPrecios} disabled={actualizandoPrecios}>{actualizandoPrecios ? 'Actualizando…' : '⟳ Actualizar precios'}</button>
		<a href="/config-tickers" class="btn btn-secondary">🎯 Tickers</a>
		<span class="preciostamp">Precios: <strong>{fmtFechaHora(preciosActualizadosEn)}</strong>{#if preciosMsg} · {preciosMsg}{/if}</span>
	</div>
	<table>
		<thead><tr><th>Tipo</th><th>Activo</th>
			<th class="num hl">PPC</th><th class="num hl">PPV</th><th class="num">Precio mercado</th><th class="num hl">Rend. %</th><th class="num hl">Result. Real</th></tr></thead>
		<tbody>
			{#each cartera as h (h.id)}
				<tr>
					<td>{h.tipo}</td><td>{h.nombre}</td>
					<td class="num hl">{money(h.ppc, h.moneda, 2)}</td><td class="num hl {h.ppv >= h.ppc ? 'pos' : 'neg'}">{money(h.ppv, h.moneda, 2)}</td>
					<td class="num precioedit">
						{#if editId === h.id}
							<input type="text" inputmode="decimal" use:soloNum bind:value={editPrecio} onkeydown={(e) => e.key === 'Enter' && guardarPrecio()} />
							<button aria-label="Guardar" class="okp" onclick={guardarPrecio}>✓</button><button aria-label="Cancelar" class="cancp" onclick={() => (editId = null)}>✕</button>
						{:else}{money(h.precioActual, h.moneda, 2)}<button aria-label="Editar" class="lapiz" onclick={() => abrirEdit(h)}>✏</button>{/if}
					</td>
					<td class="num hl {h.rendPct != null && h.rendPct >= 0 ? 'pos' : 'neg'}">{h.rendPct != null ? (h.rendPct * 100).toFixed(1) + '%' : '—'}</td>
					<td class="num hl {h.gananciaUSD >= 0 ? 'pos' : 'neg'}">{usd(h.gananciaUSD)}</td>
				</tr>
			{/each}
			{#if cartera.length === 0}<tr><td colspan="7" class="vacio">No tenés activos en cartera.</td></tr>{/if}
		</tbody>
	</table>
	<details class="nota-colapsable">
		<summary>Descripción de la visual: Cartera actual</summary>
		<p class="nota">
			<strong>PPC</strong> (Precio Promedio de Compra): precio promedio de las compras de cada activo.<br />
			<strong>PPV</strong> (Precio Promedio de Venta): precio promedio de salida — recuperado en ventas, rentas y amortizaciones + tu tenencia a precio actual.<br />
			• <strong>Verde</strong> si está por encima del PPC (ganás en la moneda del activo).<br />
			• <strong>Rojo</strong> si está por debajo.<br />
			<strong>Rend. %</strong> = Result. Real ÷ invertido (USD) del episodio abierto.<br />
			<strong>Result. Real</strong> = resultado de la tenencia real, evaluado en USD (ventas parciales + tenencia).<br />
			• La brecha entre el PPV verde y un Resultado rojo es ganancia nominal con pérdida real.
		</p>
	</details>

	<div class="graf-fila">
		<div class="graf">
			<h2>Exposición al tipo de cambio (≈USD)</h2>
			{#if exposicion.tot > 0}
				<div class="bars">
					{#each exposicion.filas as f (f.clave)}
						<div class="barrow"><span class="lbl">{f.label}</span>
							<div class="track">
								<div class="bar" style="width:{f.pct * 100}%; background:{f.color}">
									{#if f.pct >= 0.16}<span class="pct" style="color:{contraste(f.color)}">{(f.pct * 100).toFixed(0)}%</span>{/if}
								</div>
								{#if f.pct < 0.16}<span class="pct-out">{(f.pct * 100).toFixed(0)}%</span>{/if}
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
								{#if b.pct >= 0.16}<span class="pct" style="color:{contraste(colorRenta[b.renta])}">{(b.pct * 100).toFixed(0)}%</span>{/if}
							</div>
							{#if b.pct < 0.16}<span class="pct-out">{(b.pct * 100).toFixed(0)}%</span>{/if}
						</div></div>
				{/each}
			</div>
		</div>
	</div>
	{#if exposicion.tot > 0}
		<details class="nota-colapsable">
			<summary>Descripción de la visual: Exposición y estructura de renta</summary>
			<p class="nota">Exposición: a qué se mueve tu cartera, no en qué moneda cotiza — <strong>Dólar</strong> sigue al tipo de cambio (USD, CEDEARs, dollar-linked), <strong>CER</strong> sigue la inflación, <strong>Peso</strong> no cubre ante una devaluación. Incluye liquidez; la exposición de cada activo la fijás en <a href="/config-tickers" class="link">Configurar tickers</a>.</p>
		</details>
	{/if}

	<h2>Detalle del mix — ranking de concentración</h2>
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
	<details class="nota-colapsable">
		<summary>Descripción de la visual: Detalle del mix</summary>
		<p class="nota">Ordenado por % del total, de mayor a menor. ⚠ marca posiciones que superan el 20% de la cartera (riesgo de concentración) — la liquidez no se marca, porque no es una apuesta en un activo. La columna <strong>Exposición</strong> muestra a qué tipo de cambio sigue cada fila (Dólar / CER / Peso) — sirve para ver en qué se compone el desglose del gráfico "Exposición al tipo de cambio" de arriba.</p>
	</details>
{/if}

<style>
:global(body) { max-width: 980px; margin: 0 auto; padding: 16px; }
	h2 { font-size: 1.05rem; margin-top: 20px; }
	h3 { margin: 0 0 4px; font-size: 1rem; }
	h2 { border-left: 3px solid var(--accent); padding-left: 12px; }
	.graf h2 { border-left: none; padding-left: 0; }
	.topbar { display: flex; gap: 8px; flex-wrap: wrap; }
	.preciosbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 8px 0; }
	.preciostamp { font-size: 0.78rem; color: var(--text-dim); }
	.preciostamp strong { color: var(--text); font-family: var(--font-num); font-weight: 400; }
	.moneda-fija { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: 6px 0; }
	.moneda-lbl { font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
	.moneda-badge { font-size: 0.8rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 5px 12px; color: var(--text); }
	.form { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 14px; margin: 12px 0; display: flex; flex-direction: column; gap: 9px; max-width: 400px; }
	label { display: flex; flex-direction: column; font-size: 0.82rem; color: var(--text-dim); gap: 3px; }
	input { padding: 6px; font-size: 0.95rem; }
	.botones { display: flex; gap: 8px; }
	.hint { font-size: 0.82rem; color: var(--accent); margin: 0; }
	.msg { font-weight: 600; margin: 6px 0; }
	.resumen { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 12px 0; }
	.card { border: 1px solid transparent; background: var(--surface); border-radius: 8px; padding: 10px 11px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.card span { font-family: var(--font-display); font-size: clamp(0.56rem, 2.4vw, 0.66rem); font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-dim); }
	.card strong { font-size: clamp(0.85rem, 3.6vw, 1.25rem); font-weight: 400; white-space: nowrap; }
	/* La cartera total es el numero hero de la pantalla */
	.resumen .card:first-child { border-left: 3px solid var(--accent); border-radius: 0 8px 8px 0; }
	.resumen .card:first-child strong { font-weight: 300; font-size: clamp(0.95rem, 4.2vw, 1.5rem); }

	/* Franja de liquidez */
	.liquidez { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin: 0 0 12px; }
	.liqcard { border: 1px solid transparent; background: rgba(74, 222, 128, 0.06); border-radius: 8px; padding: 8px 11px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.liqcard span { font-family: var(--font-display); font-size: clamp(0.56rem, 2.4vw, 0.66rem); font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-dim); }
	.liqval { display: flex; align-items: center; gap: 6px; }
	.liqval strong { font-family: var(--font-num); font-size: clamp(0.82rem, 3.4vw, 1.05rem); font-weight: 400; white-space: nowrap; }
	.liqedit { display: flex; align-items: center; gap: 4px; }
	.liqedit input { width: 110px; padding: 3px 5px; font-size: 0.95rem; }

	table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
	th, td { padding: 5px 7px; text-align: left; }
	td.num { text-align: right; white-space: nowrap; }
	th.num { text-align: center; }

	/* Detalle del mix — ranking de concentración */
	table.mix { max-width: 640px; margin-top: 6px; }
	table.mix td.renta { font-weight: 700; white-space: nowrap; }
	table.mix tr.concentrado td { color: var(--warn); font-weight: 600; background: rgba(251, 191, 36, 0.08); }
	th.hl, td.hl { background: rgba(91, 157, 255, 0.06); }
	.vacio { text-align: center; color: var(--text-dim); font-style: italic; }
	.precioedit input { width: 90px; padding: 2px 4px; }

	/* Ganancia realizada por año (detalle plegable) */
	.por-anio { margin: 6px 0 12px; }
	.por-anio summary { cursor: pointer; font-size: 0.82rem; color: var(--text-dim); }
	table.chica { max-width: 320px; margin-top: 8px; }

	/* Textos descriptivos de cada visual, colapsados por defecto */
	.nota-colapsable { margin: 6px 0 12px; }
	.nota-colapsable summary { cursor: pointer; font-size: 0.82rem; color: var(--text-dim); }
	.nota-colapsable .nota { margin-top: 6px; }

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

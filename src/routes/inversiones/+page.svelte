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
	let realizadoAnioActual = $state(0);
	let noRealizadoTotal = $state(0);
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
		const { lotes, realPorMes, aMap, txs } = await calcularFIFO();
		let realizadoAnio = Object.entries(realPorMes)
			.filter(([mes]) => mes.startsWith(anioActual))
			.reduce((s, [, v]) => s + v, 0);

		// Agregados por activo para el resultado de la tabla, acotados a la POSICIÓN
		// ABIERTA ACTUAL: recorro las transacciones en orden y, cada vez que la tenencia
		// vuelve a cero (cierre total), reinicio los acumuladores. Así un ciclo viejo
		// ya cerrado no contamina el PPC/PPV de la posición que tenés hoy; las ventas
		// parciales dentro de la posición abierta sí cuentan. No usa FIFO.
		// Reusa las transacciones que ya leyó calcularFIFO (mismo ORDER BY
		// activo_id, fecha, id) en vez de re-leer la tabla. Renombra a las columnas
		// cortas que usa el agregado.
		const txAgg = txs.map((t: any) => ({ aid: t.activo_id, op: t.operacion, u: t.unidades, p: t.precio, vd: t.valor_dolar, f: t.fecha }));
		type Agg = { compU: number; inv: number; invUSD: number; rec: number; recUSD: number };
		const nuevoAgg = (): Agg => ({ compU: 0, inv: 0, invUSD: 0, rec: 0, recUSD: 0 });
		const agg: Record<number, Agg> = {};
		const heldRun: Record<number, number> = {};
		// Fecha en que arrancó la posición abierta actual (primera compra del episodio
		// vivo). Sirve para atribuir renta/amort SOLO a la posición viva (no a una vieja
		// ya cerrada y recomprada).
		const episodioDesde: Record<number, string> = {};
		for (const t of txAgg) {
			const a = aMap[t.aid];
			if (!a) continue;
			agg[t.aid] ??= nuevoAgg();
			heldRun[t.aid] ??= 0;
			const nat = t.u * t.p;
			const enUSD = aUSD(t.p, a.moneda, t.vd) * t.u;
			if (t.op === 'Compra') {
				if (agg[t.aid].compU === 0) episodioDesde[t.aid] = t.f; // primera compra del episodio
				heldRun[t.aid] += t.u;
				agg[t.aid].compU += t.u; agg[t.aid].inv += nat; agg[t.aid].invUSD += enUSD;
			} else {
				heldRun[t.aid] -= t.u;
				agg[t.aid].rec += nat; agg[t.aid].recUSD += enUSD;
				// Cierre total: la posición vuelve a cero -> arranca un episodio nuevo.
				if (heldRun[t.aid] <= 1e-9) { heldRun[t.aid] = 0; agg[t.aid] = nuevoAgg(); }
			}
		}

		// Renta y amortización de la POSICIÓN ABIERTA: se suman al numerador del PPV
		// (lado "recuperado", sin unidades ni lote). Solo cuentan las cobradas dentro
		// del episodio vivo (fecha >= inicio del episodio actual). Amort compensa la
		// caída de precio que data912 ya aplicó; renta sube el PPV genuino.
		const rentas = (await query(
			'SELECT activo_id, fecha, moneda, monto_renta, monto_amort, valor_dolar FROM renta_activo WHERE perfil_id=1 ORDER BY activo_id, fecha'
		)) as any[];
		const rentaAgg: Record<number, { rec: number; recUSD: number }> = {};
		let rentaAnioUSD = 0; // cupón realizado en el año (para la card de ganancia realizada)
		for (const r of rentas) {
			const a = aMap[r.activo_id];
			if (!a) continue;
			const vd = tcDe(r.valor_dolar, r.fecha); // MEP de la fecha si el mov no trae TC
			// Cupón como ganancia realizada del año (todas las posiciones). La
			// amortización es devolución de capital, no ganancia: NO cuenta acá.
			if (String(r.fecha).startsWith(anioActual)) rentaAnioUSD += aUSD(r.monto_renta ?? 0, r.moneda, vd);
			// PPV: solo la posición abierta actual (fecha >= inicio del episodio vivo).
			const desde = episodioDesde[r.activo_id];
			if (!desde || r.fecha < desde) continue; // pertenece a una posición ya cerrada
			const total = (r.monto_renta ?? 0) + (r.monto_amort ?? 0);
			const rUSD = aUSD(total, r.moneda, vd);            // para gananciaUSD
			const rNat = a.moneda === 'USD' ? rUSD : rUSD * vd; // en la moneda del activo, para el PPV
			(rentaAgg[r.activo_id] ??= { rec: 0, recUSD: 0 });
			rentaAgg[r.activo_id].rec += rNat;
			rentaAgg[r.activo_id].recUSD += rUSD;
		}
		realizadoAnioActual = realizadoAnio + rentaAnioUSD;

		const hold: any[] = [];
		const buck: Record<string, number> = { Fija: 0, Mixta: 0, Variable: 0, Liquido: 0 };
		let tUSD = 0; let noRealUSD = 0;
		for (const [aid, q] of Object.entries(lotes)) {
			const u = q.reduce((s, l) => s + l.u, 0);
			if (u < 1e-6) continue;
			const a = aMap[Number(aid)];
			const costoNat = q.reduce((s, l) => s + l.u * l.pNat, 0);  // costo de lo que queda (fallback)
			const costoUSD = q.reduce((s, l) => s + l.u * l.pUSD, 0);  // costo USD de lo que queda (para "no realizado")
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
			noRealUSD += mercadoUSD - costoUSD;
			buck[a.renta] = (buck[a.renta] ?? 0) + mercadoUSD; tUSD += mercadoUSD;
			hold.push({ id: Number(aid), nombre: a.nombre, tipo: a.tipo, renta: a.renta, moneda: a.moneda,
				exposicion: a.exposicion ?? (a.moneda === 'USD' || a.tipo === 'CEDEAR' ? 'Dolar' : 'Peso'),
				unidades: u, ppc, ppv, precioActual: pa, mercado,
				gananciaUSD, mercadoUSD });
		}
		noRealizadoTotal = noRealUSD;

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

		// Detalle del mix: activos + líquido, agrupados por renta (mismo orden que las barras)
		const liqRows = ['ARS', 'USD']
			.map((mon) => {
				const saldo = bal[mon] ?? 0;
				const valUSD = mon === 'USD' ? saldo : saldo / dolar;
				return { renta: 'Liquido', tipo: 'Caja', nombre: 'Líquido ' + mon, mercadoUSD: valUSD };
			})
			.filter((r) => r.mercadoUSD > 0);
		const filasMix = [
			...hold.map((h) => ({ renta: h.renta, tipo: h.tipo, nombre: h.nombre, mercadoUSD: h.mercadoUSD })),
			...liqRows
		];
		const ordenRenta: Record<string, number> = {};
		buckets.forEach((b, i) => (ordenRenta[b.renta] = i));
		filasMix.sort((a, b) => (ordenRenta[a.renta] ?? 99) - (ordenRenta[b.renta] ?? 99) || b.mercadoUSD - a.mercadoUSD);
		detalleMix = filasMix.map((r) => ({ ...r, pct: tUSD ? r.mercadoUSD / tUSD : 0 }));

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
	const nf = (n: number) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 });
	const colorRenta: Record<string, string> = { Fija: '#2e7d32', Mixta: '#1a73e8', Variable: '#e8710a', Liquido: '#888' };
</script>

<div class="titulo-guia">
	<h1>Inversiones</h1>
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

	<div class="moneda-fija"><span class="moneda-lbl">Valuado en USD</span> <span class="moneda-badge">al dólar MEP (bolsa) {money(dolar, 'ARS')}{dolarFecha ? ' · ' + fmtFecha(dolarFecha) : ''}</span></div>

	<div class="resumen">
		<div class="card"><span>Cartera total (≈USD)</span><strong>{usd(totalUSD)}</strong></div>
		<div class="card"><span>Ganancia realizada {anioActual} (USD)</span><strong class={realizadoAnioActual >= 0 ? 'pos' : 'neg'}>{usd(realizadoAnioActual, 2)}</strong></div>
		<div class="card"><span>Ganancia no realizada (USD)</span><strong class={noRealizadoTotal >= 0 ? 'pos' : 'neg'}>{usd(noRealizadoTotal, 2)}</strong></div>
	</div>

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

	<h2>Cartera actual</h2>
	<div class="preciosbar">
		<button class="btn btn-secondary" onclick={onActualizarPrecios} disabled={actualizandoPrecios}>{actualizandoPrecios ? 'Actualizando…' : '⟳ Actualizar precios'}</button>
		<a href="/config-tickers" class="btn btn-secondary">🎯 Tickers</a>
		<span class="preciostamp">Precios: <strong>{fmtFechaHora(preciosActualizadosEn)}</strong>{#if preciosMsg} · {preciosMsg}{/if}</span>
	</div>
	<table>
		<thead><tr><th>Tipo</th><th>Activo</th>
			<th class="num hl">PPC</th><th class="num hl">PPV</th><th class="num">Precio mercado</th><th class="num hl">Result. Real</th></tr></thead>
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
					<td class="num hl {h.gananciaUSD >= 0 ? 'pos' : 'neg'}">{usd(h.gananciaUSD)}</td>
				</tr>
			{/each}
			{#if cartera.length === 0}<tr><td colspan="6" class="vacio">No tenés activos en cartera.</td></tr>{/if}
		</tbody>
	</table>
	<p class="nota">
		<strong>PPC</strong> (Precio Promedio de Compra): precio promedio de las compras de cada activo.<br />
		<strong>PPV</strong> (Precio Promedio de Venta): precio promedio de salida — recuperado en ventas, rentas y amortizaciones + tu tenencia a precio actual.<br />
		• <strong>Verde</strong> si está por encima del PPC (ganás en la moneda del activo).<br />
		• <strong>Rojo</strong> si está por debajo.<br />
		<strong>Resultado</strong> = resultado de la tenencia real, evaluado en USD (ventas parciales + tenencia).<br />
		• La brecha entre el PPV verde y un Resultado rojo es ganancia nominal con pérdida real.
	</p>

	<div class="graf-fila">
		<div class="graf">
			<h2>Exposición al tipo de cambio (≈USD)</h2>
			{#if exposicion.tot > 0}
				<div class="bars">
					{#each exposicion.filas as f (f.clave)}
						<div class="barrow"><span class="lbl">{f.label}</span>
							<div class="track"><div class="bar" style="width:{f.pct * 100}%; background:{f.color}"></div></div>
							<span class="val">{usd(f.v)} · {(f.pct * 100).toFixed(0)}%</span></div>
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
						<div class="track"><div class="bar" style="width:{b.pct * 100}%; background:{colorRenta[b.renta]}"></div></div>
						<span class="val">{usd(b.v)} · {(b.pct * 100).toFixed(0)}%</span></div>
				{/each}
			</div>
		</div>
	</div>
	{#if exposicion.tot > 0}
		<p class="nota">Exposición: a qué se mueve tu cartera, no en qué moneda cotiza — <strong>Dólar</strong> sigue al tipo de cambio (USD, CEDEARs, dollar-linked), <strong>CER</strong> sigue la inflación, <strong>Peso</strong> no cubre ante una devaluación. Incluye liquidez; la exposición de cada activo la fijás en <a href="/config-tickers" class="link">Configurar tickers</a>.</p>
	{/if}

	<h2>Detalle del mix</h2>
	<table class="mix">
		<thead><tr><th>Renta</th><th>Tipo</th><th>Activo</th><th class="num">% del total</th></tr></thead>
		<tbody>
			{#each detalleMix as d, i (d.renta + d.nombre)}
				<tr class:grupo={i === 0 || detalleMix[i - 1].renta !== d.renta}>
					<td class="renta" style="color:{colorRenta[d.renta]}">{i === 0 || detalleMix[i - 1].renta !== d.renta ? d.renta : ''}</td>
					<td>{d.tipo}</td>
					<td>{d.nombre}</td>
					<td class="num">{(d.pct * 100).toFixed(1)}%</td>
				</tr>
			{/each}
			{#if detalleMix.length === 0}<tr><td colspan="4" class="vacio">Sin posiciones todavía.</td></tr>{/if}
		</tbody>
	</table>

	<p class="nota">≈USD al dólar más reciente (${nf(dolar)}). "Guardar Cartera" toma una foto del valor actual para la pantalla de Evolución.</p>
{/if}

<style>
:global(body) { max-width: 980px; margin: 0 auto; padding: 16px; }
	h2 { font-size: 1.05rem; margin-top: 20px; }
	h3 { margin: 0 0 4px; font-size: 1rem; }
	.topbar { display: flex; gap: 8px; flex-wrap: wrap; }
	.preciosbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 8px 0; }
	.preciostamp { font-size: 0.78rem; color: var(--text-dim); }
	.preciostamp strong { color: var(--text); }
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
	.card { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 8px 9px; display: flex; flex-direction: column; min-width: 0; }
	.card span { font-size: clamp(0.58rem, 2.4vw, 0.72rem); color: var(--text-dim); }
	.card strong { font-size: clamp(0.82rem, 3.4vw, 1.05rem); white-space: nowrap; }

	/* Franja de liquidez */
	.liquidez { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin: 0 0 12px; }
	.liqcard { border: 1px solid var(--border); background: rgba(74, 222, 128, 0.06); border-radius: 8px; padding: 8px 9px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.liqcard span { font-size: clamp(0.58rem, 2.4vw, 0.72rem); color: var(--text-dim); }
	.liqval { display: flex; align-items: center; gap: 6px; }
	.liqval strong { font-size: clamp(0.82rem, 3.4vw, 1.05rem); white-space: nowrap; }
	.liqedit { display: flex; align-items: center; gap: 4px; }
	.liqedit input { width: 110px; padding: 3px 5px; font-size: 0.95rem; }

	table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
	th, td { padding: 5px 7px; text-align: left; }
	td.num { text-align: right; white-space: nowrap; }
	th.num { text-align: center; }

	/* Detalle del mix */
	table.mix { max-width: 640px; margin-top: 6px; }
	table.mix td.renta { font-weight: 700; white-space: nowrap; }
	table.mix tr.grupo td { border-top: 2px solid var(--border) !important; }
	th.hl, td.hl { background: rgba(91, 157, 255, 0.08); }
	.vacio { text-align: center; color: var(--text-dim); font-style: italic; }
	.precioedit input { width: 90px; padding: 2px 4px; }
	/* Los dos gráficos de barras, lado a lado (colapsan a uno en pantallas angostas) */
	.graf-fila { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; align-items: start; }
	.graf h2 { margin-top: 16px; }
	@media (max-width: 620px) { .graf-fila { grid-template-columns: 1fr; } }
	.bars { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
	.barrow { display: flex; align-items: center; gap: 8px; font-size: 0.82rem; }
	.lbl { width: 64px; color: var(--text-dim); flex-shrink: 0; }
	.track { flex: 1; background: var(--surface-2); border-radius: 4px; height: 32px; overflow: hidden; }
	.bar { height: 100%; }
	.val { width: 130px; text-align: right; color: var(--text); flex-shrink: 0; white-space: nowrap; }
	.nota { font-size: 0.8rem; color: var(--text-dim); margin-top: 12px; }
	.pos { color: var(--pos); }
	.neg { color: var(--neg); }
</style>

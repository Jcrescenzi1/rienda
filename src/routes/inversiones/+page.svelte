<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import { parseNum, esNumValido, formatNum, soloNum, fmtFecha } from '$lib/format';

	let cargando = $state(true);
	let cartera = $state<any[]>([]);
	let realizadoAnioActual = $state(0);
	let noRealizadoTotal = $state(0);
	let buckets = $state<any[]>([]);
	let ledger = $state<any[]>([]);
	let cajaLedger = $state<any[]>([]);
	let dolar = $state(1);
	let totalUSD = $state(0);
	let liqSaldos = $state<Record<string, number>>({ ARS: 0, USD: 0 });

	let cuentas = $state<any[]>([]);
	let activosList = $state<any[]>([]);

	// Filtros del libro diario
	let filtroActivo = $state<string>('');
	let filtroDesde = $state('');
	let filtroHasta = $state('');

	let showForm = $state(false);
	let fAccion = $state<'Compra' | 'Venta' | 'Ingreso' | 'Retiro' | 'Convertir'>('Compra');
	let fCuenta = $state(''); let fCuentaNueva = $state(''); let fActivo = $state('');
	let fFecha = $state(new Date().toISOString().slice(0, 10));
	let fUnidades = $state<number | null>(null);
	let fMonto = $state<number | null>(null);
	let fValorDolar = $state<number | null>(null);
	let fPago = $state<'ARS' | 'USD'>('USD');
	let fMoneda = $state<'ARS' | 'USD'>('ARS');
	let naTicker = $state(''); let naNombre = $state(''); let naTipo = $state('Accion');
	let naRenta = $state('Variable'); let naMoneda = $state('USD');
	let fMsg = $state('');

	let editId = $state<number | null>(null);
	let editPrecio = $state<number | null>(null);
	let editLiq = $state<string | null>(null);
	let editSaldo = $state<number | null>(null);

	// Guardar Cartera (foto)
	let showFoto = $state(false);
	let fFlujo = $state(0); let fotoValorUSD = $state(0); let fotoValorARS = $state(0); let fotoDolar = $state(1);
	let fotoFecha = $state(new Date().toISOString().slice(0, 10));
	let fotoMsg = $state('');

	const toUSD = (m: number, mon: string, vd: number | null) => (mon === 'USD' ? m : vd ? m / vd : 0);
	const anioActual = new Date().getFullYear().toString();

	// Query del libro diario, separada para no recalcular toda la cartera al filtrar.
	async function cargarLedger() {
		let sql = `SELECT t.id, t.fecha, a.nombre, a.tipo, a.moneda, t.operacion, t.unidades, t.precio
			FROM transaccion t JOIN activo a ON a.id = t.activo_id WHERE t.perfil_id = 1`;
		const params: any[] = [];
		if (filtroActivo) { sql += ' AND t.activo_id = ?'; params.push(Number(filtroActivo)); }
		if (filtroDesde) { sql += ' AND t.fecha >= ?'; params.push(filtroDesde); }
		if (filtroHasta) { sql += ' AND t.fecha <= ?'; params.push(filtroHasta); }
		sql += ' ORDER BY t.fecha DESC, t.id DESC';
		if (!filtroDesde && !filtroHasta) sql += ' LIMIT 40';
		ledger = (await query(sql, params)) as any[];
	}

	async function cargarTodo() {
		const dq = (await query("SELECT valor FROM cotizacion_dolar WHERE perfil_id=1 AND casa='bolsa' ORDER BY fecha DESC LIMIT 1")) as any[];
		dolar = dq[0]?.valor ?? 1;
		if (fValorDolar == null) fValorDolar = dolar;

		cuentas = (await query('SELECT id, nombre FROM cuenta_inversion WHERE perfil_id=1 AND activa=1 ORDER BY nombre')) as any[];
		activosList = (await query('SELECT id, ticker, nombre, tipo, moneda FROM activo WHERE perfil_id=1 AND activo=1 ORDER BY nombre')) as any[];

		const activos = (await query('SELECT id, nombre, tipo, renta, moneda, precio_actual FROM activo WHERE perfil_id=1')) as any[];
		const aMap: Record<number, any> = {};
		for (const a of activos) aMap[a.id] = a;

		const txs = (await query('SELECT activo_id, operacion, unidades, precio, fecha, valor_dolar FROM transaccion WHERE perfil_id=1 ORDER BY activo_id, fecha, id')) as any[];
		const lotes: Record<number, { u: number; pNat: number; pUSD: number }[]> = {};
		let realAnio = 0;
		for (const t of txs) {
			const a = aMap[t.activo_id];
			lotes[t.activo_id] ??= [];
			if (t.operacion === 'Compra') {
				lotes[t.activo_id].push({ u: t.unidades, pNat: t.precio, pUSD: toUSD(t.precio, a.moneda, t.valor_dolar) });
			} else {
				let rem = t.unidades; const pvUSD = toUSD(t.precio, a.moneda, t.valor_dolar);
				const q = lotes[t.activo_id];
				while (rem > 1e-9 && q.length) {
					const lote = q[0]; const take = Math.min(rem, lote.u);
					if (t.fecha.slice(0, 4) === anioActual) realAnio += take * (pvUSD - lote.pUSD);
					lote.u -= take; rem -= take;
					if (lote.u < 1e-9) q.shift();
				}
			}
		}
		realizadoAnioActual = realAnio;

		const hold: any[] = [];
		const buck: Record<string, number> = { Fija: 0, Mixta: 0, Variable: 0, Liquido: 0 };
		let tUSD = 0; let noRealUSD = 0;
		for (const [aid, q] of Object.entries(lotes)) {
			const u = q.reduce((s, l) => s + l.u, 0);
			if (u < 1e-6) continue;
			const a = aMap[Number(aid)];
			const costo = q.reduce((s, l) => s + l.u * l.pNat, 0);
			const costoUSD = q.reduce((s, l) => s + l.u * l.pUSD, 0);
			const ppc = costo / u; const pa = a.precio_actual ?? ppc; const mercado = u * pa;
			const mercadoUSD = a.moneda === 'USD' ? mercado : mercado / dolar;
			noRealUSD += mercadoUSD - costoUSD;
			buck[a.renta] = (buck[a.renta] ?? 0) + mercadoUSD; tUSD += mercadoUSD;
			hold.push({ id: Number(aid), esLiq: false, nombre: a.nombre, tipo: a.tipo, renta: a.renta, moneda: a.moneda,
				monto: costo, unidades: u, ppc, ppv: pa, precioActual: pa, mercado,
				resultado: mercado - costo, pctRes: costo ? (mercado - costo) / costo : 0, mercadoUSD });
		}
		noRealizadoTotal = noRealUSD;

		const anchor = (await query('SELECT moneda, saldo FROM liquidez WHERE perfil_id=1')) as any[];
		const movc = (await query('SELECT moneda, COALESCE(SUM(monto),0) s FROM mov_caja WHERE perfil_id=1 GROUP BY moneda')) as any[];
		const tcash = (await query("SELECT moneda_pago m, COALESCE(SUM(CASE WHEN operacion='Venta' THEN monto_pago ELSE -monto_pago END),0) s FROM transaccion WHERE perfil_id=1 AND monto_pago IS NOT NULL GROUP BY moneda_pago")) as any[];
		const bal: Record<string, number> = { ARS: 0, USD: 0 };
		for (const a of anchor) bal[a.moneda] = (bal[a.moneda] ?? 0) + a.saldo;
		for (const r of movc) bal[r.moneda] = (bal[r.moneda] ?? 0) + r.s;
		for (const r of tcash) if (r.m) bal[r.m] = (bal[r.m] ?? 0) + r.s;
		liqSaldos = bal;
		for (const mon of ['ARS', 'USD']) {
			const saldo = bal[mon] ?? 0;
			const valUSD = mon === 'USD' ? saldo : saldo / dolar;
			buck['Liquido'] += valUSD; tUSD += valUSD;
			hold.push({ id: 'liq-' + mon, esLiq: true, nombre: 'Líquido ' + mon, tipo: 'Líquido', renta: 'Liquido', moneda: mon,
				monto: saldo, unidades: 0, ppc: 0, ppv: 0, precioActual: 0, mercado: saldo, resultado: 0, pctRes: 0, mercadoUSD: valUSD });
		}

		for (const h of hold) h.peso = tUSD ? h.mercadoUSD / tUSD : 0;
		hold.sort((x, y) => y.mercadoUSD - x.mercadoUSD);
		cartera = hold; totalUSD = tUSD;
		buckets = Object.entries(buck).filter(([, v]) => v > 0).map(([renta, v]) => ({ renta, v, pct: tUSD ? v / tUSD : 0 })).sort((a, b) => b.v - a.v);

		await cargarLedger();
		cajaLedger = (await query('SELECT id, fecha, accion, moneda, monto, grupo FROM mov_caja WHERE perfil_id=1 ORDER BY fecha DESC, id DESC LIMIT 30')) as any[];

		cargando = false;
	}

	onMount(cargarTodo);

	// Al cambiar cualquier filtro del libro, recargo solo el ledger (no toda la cartera).
	$effect(() => {
		filtroActivo; filtroDesde; filtroHasta;
		if (!cargando) cargarLedger();
	});

	function limpiarFiltros() {
		filtroActivo = '';
		filtroDesde = '';
		filtroHasta = '';
	}

	let monedaActivo = $derived.by(() => {
		if (fActivo === 'nuevo') return naMoneda;
		const a = activosList.find((x) => String(x.id) === fActivo);
		return a ? a.moneda : 'USD';
	});
	let esTrade = $derived(fAccion === 'Compra' || fAccion === 'Venta');

	async function guardar() {
		fMsg = '';
		const monto = Number(fMonto);
		if (!fFecha) return (fMsg = 'Falta la fecha');
		if (!monto || monto <= 0) return (fMsg = 'Monto inválido');
		try {
			if (esTrade) {
				const u = Number(fUnidades);
				if (!u || u <= 0) return (fMsg = 'Unidades inválidas');
				if (!fCuenta) return (fMsg = 'Elegí cuenta');
				if (!fActivo) return (fMsg = 'Elegí activo');
				if (fCuenta === 'nueva' && !fCuentaNueva.trim()) return (fMsg = 'Nombre de cuenta');
				if (fActivo === 'nuevo' && (!naTicker.trim() || !naNombre.trim())) return (fMsg = 'Completá ticker y nombre');
				let cuentaId: number;
				if (fCuenta === 'nueva') {
					const r = (await query("INSERT INTO cuenta_inversion (perfil_id,nombre,tipo) VALUES (1,?,'broker') RETURNING id", [fCuentaNueva.trim()])) as any[];
					cuentaId = r[0].id;
				} else cuentaId = Number(fCuenta);
				let activoId: number; let monA: string;
				if (fActivo === 'nuevo') {
					const r = (await query('INSERT INTO activo (perfil_id,ticker,nombre,tipo,renta,moneda) VALUES (1,?,?,?,?,?) RETURNING id',
						[naTicker.trim(), naNombre.trim(), naTipo, naRenta, naMoneda])) as any[];
					activoId = r[0].id; monA = naMoneda;
				} else { activoId = Number(fActivo); monA = monedaActivo; }
				if (fAccion === 'Venta') {
					const neto = (await query("SELECT COALESCE(SUM(CASE WHEN operacion='Compra' THEN unidades ELSE -unidades END),0) AS n FROM transaccion WHERE perfil_id=1 AND activo_id=?", [activoId])) as any[];
					if (neto[0].n + 1e-9 < u) return (fMsg = `No podés vender ${u}; tenés ${neto[0].n.toFixed(2)}`);
				}
				const precio = monto / u;
				let montoPago = monto;
				if (fPago !== monA) montoPago = monA === 'USD' && fPago === 'ARS' ? monto * Number(fValorDolar) : monto / Number(fValorDolar);
				await query('INSERT INTO transaccion (perfil_id,activo_id,cuenta_inversion_id,fecha,operacion,unidades,precio,valor_dolar,moneda_pago,monto_pago) VALUES (1,?,?,?,?,?,?,?,?,?)',
					[activoId, cuentaId, fFecha, fAccion, u, precio, fValorDolar, fPago, montoPago]);
				await query('UPDATE activo SET precio_actual=?, precio_actualizado_en=? WHERE id=?', [precio, fFecha, activoId]);
				fMsg = `${fAccion} guardada ✅`; fUnidades = null; fMonto = null; fActivo = ''; fCuentaNueva = ''; naTicker = ''; naNombre = '';
			} else if (fAccion === 'Ingreso' || fAccion === 'Retiro') {
				const signo = fAccion === 'Ingreso' ? 1 : -1;
				await query('INSERT INTO mov_caja (perfil_id,fecha,accion,moneda,monto) VALUES (1,?,?,?,?)', [fFecha, fAccion, fMoneda, signo * monto]);
				fMsg = `${fAccion} de ${fMoneda} guardado ✅`; fMonto = null;
			} else if (fAccion === 'Convertir') {
				const vd = Number(fValorDolar);
				if (!vd || vd <= 0) return (fMsg = 'Valor dólar inválido');
				const destinoMon = fMoneda === 'ARS' ? 'USD' : 'ARS';
				const montoDestino = fMoneda === 'ARS' ? monto / vd : monto * vd;
				const grupo = 'conv-' + Date.now();
				await query('INSERT INTO mov_caja (perfil_id,fecha,accion,moneda,monto,grupo) VALUES (1,?,?,?,?,?)', [fFecha, 'Convertir', fMoneda, -monto, grupo]);
				await query('INSERT INTO mov_caja (perfil_id,fecha,accion,moneda,monto,grupo) VALUES (1,?,?,?,?,?)', [fFecha, 'Convertir', destinoMon, montoDestino, grupo]);
				fMsg = `Convertido ${fMoneda}→${destinoMon} ✅`; fMonto = null;
			}
			await cargarTodo();
		} catch (e: any) { fMsg = 'Error: ' + (e?.message ?? String(e)); }
	}

	async function borrarTx(id: number) {
		if (!confirm('¿Borrar esta operación?')) return;
		await query('DELETE FROM transaccion WHERE id=?', [id]); await cargarTodo();
	}
	async function borrarCaja(m: any) {
		if (!confirm('¿Borrar este movimiento de caja?')) return;
		if (m.grupo) await query('DELETE FROM mov_caja WHERE grupo=?', [m.grupo]);
		else await query('DELETE FROM mov_caja WHERE id=?', [m.id]);
		await cargarTodo();
	}
	function abrirEdit(h: any) { editId = h.id; editPrecio = h.precioActual; }
	async function guardarPrecio() {
		if (editId == null || !editPrecio || editPrecio <= 0) { editId = null; return; }
		await query('UPDATE activo SET precio_actual=?, precio_actualizado_en=? WHERE id=?', [editPrecio, new Date().toISOString().slice(0, 10), editId]);
		editId = null; editPrecio = null; await cargarTodo();
	}
	function abrirEditLiq(h: any) { editLiq = h.moneda; editSaldo = h.monto; }
	async function guardarLiq() {
		if (editLiq == null || editSaldo == null || editSaldo < 0) { editLiq = null; return; }
		const ajuste = editSaldo - (liqSaldos[editLiq] ?? 0);
		if (Math.abs(ajuste) > 1e-6)
			await query('INSERT INTO mov_caja (perfil_id,fecha,accion,moneda,monto,nota) VALUES (1,?,?,?,?,?)',
				[new Date().toISOString().slice(0, 10), 'Ajuste', editLiq, ajuste, 'Ajuste de saldo (rendimiento fondo)']);
		editLiq = null; editSaldo = null; await cargarTodo();
	}

	// Guardar Cartera (snapshot)
	async function prepararFoto() {
		fotoMsg = '';
		fotoDolar = dolar;
		fotoValorUSD = totalUSD;
		fotoValorARS = totalUSD * dolar;
		const ult = (await query('SELECT fecha FROM snapshot WHERE perfil_id=1 ORDER BY fecha DESC LIMIT 1')) as any[];
		const ultFecha = ult[0]?.fecha ?? '2000-01-01';
		const fl = (await query("SELECT COALESCE(SUM(CASE WHEN moneda='USD' THEN monto ELSE monto/? END),0) AS f FROM mov_caja WHERE perfil_id=1 AND accion IN ('Ingreso','Retiro') AND fecha > ?", [dolar, ultFecha])) as any[];
		fFlujo = Math.round((fl[0]?.f ?? 0) * 100) / 100;
		showFoto = true;
	}
	async function guardarFoto() {
		try {
			await query('INSERT INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,?,?,?,?,?) ON CONFLICT(perfil_id,fecha) DO UPDATE SET valor_usd=excluded.valor_usd, flujo_usd=excluded.flujo_usd, dolar=excluded.dolar, valor_ars=excluded.valor_ars',
				[fotoFecha, fotoValorUSD, fFlujo, fotoDolar, fotoValorARS]);
			showFoto = false; fotoMsg = '📸 Cartera guardada en Evolución ✅';
			setTimeout(() => (fotoMsg = ''), 3000);
		} catch (e: any) { fotoMsg = 'Error: ' + (e?.message ?? String(e)); }
	}

	const money = (n: number, mon: string, dec = 0) => (mon === 'USD' ? 'U$D ' : '$') + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
	const usd = (n: number, dec = 0) => 'U$D ' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
	const pct = (n: number) => (n >= 0 ? '+' : '') + (n * 100).toFixed(1) + '%';
	const nf = (n: number) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 });
	const colorRenta: Record<string, string> = { Fija: '#2e7d32', Mixta: '#1a73e8', Variable: '#e8710a', Liquido: '#888' };

	const hayFiltro = $derived(!!filtroActivo || !!filtroDesde || !!filtroHasta);
	const rangoTexto = $derived(
		!filtroDesde && !filtroHasta ? 'Últimas 40 operaciones'
		: filtroDesde && filtroHasta ? `Del ${fmtFecha(filtroDesde)} al ${fmtFecha(filtroHasta)}`
		: filtroDesde ? `Desde ${fmtFecha(filtroDesde)} hasta hoy`
		: `Desde el inicio hasta ${fmtFecha(filtroHasta)}`
	);
</script>

<h1>Inversiones</h1>

{#if cargando}
	<p>Cargando…</p>
{:else}
	<div class="topbar">
		<button class="nueva" onclick={() => (showForm = !showForm)}>{showForm ? '✕ Cerrar' : '➕ Nuevo movimiento'}</button>
		<button class="guardarcart" onclick={prepararFoto}>📸 Guardar Cartera</button>
	</div>
	{#if fotoMsg}<p class="msg">{fotoMsg}</p>{/if}

	{#if showFoto}
		<div class="form">
			<h3>Guardar foto de cartera — {fotoFecha}</h3>
			<label>Fecha<input type="date" bind:value={fotoFecha} /></label>
			<p class="hint">Valor actual: <strong>{usd(fotoValorUSD)}</strong> ({money(fotoValorARS, 'ARS')} · dólar {fotoDolar})</p>
			<label>Flujo neto desde la última foto (USD)<input type="number" step="any" bind:value={fFlujo} /></label>
			<div class="botones"><button class="guardar" onclick={guardarFoto}>Guardar</button><button class="cancelar" onclick={() => (showFoto = false)}>Cancelar</button></div>
		</div>
	{/if}

	{#if showForm}
		<div class="form">
			<div class="acciones">
				{#each ['Compra', 'Venta', 'Ingreso', 'Retiro', 'Convertir'] as ac}
					<button type="button" class:activo={fAccion === ac} onclick={() => (fAccion = ac as any)}>{ac}</button>
				{/each}
			</div>
			<label>Fecha<input type="date" bind:value={fFecha} /></label>
			{#if esTrade}
				<label>Cuenta
					<select bind:value={fCuenta}><option value="" disabled>Elegir…</option>
						{#each cuentas as c (c.id)}<option value={String(c.id)}>{c.nombre}</option>{/each}
						<option value="nueva">+ Cuenta nueva…</option></select></label>
				{#if fCuenta === 'nueva'}<label>Nombre cuenta<input bind:value={fCuentaNueva} /></label>{/if}
				<label>Activo
					<select bind:value={fActivo}><option value="" disabled>Elegir…</option>
						{#each activosList as a (a.id)}<option value={String(a.id)}>{a.nombre} ({a.tipo}/{a.moneda})</option>{/each}
						<option value="nuevo">+ Activo nuevo…</option></select></label>
				{#if fActivo === 'nuevo'}
					<div class="nuevo">
						<label>Ticker<input bind:value={naTicker} /></label>
						<label>Nombre<input bind:value={naNombre} /></label>
						<label>Tipo<select bind:value={naTipo}><option>Accion</option><option>CEDEAR</option><option>Bono</option><option>ON</option><option>FCI</option><option>Indice</option></select></label>
						<label>Renta<select bind:value={naRenta}><option>Variable</option><option>Fija</option><option>Mixta</option><option>Liquido</option></select></label>
						<label>Moneda<select bind:value={naMoneda}><option>USD</option><option>ARS</option></select></label>
					</div>
				{/if}
				<label>Unidades<input type="number" step="any" bind:value={fUnidades} /></label>
				<label>Monto en {monedaActivo} (define precio)<input type="number" step="any" bind:value={fMonto} /></label>
				<label>{fAccion === 'Compra' ? 'Pagué' : 'Cobré'} con<select bind:value={fPago}><option>ARS</option><option>USD</option></select></label>
				<label>Valor dólar<input type="number" step="any" bind:value={fValorDolar} /></label>
				{#if fUnidades && fMonto}<p class="hint">Precio: {money(fMonto / fUnidades, monedaActivo, 4)} · {fAccion === 'Compra' ? 'sale' : 'entra'} de Líquido {fPago}</p>{/if}
			{:else if fAccion === 'Ingreso' || fAccion === 'Retiro'}
				<label>Moneda<select bind:value={fMoneda}><option>ARS</option><option>USD</option></select></label>
				<label>Monto<input type="number" step="any" bind:value={fMonto} /></label>
			{:else if fAccion === 'Convertir'}
				<label>Convierto desde<select bind:value={fMoneda}><option>ARS</option><option>USD</option></select></label>
				<label>Monto en {fMoneda}<input type="number" step="any" bind:value={fMonto} /></label>
				<label>Valor dólar<input type="number" step="any" bind:value={fValorDolar} /></label>
				{#if fMonto && fValorDolar}<p class="hint">Entran {money(fMoneda === 'ARS' ? fMonto / fValorDolar : fMonto * fValorDolar, fMoneda === 'ARS' ? 'USD' : 'ARS', 2)} a Líquido {fMoneda === 'ARS' ? 'USD' : 'ARS'}</p>{/if}
			{/if}
			<button class="guardar" onclick={guardar}>Guardar</button>
			{#if fMsg}<p class="msg">{fMsg}</p>{/if}
		</div>
	{/if}

	<div class="resumen">
		<div class="card"><span>Cartera total (≈USD)</span><strong>{usd(totalUSD)}</strong></div>
		<div class="card"><span>Ganancia realizada {anioActual} (USD)</span><strong class={realizadoAnioActual >= 0 ? 'pos' : 'neg'}>{usd(realizadoAnioActual, 2)}</strong></div>
		<div class="card"><span>Ganancia no realizada (USD)</span><strong class={noRealizadoTotal >= 0 ? 'pos' : 'neg'}>{usd(noRealizadoTotal, 2)}</strong></div>
	</div>

	<h2>Cartera actual</h2>
	<table>
		<thead><tr><th>Tipo</th><th>Activo</th><th class="num">Mix</th>
			<th class="num hl">PPC</th><th class="num hl">PPV</th><th class="num">Precio mercado</th><th class="num">Valor mercado</th><th class="num hl">Resultado</th></tr></thead>
		<tbody>
			{#each cartera as h (h.id)}
				<tr class:liqrow={h.esLiq}>
					<td>{h.tipo}</td><td>{h.nombre}</td><td class="pctcol">{(h.peso * 100).toFixed(1)}%</td>
					{#if h.esLiq}
						<td class="num hl">—</td><td class="num hl">—</td><td class="num">—</td>
						<td class="num precioedit">
							{#if editLiq === h.moneda}
								<input type="number" step="any" bind:value={editSaldo} onkeydown={(e) => e.key === 'Enter' && guardarLiq()} />
								<button class="okp" onclick={guardarLiq}>✓</button><button class="cancp" onclick={() => (editLiq = null)}>✕</button>
							{:else}{money(h.mercado, h.moneda)}<button class="lapiz" onclick={() => abrirEditLiq(h)}>✏️</button>{/if}
						</td><td class="num hl">—</td>
					{:else}
						<td class="num hl">{money(h.ppc, h.moneda, 2)}</td><td class="num hl">{money(h.ppv, h.moneda, 2)}</td>
						<td class="num precioedit">
							{#if editId === h.id}
								<input type="number" step="any" bind:value={editPrecio} onkeydown={(e) => e.key === 'Enter' && guardarPrecio()} />
								<button class="okp" onclick={guardarPrecio}>✓</button><button class="cancp" onclick={() => (editId = null)}>✕</button>
							{:else}{money(h.precioActual, h.moneda, 2)}<button class="lapiz" onclick={() => abrirEdit(h)}>✏️</button>{/if}
						</td>
						<td class="num">{money(h.mercado, h.moneda)}</td>
						<td class="num hl {h.resultado >= 0 ? 'pos' : 'neg'}">{money(h.resultado, h.moneda)} ({pct(h.pctRes)})</td>
					{/if}
				</tr>
			{/each}
		</tbody>
	</table>

	<h2>Estructura de renta (≈USD)</h2>
	<div class="bars">
		{#each buckets as b (b.renta)}
			<div class="barrow"><span class="lbl">{b.renta}</span>
				<div class="track"><div class="bar" style="width:{b.pct * 100}%; background:{colorRenta[b.renta]}"></div></div>
				<span class="val">{usd(b.v)} · {(b.pct * 100).toFixed(0)}%</span></div>
		{/each}
	</div>

	<h2>Libro diario</h2>
	<div class="filtros">
		<label>Activo
			<select bind:value={filtroActivo}>
				<option value="">Todos</option>
				{#each activosList as a (a.id)}<option value={String(a.id)}>{a.nombre}</option>{/each}
			</select>
		</label>
		<label>Desde<input type="date" bind:value={filtroDesde} /></label>
		<label>Hasta<input type="date" bind:value={filtroHasta} /></label>
		{#if hayFiltro}<button class="limpiar" onclick={limpiarFiltros}>Limpiar</button>{/if}
	</div>
	<p class="rango">{rangoTexto}</p>

	<div class="fichas">
		{#each ledger as t (t.id)}
			<div class="ficha">
				<div class="ficha-top">
					<span class="ficha-nombre">{t.nombre} <span class="ficha-tipo">({t.tipo})</span></span>
					<span class="ficha-monto">{money(t.unidades * t.precio, t.moneda)}</span>
					<span class="ficha-acc">
						<button class="del" onclick={() => borrarTx(t.id)} title="Borrar">✕</button>
					</span>
				</div>
				<div class="ficha-meta">
					{fmtFecha(t.fecha)} · <span class={t.operacion === 'Compra' ? 'pos' : 'neg'}>{t.operacion}</span> · {nf(t.unidades)} un. × {money(t.precio, t.moneda, 2)}
				</div>
			</div>
		{/each}
		{#if ledger.length === 0}<p class="vacio">No hay operaciones para los filtros seleccionados.</p>{/if}
	</div>

	<h2>Movimientos de caja</h2>
	<div class="fichas">
		{#each cajaLedger as m (m.id)}
			<div class="ficha">
				<div class="ficha-top">
					<span class="ficha-nombre">{m.accion}</span>
					<span class="ficha-monto {m.monto >= 0 ? 'pos' : 'neg'}">{money(m.monto, m.moneda)}</span>
					<span class="ficha-acc">
						<button class="del" onclick={() => borrarCaja(m)} title="Borrar">✕</button>
					</span>
				</div>
				<div class="ficha-meta">{fmtFecha(m.fecha)} · {m.moneda}</div>
			</div>
		{:else}
			<p class="vacio">Sin movimientos todavía</p>
		{/each}
	</div>

	<p class="nota">≈USD al dólar más reciente (${nf(dolar)}). "Guardar Cartera" toma una foto del valor actual para la pantalla de Evolución.</p>
{/if}

<style>
:global(body) { max-width: 980px; margin: 0 auto; padding: 16px; }
	h2 { font-size: 1.05rem; margin-top: 20px; }
	h3 { margin: 0 0 4px; font-size: 1rem; }
	.topbar { display: flex; gap: 8px; flex-wrap: wrap; }
	.nueva { background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
	.guardarcart { background: var(--pos); color: #06281a; font-weight: 600; border: none; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
	.form { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 14px; margin: 12px 0; display: flex; flex-direction: column; gap: 9px; max-width: 400px; }
	.acciones { display: flex; gap: 5px; flex-wrap: wrap; }
	.acciones button { flex: 1; min-width: 70px; padding: 7px 4px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); border-radius: 6px; cursor: pointer; font-size: 0.82rem; }
	.acciones button.activo { background: var(--accent); color: #fff; border-color: var(--accent); }
	.nuevo { border: 1px dashed var(--border); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
	label { display: flex; flex-direction: column; font-size: 0.82rem; color: var(--text-dim); gap: 3px; }
	input, select { padding: 6px; font-size: 0.95rem; }
	.botones { display: flex; gap: 8px; }
	.guardar { padding: 9px; background: var(--pos); color: #06281a; font-weight: 600; border: none; border-radius: 6px; cursor: pointer; }
	.cancelar { padding: 9px 14px; background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
	.hint { font-size: 0.82rem; color: var(--accent); margin: 0; }
	.msg { font-weight: 600; margin: 6px 0; }
	.resumen { display: flex; gap: 10px; flex-wrap: wrap; margin: 12px 0; }
	.card { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 8px 14px; display: flex; flex-direction: column; min-width: 175px; }
	.card span { font-size: 0.72rem; color: var(--text-dim); }
	.card strong { font-size: 1.05rem; }
	table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
	th, td { padding: 5px 7px; text-align: left; }
	td.num { text-align: right; white-space: nowrap; }
	td.pctcol { text-align: center; }
	th.num { text-align: center; }
	th.hl, td.hl { background: rgba(91, 157, 255, 0.08); }
	tr.liqrow { background: rgba(74, 222, 128, 0.06); font-style: italic; }
	.vacio { text-align: center; color: var(--text-dim); font-style: italic; }
	.lapiz { background: none; border: none; cursor: pointer; font-size: 0.8rem; opacity: 0.5; }
	.lapiz:hover { opacity: 1; }
	.precioedit input { width: 90px; padding: 2px 4px; }
	.okp { background: var(--pos); color: #06281a; border: none; border-radius: 4px; cursor: pointer; padding: 1px 6px; margin-left: 2px; }
	.cancp { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 4px; cursor: pointer; padding: 1px 6px; margin-left: 2px; }
	.bars { display: flex; flex-direction: column; gap: 5px; margin-top: 6px; max-width: 640px; }
	.barrow { display: flex; align-items: center; gap: 8px; font-size: 0.82rem; }
	.lbl { width: 70px; color: var(--text-dim); }
	.track { flex: 1; background: var(--surface-2); border-radius: 4px; height: 16px; overflow: hidden; }
	.bar { height: 100%; }
	.val { width: 170px; text-align: right; color: var(--text); }
	.del { background: rgba(248, 113, 113, 0.15); color: var(--neg); border: none; border-radius: 5px; padding: 2px 8px; cursor: pointer; }
	.nota { font-size: 0.8rem; color: var(--text-dim); margin-top: 12px; }

	/* Filtros del libro diario */
	.filtros { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end; margin: 8px 0; }
	.filtros label { flex: 1; min-width: 110px; }
	.filtros .limpiar { padding: 7px 12px; background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
	.rango { font-size: 0.8rem; color: var(--text-dim); margin: 0 0 8px; font-weight: 600; }

	/* Fichas (libro diario + movimientos de caja) */
	.fichas { display: flex; flex-direction: column; gap: 8px; }
	.ficha { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 10px 12px; }
	.ficha-top { display: flex; align-items: baseline; gap: 10px; }
	.ficha-nombre { font-weight: 600; font-size: 0.95rem; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.ficha-tipo { font-weight: 400; color: var(--text-dim); font-size: 0.82rem; }
	.ficha-monto { font-weight: 700; white-space: nowrap; }
	.ficha-acc { white-space: nowrap; flex-shrink: 0; }
	.ficha-meta { font-size: 0.78rem; color: var(--text-dim); margin-top: 4px; }
	.pos { color: var(--pos); }
	.neg { color: var(--neg); }
</style>
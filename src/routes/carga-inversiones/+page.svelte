<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import { fmtFecha, hoyISO, parseNum, formatNum, soloNum } from '$lib/format';
	import { dolarActual } from '$lib/cartera';
	import Guia from '$lib/Guia.svelte';

	let cuentas = $state<any[]>([]);
	let activosList = $state<any[]>([]);
	let ledger = $state<any[]>([]);
	let cajaLedger = $state<any[]>([]);
	let rentaLedger = $state<any[]>([]);

	// Filtros del libro diario
	let filtroActivo = $state<string>('');
	let filtroDesde = $state('');
	let filtroHasta = $state('');

	// Formulario
	let fAccion = $state<'Compra' | 'Venta' | 'Renta' | 'Ingreso' | 'Retiro' | 'Convertir'>('Compra');
	let fCuenta = $state(''); let fCuentaNueva = $state(''); let fActivo = $state('');
	let fFecha = $state(hoyISO());
	let fUnidades = $state('');
	let fMonto = $state('');
	// Renta y Amortización: dos montos en la misma moneda + TC opcional (si se deja
	// vacío, se usa el MEP de la fecha del movimiento).
	let fRenta = $state(''); let fAmort = $state(''); let fTcRenta = $state('');
	let fValorDolar = $state('');
	let fPago = $state<'ARS' | 'USD'>('USD');
	let fMoneda = $state<'ARS' | 'USD'>('ARS');
	let naTicker = $state(''); let naNombre = $state(''); let naTipo = $state('Accion');
	let naRenta = $state('Variable'); let naMoneda = $state('USD');
	let fMsg = $state('');

	// Versión numérica de los campos de texto (formato AR: "1.234,56")
	const uN = $derived(parseNum(fUnidades));
	const mN = $derived(parseNum(fMonto));
	const vdN = $derived(parseNum(fValorDolar));

	let monedaActivo = $derived.by(() => {
		if (fActivo === 'nuevo') return naMoneda;
		const a = activosList.find((x) => String(x.id) === fActivo);
		return a ? a.moneda : 'USD';
	});
	let esTrade = $derived(fAccion === 'Compra' || fAccion === 'Venta');
	const rentaN = $derived(parseNum(fRenta));
	const amortN = $derived(parseNum(fAmort));

	// En Renta, la moneda por defecto es la del activo (editable). Se re-sugiere al
	// cambiar de activo; si el usuario la toca a mano, respeta hasta el próximo activo.
	$effect(() => {
		if (fAccion === 'Renta' && fActivo && fActivo !== 'nuevo') fMoneda = monedaActivo as 'ARS' | 'USD';
	});

	async function cargarBase() {
		const dolar = await dolarActual();
		if (!fValorDolar) fValorDolar = formatNum(dolar, 2);
		cuentas = (await query('SELECT id, nombre FROM cuenta_inversion WHERE perfil_id=1 AND activa=1 ORDER BY nombre')) as any[];
		activosList = (await query('SELECT id, ticker, nombre, tipo, moneda FROM activo WHERE perfil_id=1 AND activo=1 ORDER BY nombre')) as any[];
	}

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

	async function cargarCaja() {
		cajaLedger = (await query('SELECT id, fecha, accion, moneda, monto, grupo FROM mov_caja WHERE perfil_id=1 ORDER BY fecha DESC, id DESC LIMIT 30')) as any[];
	}

	async function cargarRenta() {
		rentaLedger = (await query(
			`SELECT r.id, r.fecha, a.nombre, r.moneda, r.monto_renta, r.monto_amort
			 FROM renta_activo r JOIN activo a ON a.id = r.activo_id
			 WHERE r.perfil_id=1 ORDER BY r.fecha DESC, r.id DESC LIMIT 30`
		)) as any[];
	}

	onMount(() => { cargarBase(); cargarCaja(); cargarRenta(); });

	// Al cambiar cualquier filtro, recarga el libro (también corre al montar).
	$effect(() => {
		filtroActivo; filtroDesde; filtroHasta;
		const timer = setTimeout(cargarLedger, 250);
		return () => clearTimeout(timer);
	});

	function limpiarFiltros() {
		filtroActivo = '';
		filtroDesde = '';
		filtroHasta = '';
	}

	// MEP (dólar bolsa) en/antes de una fecha; TC por defecto de la renta si no cargan uno.
	async function mepDeFecha(fecha: string): Promise<number | null> {
		const r = (await query("SELECT valor FROM cotizacion_dolar WHERE perfil_id=1 AND casa='bolsa' AND fecha <= ? ORDER BY fecha DESC LIMIT 1", [fecha])) as any[];
		return r[0]?.valor ?? null;
	}

	async function guardar() {
		fMsg = '';
		const monto = mN;
		if (!fFecha) return (fMsg = 'Falta la fecha');
		// Renta usa dos montos propios (renta/amort), no fMonto: se valida en su rama.
		if (fAccion !== 'Renta' && (!Number.isFinite(monto) || monto <= 0)) return (fMsg = 'Monto inválido');
		try {
			if (fAccion === 'Renta') {
				if (!fActivo || fActivo === 'nuevo') return (fMsg = 'Elegí un activo');
				const renta = Number.isFinite(rentaN) && rentaN > 0 ? rentaN : 0;
				const amort = Number.isFinite(amortN) && amortN > 0 ? amortN : 0;
				if (renta + amort <= 0) return (fMsg = 'Cargá al menos un monto (renta o amortización)');
				const aMon = monedaActivo;
				const necesitaVd = !(fMoneda === 'USD' && aMon === 'USD');
				// TC: el que cargaron; si lo dejan vacío, el MEP de la fecha del movimiento.
				const tcManual = parseNum(fTcRenta);
				let vd = Number.isFinite(tcManual) && tcManual > 0 ? tcManual : (await mepDeFecha(fFecha)) ?? NaN;
				if (necesitaVd && !(Number.isFinite(vd) && vd > 0)) return (fMsg = 'No hay cotización del dólar para esa fecha; cargá el tipo de cambio');
				await query(
					'INSERT INTO renta_activo (perfil_id,activo_id,fecha,moneda,monto_renta,monto_amort,valor_dolar) VALUES (1,?,?,?,?,?,?)',
					[Number(fActivo), fFecha, fMoneda, renta, amort, necesitaVd && Number.isFinite(vd) ? vd : null]
				);
				fMsg = 'Renta y amortización guardada ✅'; fRenta = ''; fAmort = ''; fTcRenta = '';
				await cargarBase(); await cargarRenta();
				return;
			}
			if (esTrade) {
				const u = uN;
				if (!Number.isFinite(u) || u <= 0) return (fMsg = 'Unidades inválidas');
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
					// Exposición FX por defecto (editable después en Configurar tickers).
					const expo = naMoneda === 'USD' || naTipo === 'CEDEAR' ? 'Dolar' : 'Peso';
					const r = (await query('INSERT INTO activo (perfil_id,ticker,nombre,tipo,renta,moneda,exposicion) VALUES (1,?,?,?,?,?,?) RETURNING id',
						[naTicker.trim(), naNombre.trim(), naTipo, naRenta, naMoneda, expo])) as any[];
					activoId = r[0].id; monA = naMoneda;
				} else { activoId = Number(fActivo); monA = monedaActivo; }
				if (fAccion === 'Venta') {
					const neto = (await query("SELECT COALESCE(SUM(CASE WHEN operacion='Compra' THEN unidades ELSE -unidades END),0) AS n FROM transaccion WHERE perfil_id=1 AND activo_id=?", [activoId])) as any[];
					if (neto[0].n + 1e-9 < u) return (fMsg = `No podés vender ${u}; tenés ${neto[0].n.toFixed(2)}`);
				}
				// El monto se carga en la moneda en que pagaste/cobraste (fPago).
				// Si difiere de la moneda del activo, se convierte con el valor dólar
				// para derivar el precio: nunca tenés que convertir de cabeza.
				const montoPago = monto; // en fPago
				let montoActivo = monto; // en la moneda del activo
				if (fPago !== monA) {
					if (!Number.isFinite(vdN) || vdN <= 0) return (fMsg = 'Valor dólar inválido');
					montoActivo = monA === 'USD' ? monto / vdN : monto * vdN;
				}
				const precio = montoActivo / u;
				await query('INSERT INTO transaccion (perfil_id,activo_id,cuenta_inversion_id,fecha,operacion,unidades,precio,valor_dolar,moneda_pago,monto_pago) VALUES (1,?,?,?,?,?,?,?,?,?)',
					[activoId, cuentaId, fFecha, fAccion, u, precio, Number.isFinite(vdN) ? vdN : null, fPago, montoPago]);
				// Actualiza el precio de mercado SOLO si esta operación es igual o más
				// nueva que la última actualización: una carga retroactiva no pisa el precio.
				const pa = (await query('SELECT precio_actualizado_en FROM activo WHERE id=? AND perfil_id=1', [activoId])) as any[];
				const ultAct = pa[0]?.precio_actualizado_en;
				if (!ultAct || fFecha >= ultAct) {
					await query('UPDATE activo SET precio_actual=?, precio_actualizado_en=? WHERE id=? AND perfil_id=1', [precio, fFecha, activoId]);
				}
				fMsg = `${fAccion} guardada ✅`; fUnidades = ''; fMonto = ''; fActivo = ''; fCuentaNueva = ''; naTicker = ''; naNombre = '';
			} else if (fAccion === 'Ingreso' || fAccion === 'Retiro') {
				const signo = fAccion === 'Ingreso' ? 1 : -1;
				await query('INSERT INTO mov_caja (perfil_id,fecha,accion,moneda,monto) VALUES (1,?,?,?,?)', [fFecha, fAccion, fMoneda, signo * monto]);
				fMsg = `${fAccion} de ${fMoneda} guardado ✅`; fMonto = '';
			} else if (fAccion === 'Convertir') {
				const vd = vdN;
				if (!Number.isFinite(vd) || vd <= 0) return (fMsg = 'Valor dólar inválido');
				const destinoMon = fMoneda === 'ARS' ? 'USD' : 'ARS';
				const montoDestino = fMoneda === 'ARS' ? monto / vd : monto * vd;
				const grupo = 'conv-' + Date.now();
				await query('INSERT INTO mov_caja (perfil_id,fecha,accion,moneda,monto,grupo) VALUES (1,?,?,?,?,?)', [fFecha, 'Convertir', fMoneda, -monto, grupo]);
				await query('INSERT INTO mov_caja (perfil_id,fecha,accion,moneda,monto,grupo) VALUES (1,?,?,?,?,?)', [fFecha, 'Convertir', destinoMon, montoDestino, grupo]);
				fMsg = `Convertido ${fMoneda}→${destinoMon} ✅`; fMonto = '';
			}
			await cargarBase();
			await cargarLedger();
			await cargarCaja();
		} catch (e: any) { fMsg = 'Error: ' + (e?.message ?? String(e)); }
	}

	async function borrarTx(id: number) {
		if (!confirm('¿Eliminar esta operación?')) return;
		await query('DELETE FROM transaccion WHERE id=? AND perfil_id=1', [id]);
		await cargarLedger();
	}
	async function borrarCaja(m: any) {
		if (!confirm('¿Eliminar este movimiento de caja?')) return;
		if (m.grupo) await query('DELETE FROM mov_caja WHERE grupo=? AND perfil_id=1', [m.grupo]);
		else await query('DELETE FROM mov_caja WHERE id=? AND perfil_id=1', [m.id]);
		await cargarCaja();
	}
	async function borrarRenta(id: number) {
		if (!confirm('¿Eliminar este movimiento de renta/amortización?')) return;
		await query('DELETE FROM renta_activo WHERE id=? AND perfil_id=1', [id]);
		await cargarRenta();
	}

	const money = (n: number, mon: string, dec = 0) => (mon === 'USD' ? 'U$D ' : '$') + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
	const nf = (n: number) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 });

	const hayFiltro = $derived(!!filtroActivo || !!filtroDesde || !!filtroHasta);
	const rangoTexto = $derived(
		!filtroDesde && !filtroHasta ? 'Últimas 40 operaciones'
		: filtroDesde && filtroHasta ? `Del ${fmtFecha(filtroDesde)} al ${fmtFecha(filtroHasta)}`
		: filtroDesde ? `Desde ${fmtFecha(filtroDesde)} hasta hoy`
		: `Desde el inicio hasta ${fmtFecha(filtroHasta)}`
	);
</script>

<div class="titulo-guia">
	<h1>Cargar movimiento</h1>
	<Guia clave="carga-inversiones" texto="Registrá compras, ventas, ingresos/retiros de caja y conversiones de moneda. Abajo tenés el libro diario con todas tus operaciones y los movimientos de caja." />
</div>
<a href="/inversiones" class="btn-volver">← Volver a Inversiones</a>

<div class="form">
	<div class="acciones">
		{#each ['Compra', 'Venta', 'Renta', 'Ingreso', 'Retiro', 'Convertir'] as ac}
			<button type="button" class:activo={fAccion === ac} onclick={() => (fAccion = ac as any)}>{ac === 'Renta' ? 'Renta y Amort.' : ac}</button>
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
		<label>Unidades<input type="text" inputmode="decimal" use:soloNum bind:value={fUnidades} /></label>
		<label>{fAccion === 'Compra' ? 'Pagué' : 'Cobré'} en<select bind:value={fPago}><option>ARS</option><option>USD</option></select></label>
		<label>Monto {fAccion === 'Compra' ? 'pagado' : 'cobrado'} en {fPago}<input type="text" inputmode="decimal" use:soloNum bind:value={fMonto} placeholder="0,00" /></label>
		<!-- Se oculta solo cuando activo y pago son USD (ahí no aporta nada).
		     Para activos en ARS siempre se pide: convierte la operación a USD
		     para calcular tus ganancias en dólares. -->
		{#if fPago !== monedaActivo || monedaActivo === 'ARS'}
			<label>Valor dólar del día<input type="text" inputmode="decimal" use:soloNum bind:value={fValorDolar} /></label>
		{/if}
		{#if uN > 0 && mN > 0 && (fPago === monedaActivo || vdN > 0)}
			{@const montoActivo = fPago === monedaActivo ? mN : monedaActivo === 'USD' ? mN / vdN : mN * vdN}
			<p class="hint">Precio: {money(montoActivo / uN, monedaActivo, 4)} · {fAccion === 'Compra' ? 'sale' : 'entra'} {money(mN, fPago, 2)} de Líquido {fPago}</p>
		{/if}
	{:else if fAccion === 'Ingreso' || fAccion === 'Retiro'}
		<label>Moneda<select bind:value={fMoneda}><option>ARS</option><option>USD</option></select></label>
		<label>Monto<input type="text" inputmode="decimal" use:soloNum bind:value={fMonto} placeholder="0,00" /></label>
	{:else if fAccion === 'Convertir'}
		<label>Convierto desde<select bind:value={fMoneda}><option>ARS</option><option>USD</option></select></label>
		<label>Monto en {fMoneda}<input type="text" inputmode="decimal" use:soloNum bind:value={fMonto} placeholder="0,00" /></label>
		<label>Valor dólar<input type="text" inputmode="decimal" use:soloNum bind:value={fValorDolar} /></label>
		{#if mN > 0 && vdN > 0}<p class="hint">Entran {money(fMoneda === 'ARS' ? mN / vdN : mN * vdN, fMoneda === 'ARS' ? 'USD' : 'ARS', 2)} a Líquido {fMoneda === 'ARS' ? 'USD' : 'ARS'}</p>{/if}
	{:else if fAccion === 'Renta'}
		<label>Activo
			<select bind:value={fActivo}><option value="" disabled>Elegir…</option>
				{#each activosList as a (a.id)}<option value={String(a.id)}>{a.nombre} ({a.tipo}/{a.moneda})</option>{/each}
			</select></label>
		<label>Moneda (renta y amortización)<select bind:value={fMoneda}><option>ARS</option><option>USD</option></select></label>
		<label>Monto renta (cupón)<input type="text" inputmode="decimal" use:soloNum bind:value={fRenta} placeholder="0,00" /></label>
		<label>Monto amortización<input type="text" inputmode="decimal" use:soloNum bind:value={fAmort} placeholder="0,00" /></label>
		{#if !(fMoneda === 'USD' && monedaActivo === 'USD')}
			<label>Tipo de cambio<input type="text" inputmode="decimal" use:soloNum bind:value={fTcRenta} placeholder="auto: MEP de la fecha" /></label>
		{/if}
		{#if rentaN > 0 || amortN > 0}
			<p class="hint">Entra {money((Number.isFinite(rentaN) ? rentaN : 0) + (Number.isFinite(amortN) ? amortN : 0), fMoneda, 2)} a Líquido {fMoneda} · corrige el resultado del activo (no mueve unidades).</p>
		{/if}
	{/if}
	<button class="btn btn-success" onclick={guardar}>Guardar</button>
	{#if fMsg}<p class="msg">{fMsg}</p>{/if}
</div>

<h2>Libro diario</h2>
<div class="filtros">
	<label>Desde<input type="date" bind:value={filtroDesde} /></label>
	<label>Hasta<input type="date" bind:value={filtroHasta} /></label>
	<label>Activo
		<select bind:value={filtroActivo}>
			<option value="">Todos</option>
			{#each activosList as a (a.id)}<option value={String(a.id)}>{a.nombre}</option>{/each}
		</select>
	</label>
	{#if hayFiltro}<button class="btn btn-secondary" onclick={limpiarFiltros}>Limpiar</button>{/if}
</div>
<p class="rango">{rangoTexto}</p>

<div class="fichas">
	{#each ledger as t (t.id)}
		<div class="ficha">
			<div class="ficha-top">
				<span class="ficha-nombre">{t.nombre} <span class="ficha-tipo">({t.tipo})</span></span>
				<span class="ficha-monto">{money(t.unidades * t.precio, t.moneda)}</span>
				<span class="ficha-acc">
					<button aria-label="Eliminar" class="del" onclick={() => borrarTx(t.id)} title="Eliminar">✕</button>
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
					<button aria-label="Eliminar" class="del" onclick={() => borrarCaja(m)} title="Eliminar">✕</button>
				</span>
			</div>
			<div class="ficha-meta">{fmtFecha(m.fecha)} · {m.moneda}</div>
		</div>
	{:else}
		<p class="vacio">Sin movimientos todavía</p>
	{/each}
</div>

{#if rentaLedger.length}
	<h2>Renta y amortización</h2>
	<div class="fichas">
		{#each rentaLedger as r (r.id)}
			<div class="ficha">
				<div class="ficha-top">
					<span class="ficha-nombre">{r.nombre}</span>
					<span class="ficha-monto pos">{money(r.monto_renta + r.monto_amort, r.moneda)}</span>
					<span class="ficha-acc">
						<button aria-label="Eliminar" class="del" onclick={() => borrarRenta(r.id)} title="Eliminar">✕</button>
					</span>
				</div>
				<div class="ficha-meta">{fmtFecha(r.fecha)} · renta {money(r.monto_renta, r.moneda)} · amort. {money(r.monto_amort, r.moneda)}</div>
			</div>
		{/each}
	</div>
{/if}

<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	h2 { font-size: 1.05rem; margin-top: 20px; }
	.form { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 14px; margin: 12px 0; display: flex; flex-direction: column; gap: 9px; max-width: 400px; }
	.acciones { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
	.acciones button { width: 100%; box-sizing: border-box; }
	.nuevo { border: 1px dashed var(--border); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
	label { display: flex; flex-direction: column; font-size: 0.82rem; color: var(--text-dim); gap: 3px; }
	input, select { padding: 6px; font-size: 0.95rem; }
	.hint { font-size: 0.82rem; color: var(--accent); margin: 0; }
	.msg { font-weight: 600; margin: 6px 0; }

	/* Filtros del libro diario */
	.filtros { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end; margin: 8px 0; }
	.filtros label { flex: 1 1 140px; min-width: 0; }
	.filtros input, .filtros select { width: 100%; min-width: 0; box-sizing: border-box; }
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
	.vacio { color: var(--text-dim); font-style: italic; }
	.pos { color: var(--pos); }
	.neg { color: var(--neg); }
</style>

<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import { fmtFecha, hoyISO, parseNum, formatNum, soloNum } from '$lib/format';
	import { dolarActual } from '$lib/cartera';
	import Guia from '$lib/Guia.svelte';

	let cuentas = $state<any[]>([]);
	let activosList = $state<any[]>([]);
	// Dos libros: diario de activos (transaccion + renta_activo) y caja (mov_caja).
	let activosLedger = $state<any[]>([]);
	let cajaLedger = $state<any[]>([]);

	// Filtros: chip por tipo (primario) + activo (secundario, solo diario de activos).
	let filtroTipoAct = $state<'Todos' | 'Compra' | 'Venta' | 'Renta'>('Todos');
	let filtroActivo = $state<string>('');
	let filtroTipoCaja = $state<'Todos' | 'Ingreso' | 'Retiro' | 'Convertir'>('Todos');

	// Panel de carga colapsable (patron estandar: no autocierra al guardar).
	let formAbierto = $state(false);
	// Edicion: id + tipo de origen, para enrutar el UPDATE a la tabla correcta.
	// Convertir NO es editable (solo borrado).
	let editId = $state<number | null>(null);
	let editTipo = $state<string | null>(null);
	const editando = $derived(editId !== null);

	// Formulario
	let fAccion = $state<'Compra' | 'Venta' | 'Renta' | 'Ingreso' | 'Retiro' | 'Convertir'>('Compra');
	let fCuenta = $state(''); let fCuentaNueva = $state(''); let fActivo = $state('');
	let fFecha = $state(hoyISO());
	let fUnidades = $state('');
	let fMonto = $state('');
	// Renta y Amortizacion: dos montos en la misma moneda + TC opcional (si se deja
	// vacio, se usa el MEP de la fecha del movimiento).
	let fRenta = $state(''); let fAmort = $state(''); let fTcRenta = $state('');
	let fValorDolar = $state('');
	let fPago = $state<'ARS' | 'USD'>('USD');
	let fMoneda = $state<'ARS' | 'USD'>('ARS');
	let naTicker = $state(''); let naNombre = $state(''); let naTipo = $state('Accion');
	let naRenta = $state('Variable'); let naMoneda = $state('USD');
	let fMsg = $state('');

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

	// En Renta, la moneda por defecto es la del activo (editable).
	$effect(() => {
		if (fAccion === 'Renta' && fActivo && fActivo !== 'nuevo') fMoneda = monedaActivo as 'ARS' | 'USD';
	});

	async function cargarBase() {
		const dolar = await dolarActual();
		if (!fValorDolar) fValorDolar = formatNum(dolar, 2);
		cuentas = (await query('SELECT id, nombre FROM cuenta_inversion WHERE perfil_id=1 AND activa=1 ORDER BY nombre')) as any[];
		activosList = (await query('SELECT id, ticker, nombre, tipo, moneda FROM activo WHERE perfil_id=1 AND activo=1 ORDER BY nombre')) as any[];
	}

	// Diario de activos: UNION de compras/ventas (transaccion) y renta/amort
	// (renta_activo). Lectura pura, sin tocar ningun calculo.
	async function cargarActivos() {
		const parts: string[] = [];
		const params: any[] = [];
		const incTx = filtroTipoAct === 'Todos' || filtroTipoAct === 'Compra' || filtroTipoAct === 'Venta';
		const incRenta = filtroTipoAct === 'Todos' || filtroTipoAct === 'Renta';
		if (incTx) {
			let s = `SELECT t.id AS id, t.fecha AS fecha, t.operacion AS tipo, a.id AS activo_id, a.nombre AS nombre, a.tipo AS atipo, a.moneda AS moneda,
				t.unidades AS unidades, t.precio AS precio, t.valor_dolar AS valor_dolar, t.moneda_pago AS moneda_pago, t.monto_pago AS monto_pago,
				t.cuenta_inversion_id AS cuenta_id, NULL AS monto_renta, NULL AS monto_amort
				FROM transaccion t JOIN activo a ON a.id = t.activo_id WHERE t.perfil_id = 1`;
			if (filtroTipoAct === 'Compra' || filtroTipoAct === 'Venta') { s += ' AND t.operacion = ?'; params.push(filtroTipoAct); }
			if (filtroActivo) { s += ' AND t.activo_id = ?'; params.push(Number(filtroActivo)); }
			parts.push(s);
		}
		if (incRenta) {
			let s = `SELECT r.id AS id, r.fecha AS fecha, 'Renta' AS tipo, a.id AS activo_id, a.nombre AS nombre, a.tipo AS atipo, r.moneda AS moneda,
				NULL AS unidades, NULL AS precio, r.valor_dolar AS valor_dolar, NULL AS moneda_pago, NULL AS monto_pago,
				NULL AS cuenta_id, r.monto_renta AS monto_renta, r.monto_amort AS monto_amort
				FROM renta_activo r JOIN activo a ON a.id = r.activo_id WHERE r.perfil_id = 1`;
			if (filtroActivo) { s += ' AND r.activo_id = ?'; params.push(Number(filtroActivo)); }
			parts.push(s);
		}
		if (parts.length === 0) { activosLedger = []; return; }
		const sql = parts.join(' UNION ALL ') + ' ORDER BY fecha DESC, id DESC LIMIT 60';
		activosLedger = (await query(sql, params)) as any[];
	}

	async function cargarCaja() {
		let sql = 'SELECT id, fecha, accion AS tipo, moneda, monto, grupo FROM mov_caja WHERE perfil_id = 1';
		const params: any[] = [];
		if (filtroTipoCaja !== 'Todos') { sql += ' AND accion = ?'; params.push(filtroTipoCaja); }
		sql += ' ORDER BY fecha DESC, id DESC LIMIT 40';
		cajaLedger = (await query(sql, params)) as any[];
	}

	onMount(() => { cargarBase(); });

	// Recarga cada libro al cambiar su filtro (tambien corre al montar).
	$effect(() => { filtroTipoAct; filtroActivo; cargarActivos(); });
	$effect(() => { filtroTipoCaja; cargarCaja(); });

	// MEP (dolar bolsa) en/antes de una fecha; TC por defecto de la renta.
	async function mepDeFecha(fecha: string): Promise<number | null> {
		const r = (await query("SELECT valor FROM cotizacion_dolar WHERE perfil_id=1 AND casa='bolsa' AND fecha <= ? ORDER BY fecha DESC LIMIT 1", [fecha])) as any[];
		return r[0]?.valor ?? null;
	}

	function resetForm() {
		editId = null; editTipo = null;
		fUnidades = ''; fMonto = ''; fRenta = ''; fAmort = ''; fTcRenta = '';
		fCuentaNueva = ''; fActivo = ''; naTicker = ''; naNombre = '';
		fMsg = '';
	}

	// Cambio de tipo desde la grilla: si el nuevo tipo es de otra tabla que la
	// fila en edicion, salgo del modo edicion (evita guardar en la tabla equivocada).
	function grupoDe(x: string) { return x === 'Compra' || x === 'Venta' ? 'trade' : x === 'Renta' ? 'renta' : 'caja'; }
	function setAccion(ac: 'Compra' | 'Venta' | 'Renta' | 'Ingreso' | 'Retiro' | 'Convertir') {
		if (editId !== null && editTipo && grupoDe(ac) !== grupoDe(editTipo)) { editId = null; editTipo = null; }
		fAccion = ac;
	}

	// Precarga el panel con una fila existente para editar. Convertir no entra aca.
	function iniciarEdit(row: any) {
		fMsg = '';
		editId = row.id; editTipo = row.tipo;
		fFecha = row.fecha;
		if (row.tipo === 'Compra' || row.tipo === 'Venta') {
			fAccion = row.tipo;
			fCuenta = row.cuenta_id != null ? String(row.cuenta_id) : '';
			fActivo = row.activo_id != null ? String(row.activo_id) : '';
			fUnidades = formatNum(row.unidades);
			fPago = (row.moneda_pago ?? 'USD') as 'ARS' | 'USD';
			fMonto = row.monto_pago != null ? formatNum(row.monto_pago) : '';
			if (row.valor_dolar != null) fValorDolar = formatNum(row.valor_dolar, 2);
		} else if (row.tipo === 'Renta') {
			fAccion = 'Renta';
			fActivo = row.activo_id != null ? String(row.activo_id) : '';
			fMoneda = row.moneda;
			fRenta = row.monto_renta ? formatNum(row.monto_renta) : '';
			fAmort = row.monto_amort ? formatNum(row.monto_amort) : '';
			fTcRenta = row.valor_dolar != null ? formatNum(row.valor_dolar, 2) : '';
		} else if (row.tipo === 'Ingreso' || row.tipo === 'Retiro') {
			fAccion = row.tipo;
			fMoneda = row.moneda;
			fMonto = formatNum(Math.abs(row.monto));
		}
		formAbierto = true;
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	async function guardar() {
		fMsg = '';
		const monto = mN;
		if (!fFecha) return (fMsg = 'Falta la fecha');
		if (fAccion !== 'Renta' && (!Number.isFinite(monto) || monto <= 0)) return (fMsg = 'Monto inválido');
		try {
			if (fAccion === 'Renta') {
				if (!fActivo || fActivo === 'nuevo') return (fMsg = 'Elegí un activo');
				const renta = Number.isFinite(rentaN) && rentaN > 0 ? rentaN : 0;
				const amort = Number.isFinite(amortN) && amortN > 0 ? amortN : 0;
				if (renta + amort <= 0) return (fMsg = 'Cargá al menos un monto (renta o amortización)');
				const aMon = monedaActivo;
				const necesitaVd = !(fMoneda === 'USD' && aMon === 'USD');
				const tcManual = parseNum(fTcRenta);
				let vd = Number.isFinite(tcManual) && tcManual > 0 ? tcManual : (await mepDeFecha(fFecha)) ?? NaN;
				if (necesitaVd && !(Number.isFinite(vd) && vd > 0)) return (fMsg = 'No hay cotización del dólar para esa fecha; cargá el tipo de cambio');
				const vdVal = necesitaVd && Number.isFinite(vd) ? vd : null;
				if (editId !== null && editTipo === 'Renta') {
					await query('UPDATE renta_activo SET activo_id=?, fecha=?, moneda=?, monto_renta=?, monto_amort=?, valor_dolar=? WHERE id=? AND perfil_id=1',
						[Number(fActivo), fFecha, fMoneda, renta, amort, vdVal, editId]);
					fMsg = 'Renta y amortización actualizada ✅';
				} else {
					await query('INSERT INTO renta_activo (perfil_id,activo_id,fecha,moneda,monto_renta,monto_amort,valor_dolar) VALUES (1,?,?,?,?,?,?)',
						[Number(fActivo), fFecha, fMoneda, renta, amort, vdVal]);
					fMsg = 'Renta y amortización guardada ✅';
				}
				resetForm();
				await cargarBase(); await cargarActivos();
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
					const expo = naMoneda === 'USD' || naTipo === 'CEDEAR' || naTipo === 'Indice' ? 'Dolar' : 'Peso';
					const r = (await query('INSERT INTO activo (perfil_id,ticker,nombre,tipo,renta,moneda,exposicion) VALUES (1,?,?,?,?,?,?) RETURNING id',
						[naTicker.trim(), naNombre.trim(), naTipo, naRenta, naMoneda, expo])) as any[];
					activoId = r[0].id; monA = naMoneda;
				} else { activoId = Number(fActivo); monA = monedaActivo; }
				if (fAccion === 'Venta') {
					// En edicion, excluyo la propia fila del neto disponible.
					const editVenta = editId !== null && editTipo === 'Venta';
					const neto = (await query(
						"SELECT COALESCE(SUM(CASE WHEN operacion='Compra' THEN unidades ELSE -unidades END),0) AS n FROM transaccion WHERE perfil_id=1 AND activo_id=?" + (editVenta ? ' AND id<>?' : ''),
						editVenta ? [activoId, editId] : [activoId])) as any[];
					if (neto[0].n + 1e-9 < u) return (fMsg = `No podés vender ${u}; tenés ${neto[0].n.toFixed(2)}`);
				}
				const montoPago = monto;
				let montoActivo = monto;
				if (fPago !== monA) {
					if (!Number.isFinite(vdN) || vdN <= 0) return (fMsg = 'Valor dólar inválido');
					montoActivo = monA === 'USD' ? monto / vdN : monto * vdN;
				}
				const precio = montoActivo / u;
				if (editId !== null && (editTipo === 'Compra' || editTipo === 'Venta')) {
					await query('UPDATE transaccion SET activo_id=?, cuenta_inversion_id=?, fecha=?, operacion=?, unidades=?, precio=?, valor_dolar=?, moneda_pago=?, monto_pago=? WHERE id=? AND perfil_id=1',
						[activoId, cuentaId, fFecha, fAccion, u, precio, Number.isFinite(vdN) ? vdN : null, fPago, montoPago, editId]);
					fMsg = `${fAccion} actualizada ✅`;
				} else {
					await query('INSERT INTO transaccion (perfil_id,activo_id,cuenta_inversion_id,fecha,operacion,unidades,precio,valor_dolar,moneda_pago,monto_pago) VALUES (1,?,?,?,?,?,?,?,?,?)',
						[activoId, cuentaId, fFecha, fAccion, u, precio, Number.isFinite(vdN) ? vdN : null, fPago, montoPago]);
					// Actualiza el precio de mercado solo si esta operacion es igual o mas
					// nueva que la ultima actualizacion (una carga retroactiva no lo pisa).
					const pa = (await query('SELECT precio_actualizado_en FROM activo WHERE id=? AND perfil_id=1', [activoId])) as any[];
					const ultAct = pa[0]?.precio_actualizado_en;
					if (!ultAct || fFecha >= ultAct) {
						await query('UPDATE activo SET precio_actual=?, precio_actualizado_en=? WHERE id=? AND perfil_id=1', [precio, fFecha, activoId]);
					}
					fMsg = `${fAccion} guardada ✅`;
				}
			} else if (fAccion === 'Ingreso' || fAccion === 'Retiro') {
				const signo = fAccion === 'Ingreso' ? 1 : -1;
				if (editId !== null && (editTipo === 'Ingreso' || editTipo === 'Retiro')) {
					await query('UPDATE mov_caja SET fecha=?, accion=?, moneda=?, monto=? WHERE id=? AND perfil_id=1', [fFecha, fAccion, fMoneda, signo * monto, editId]);
					fMsg = `${fAccion} actualizado ✅`;
				} else {
					await query('INSERT INTO mov_caja (perfil_id,fecha,accion,moneda,monto) VALUES (1,?,?,?,?)', [fFecha, fAccion, fMoneda, signo * monto]);
					fMsg = `${fAccion} de ${fMoneda} guardado ✅`;
				}
			} else if (fAccion === 'Convertir') {
				const vd = vdN;
				if (!Number.isFinite(vd) || vd <= 0) return (fMsg = 'Valor dólar inválido');
				const destinoMon = fMoneda === 'ARS' ? 'USD' : 'ARS';
				const montoDestino = fMoneda === 'ARS' ? monto / vd : monto * vd;
				// id de grupo unico sin usar fechas "ahora": fecha del mov + aleatorio.
				const grupo = 'conv-' + fFecha + '-' + Math.floor(Math.random() * 1e9);
				await query('INSERT INTO mov_caja (perfil_id,fecha,accion,moneda,monto,grupo) VALUES (1,?,?,?,?,?)', [fFecha, 'Convertir', fMoneda, -monto, grupo]);
				await query('INSERT INTO mov_caja (perfil_id,fecha,accion,moneda,monto,grupo) VALUES (1,?,?,?,?,?)', [fFecha, 'Convertir', destinoMon, montoDestino, grupo]);
				fMsg = `Convertido ${fMoneda}→${destinoMon} ✅`;
			}
			resetForm();
			await cargarBase(); await cargarActivos(); await cargarCaja();
		} catch (e: any) { fMsg = 'Error: ' + (e?.message ?? String(e)); }
	}

	async function borrarActivo(m: any) {
		if (m.tipo === 'Renta') {
			if (!confirm('¿Eliminar este movimiento de renta/amortización?')) return;
			await query('DELETE FROM renta_activo WHERE id=? AND perfil_id=1', [m.id]);
		} else {
			if (!confirm('¿Eliminar esta operación?')) return;
			await query('DELETE FROM transaccion WHERE id=? AND perfil_id=1', [m.id]);
		}
		if (editId === m.id && editTipo === m.tipo) resetForm();
		await cargarActivos();
	}

	async function borrarCaja(m: any) {
		if (!confirm('¿Eliminar este movimiento de caja?')) return;
		if (m.grupo) await query('DELETE FROM mov_caja WHERE grupo=? AND perfil_id=1', [m.grupo]);
		else await query('DELETE FROM mov_caja WHERE id=? AND perfil_id=1', [m.id]);
		if (editId === m.id && (editTipo === 'Ingreso' || editTipo === 'Retiro')) resetForm();
		await cargarCaja();
	}

	const money = (n: number, mon: string, dec = 0) => (mon === 'USD' ? 'U$D ' : '$') + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
	const nf = (n: number) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 });
</script>

<div class="titulo-guia">
	<h1>Movimientos</h1>
	<Guia clave="carga-inversiones" texto="Registrá compras, ventas, renta/amortización, ingresos/retiros de caja y conversiones. Abajo tenés dos libros: el diario de activos y la caja. Tocá el lápiz de una fila para editarla (Convertir solo se puede borrar)." />
</div>
<a href="/inversiones" class="btn-volver">← Volver a Inversiones</a>

<details class="form-panel" bind:open={formAbierto}>
	<summary>{editando ? '✏ Editar movimiento' : '➕ Cargar movimiento'}</summary>
<div class="form">
	{#if editando}<p class="editando">✏ Editando {editTipo} #{editId} · <button class="link" onclick={resetForm}>cancelar</button></p>{/if}
	<div class="acciones">
		{#each ['Compra', 'Venta', 'Renta', 'Ingreso', 'Retiro', 'Convertir'] as ac}
			<button type="button" class:activo={fAccion === ac} onclick={() => setAccion(ac as any)}>{ac === 'Renta' ? 'Renta y Amort.' : ac}</button>
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
	<button class="btn btn-success" onclick={guardar}>{editando ? 'Guardar cambios' : 'Guardar'}</button>
	{#if fMsg}<p class="msg">{fMsg}</p>{/if}
</div>
</details>

<h2>Diario de activos</h2>
<div class="seg filtros-tipo">
	{#each ['Todos', 'Compra', 'Venta', 'Renta'] as t}
		<button type="button" class:is-active={filtroTipoAct === t} onclick={() => (filtroTipoAct = t as any)}>{t === 'Renta' ? 'Renta y Amort.' : t}</button>
	{/each}
</div>
<label class="filtro-activo">Activo
	<select bind:value={filtroActivo}>
		<option value="">Todos</option>
		{#each activosList as a (a.id)}<option value={String(a.id)}>{a.nombre}</option>{/each}
	</select>
</label>

<div class="fichas">
	{#each activosLedger as m (m.tipo + '-' + m.id)}
		<div class="ficha" class:editrow={editId === m.id && editTipo === m.tipo}>
			<div class="ficha-top">
				<span class="ficha-nombre">{m.nombre} <span class="ficha-tipo">({m.atipo})</span></span>
				{#if m.tipo === 'Renta'}
					<span class="ficha-monto pos">{money(m.monto_renta + m.monto_amort, m.moneda)}</span>
				{:else}
					<span class="ficha-monto">{money(m.unidades * m.precio, m.moneda)}</span>
				{/if}
				<span class="ficha-acc">
					<button aria-label="Editar" class="lapiz" onclick={() => iniciarEdit(m)} title="Editar">✏</button>
					<button aria-label="Eliminar" class="del" onclick={() => borrarActivo(m)} title="Eliminar">✕</button>
				</span>
			</div>
			<div class="ficha-meta">
				{#if m.tipo === 'Renta'}
					{fmtFecha(m.fecha)} · renta {money(m.monto_renta, m.moneda)} · amort. {money(m.monto_amort, m.moneda)}
				{:else}
					{fmtFecha(m.fecha)} · <span class={m.tipo === 'Compra' ? 'pos' : 'neg'}>{m.tipo}</span> · {nf(m.unidades)} un. × {money(m.precio, m.moneda, 2)}
				{/if}
			</div>
		</div>
	{/each}
	{#if activosLedger.length === 0}<p class="vacio">No hay movimientos de activos para el filtro.</p>{/if}
</div>

<h2>Caja</h2>
<div class="seg filtros-tipo">
	{#each ['Todos', 'Ingreso', 'Retiro', 'Convertir'] as t}
		<button type="button" class:is-active={filtroTipoCaja === t} onclick={() => (filtroTipoCaja = t as any)}>{t}</button>
	{/each}
</div>
<div class="fichas">
	{#each cajaLedger as m (m.id)}
		<div class="ficha" class:editrow={editId === m.id && editTipo === m.tipo}>
			<div class="ficha-top">
				<span class="ficha-nombre">{m.tipo}</span>
				<span class="ficha-monto {m.monto >= 0 ? 'pos' : 'neg'}">{money(m.monto, m.moneda)}</span>
				<span class="ficha-acc">
					{#if m.tipo !== 'Convertir'}<button aria-label="Editar" class="lapiz" onclick={() => iniciarEdit(m)} title="Editar">✏</button>{/if}
					<button aria-label="Eliminar" class="del" onclick={() => borrarCaja(m)} title="Eliminar">✕</button>
				</span>
			</div>
			<div class="ficha-meta">{fmtFecha(m.fecha)} · {m.moneda}</div>
		</div>
	{:else}
		<p class="vacio">Sin movimientos de caja para el filtro.</p>
	{/each}
</div>

<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	h2 { font-size: 1.02rem; margin-top: 26px; border-left: 3px solid var(--accent); padding-left: 12px; }
	.acciones { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
	.acciones button { width: 100%; box-sizing: border-box; }
	.nuevo { border: 1px dashed var(--border); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
	label { display: flex; flex-direction: column; font-size: 0.82rem; color: var(--text-dim); gap: 3px; }
	input, select { padding: 6px; font-size: 0.95rem; }
	.hint { font-size: 0.82rem; color: var(--accent); margin: 0; }
	.msg { font-weight: 600; margin: 6px 0; }
	.editando { font-size: 0.85rem; color: var(--warn); background: rgba(251, 191, 36, 0.1); padding: 6px 10px; border-radius: 6px; margin: 0 0 4px; }

	/* Panel de carga colapsable (patron estandar, igual que Fijos) */
	.form-panel { border: 1px solid var(--border); border-radius: 8px; background: var(--surface); margin: 12px 0; }
	.form-panel summary { cursor: pointer; padding: 11px 14px; font-family: var(--font-display); font-weight: 600; font-size: 0.92rem; color: var(--accent); list-style: none; }
	.form-panel summary::-webkit-details-marker { display: none; }
	.form-panel[open] summary { border-bottom: 1px solid var(--border); }
	.form-panel .form { background: none; border-color: transparent; border-radius: 0; margin: 0; padding: 12px 14px; }

	/* Filtros de cada libro */
	.filtros-tipo { margin: 8px 0; }
	.filtro-activo { display: flex; flex-direction: column; font-size: 0.82rem; color: var(--text-dim); gap: 3px; max-width: 240px; margin: 0 0 8px; }

	/* Fichas (diario de activos + caja) */
	.fichas { display: flex; flex-direction: column; gap: 8px; }
	.ficha { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 10px 12px; }
	.ficha.editrow { border-color: var(--accent); background: rgba(91, 157, 255, 0.08); }
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

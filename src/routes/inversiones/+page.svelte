<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';

	let cargando = $state(true);
	let cartera = $state<any[]>([]);
	let anuales = $state<any[]>([]);
	let activoNoRealizadoUSD = $state(0);
	let buckets = $state<any[]>([]);
	let ledger = $state<any[]>([]);
	let dolar = $state(1);
	let totalUSD = $state(0);

	let cuentas = $state<any[]>([]);
	let activosList = $state<any[]>([]);

	let showForm = $state(false);
	let fOp = $state<'Compra' | 'Venta'>('Compra');
	let fCuenta = $state<string>('');
	let fCuentaNueva = $state('');
	let fActivo = $state<string>('');
	let fFecha = $state(new Date().toISOString().slice(0, 10));
	let fUnidades = $state<number | null>(null);
	let fMonto = $state<number | null>(null);
	let fValorDolar = $state<number | null>(null);
	let naTicker = $state(''); let naNombre = $state(''); let naTipo = $state('Accion');
	let naRenta = $state('Variable'); let naMoneda = $state('USD');
	let fMsg = $state('');

	// edición de precio de activo
	let editId = $state<number | null>(null);
	let editPrecio = $state<number | null>(null);
	// edición de liquidez
	let editLiq = $state<string | null>(null);
	let editSaldo = $state<number | null>(null);

	const toUSD = (m: number, mon: string, vd: number | null) => (mon === 'USD' ? m : vd ? m / vd : 0);

	async function cargarTodo() {
		const dq = (await query('SELECT valor FROM cotizacion_dolar WHERE perfil_id=1 ORDER BY fecha DESC LIMIT 1')) as any[];
		dolar = dq[0]?.valor ?? 1;
		if (fValorDolar == null) fValorDolar = dolar;

		cuentas = (await query('SELECT id, nombre FROM cuenta_inversion WHERE perfil_id=1 AND activa=1 ORDER BY nombre')) as any[];
		activosList = (await query('SELECT id, ticker, nombre, tipo, moneda FROM activo WHERE perfil_id=1 AND activo=1 ORDER BY nombre')) as any[];

		const activos = (await query('SELECT id, nombre, tipo, renta, moneda, precio_actual FROM activo WHERE perfil_id=1')) as any[];
		const aMap: Record<number, any> = {};
		for (const a of activos) aMap[a.id] = a;

		const txs = (await query('SELECT activo_id, operacion, unidades, precio, fecha, valor_dolar FROM transaccion WHERE perfil_id=1 ORDER BY activo_id, fecha, id')) as any[];

		const lotes: Record<number, { u: number; pNat: number; pUSD: number }[]> = {};
		const realizAnioUSD: Record<string, number> = {};
		for (const t of txs) {
			const a = aMap[t.activo_id];
			lotes[t.activo_id] ??= [];
			if (t.operacion === 'Compra') {
				lotes[t.activo_id].push({ u: t.unidades, pNat: t.precio, pUSD: toUSD(t.precio, a.moneda, t.valor_dolar) });
			} else {
				let rem = t.unidades;
				const pvUSD = toUSD(t.precio, a.moneda, t.valor_dolar);
				const anio = t.fecha.slice(0, 4);
				const q = lotes[t.activo_id];
				while (rem > 1e-9 && q.length) {
					const lote = q[0];
					const take = Math.min(rem, lote.u);
					realizAnioUSD[anio] = (realizAnioUSD[anio] ?? 0) + take * (pvUSD - lote.pUSD);
					lote.u -= take; rem -= take;
					if (lote.u < 1e-9) q.shift();
				}
			}
		}

		const hold: any[] = [];
		const buck: Record<string, number> = { Fija: 0, Mixta: 0, Variable: 0, Liquido: 0 };
		let tUSD = 0; let noRealUSD = 0;
		for (const [aid, q] of Object.entries(lotes)) {
			const u = q.reduce((s, l) => s + l.u, 0);
			if (u < 1e-6) continue;
			const a = aMap[Number(aid)];
			const costo = q.reduce((s, l) => s + l.u * l.pNat, 0);
			const costoUSD = q.reduce((s, l) => s + l.u * l.pUSD, 0);
			const ppc = costo / u;
			const pa = a.precio_actual ?? ppc;
			const mercado = u * pa;
			const mercadoUSD = a.moneda === 'USD' ? mercado : mercado / dolar;
			noRealUSD += mercadoUSD - costoUSD;
			buck[a.renta] = (buck[a.renta] ?? 0) + mercadoUSD;
			tUSD += mercadoUSD;
			hold.push({
				id: Number(aid), esLiq: false,
				nombre: a.nombre, tipo: a.tipo, renta: a.renta, moneda: a.moneda,
				monto: costo, unidades: u, ppc, ppv: pa, precioActual: pa, mercado,
				resultado: mercado - costo, pctRes: costo ? (mercado - costo) / costo : 0, mercadoUSD
			});
		}

		// Liquidez como posiciones
		const liq = (await query('SELECT moneda, saldo FROM liquidez WHERE perfil_id=1')) as any[];
		for (const l of liq) {
			const valUSD = l.moneda === 'USD' ? l.saldo : l.saldo / dolar;
			buck['Liquido'] += valUSD;
			tUSD += valUSD;
			hold.push({
				id: 'liq-' + l.moneda, esLiq: true,
				nombre: 'Líquido ' + l.moneda, tipo: 'Líquido', renta: 'Liquido', moneda: l.moneda,
				monto: l.saldo, unidades: 0, ppc: 0, ppv: 0, precioActual: 0,
				mercado: l.saldo, resultado: 0, pctRes: 0, mercadoUSD: valUSD
			});
		}

		for (const h of hold) h.peso = tUSD ? h.mercadoUSD / tUSD : 0;
		hold.sort((x, y) => y.mercadoUSD - x.mercadoUSD);
		cartera = hold;
		totalUSD = tUSD;
		activoNoRealizadoUSD = noRealUSD;
		anuales = Object.keys(realizAnioUSD).sort().map((y) => ({ anio: y, valor: realizAnioUSD[y] }));
		buckets = Object.entries(buck).filter(([, v]) => v > 0)
			.map(([renta, v]) => ({ renta, v, pct: tUSD ? v / tUSD : 0 }))
			.sort((a, b) => b.v - a.v);

		ledger = (await query(`
			SELECT t.id, t.fecha, a.nombre, a.tipo, a.moneda, t.operacion, t.unidades, t.precio
			FROM transaccion t JOIN activo a ON a.id = t.activo_id
			WHERE t.perfil_id = 1 ORDER BY t.fecha DESC, t.id DESC LIMIT 40`)) as any[];

		cargando = false;
	}

	onMount(cargarTodo);

	let monedaOp = $derived.by(() => {
		if (fActivo === 'nuevo') return naMoneda;
		const a = activosList.find((x) => String(x.id) === fActivo);
		return a ? a.moneda : '—';
	});
	let precioCalc = $derived(fUnidades && fMonto && fUnidades > 0 ? fMonto / fUnidades : 0);

	async function guardarOperacion() {
		fMsg = '';
		const u = Number(fUnidades); const m = Number(fMonto);
		if (!fFecha) return (fMsg = 'Falta la fecha');
		if (!u || u <= 0) return (fMsg = 'Unidades inválidas');
		if (!m || m <= 0) return (fMsg = 'Monto inválido');
		if (!fCuenta) return (fMsg = 'Elegí o creá una cuenta');
		if (!fActivo) return (fMsg = 'Elegí o creá un activo');
		if (fCuenta === 'nueva' && !fCuentaNueva.trim()) return (fMsg = 'Nombre de la cuenta nueva');
		if (fActivo === 'nuevo' && (!naTicker.trim() || !naNombre.trim())) return (fMsg = 'Completá ticker y nombre');
		try {
			let cuentaId: number;
			if (fCuenta === 'nueva') {
				const r = (await query("INSERT INTO cuenta_inversion (perfil_id,nombre,tipo) VALUES (1,?,'broker') RETURNING id", [fCuentaNueva.trim()])) as any[];
				cuentaId = r[0].id;
			} else cuentaId = Number(fCuenta);
			let activoId: number;
			if (fActivo === 'nuevo') {
				const r = (await query('INSERT INTO activo (perfil_id,ticker,nombre,tipo,renta,moneda) VALUES (1,?,?,?,?,?) RETURNING id',
					[naTicker.trim(), naNombre.trim(), naTipo, naRenta, naMoneda])) as any[];
				activoId = r[0].id;
			} else activoId = Number(fActivo);
			if (fOp === 'Venta') {
				const neto = (await query("SELECT COALESCE(SUM(CASE WHEN operacion='Compra' THEN unidades ELSE -unidades END),0) AS n FROM transaccion WHERE perfil_id=1 AND activo_id=?", [activoId])) as any[];
				if (neto[0].n + 1e-9 < u) return (fMsg = `No podés vender ${u}; tenés ${neto[0].n.toFixed(2)}`);
			}
			const precio = m / u;
			await query('INSERT INTO transaccion (perfil_id,activo_id,cuenta_inversion_id,fecha,operacion,unidades,precio,valor_dolar) VALUES (1,?,?,?,?,?,?,?)',
				[activoId, cuentaId, fFecha, fOp, u, precio, fValorDolar]);
			await query('UPDATE activo SET precio_actual=?, precio_actualizado_en=? WHERE id=?', [precio, fFecha, activoId]);
			fMsg = `${fOp} guardada ✅`;
			fUnidades = null; fMonto = null; fActivo = ''; fCuentaNueva = ''; naTicker = ''; naNombre = '';
			await cargarTodo();
		} catch (e: any) { fMsg = 'Error: ' + (e?.message ?? String(e)); }
	}

	async function borrarTx(id: number) {
		if (!confirm('¿Borrar esta operación? No se puede deshacer.')) return;
		await query('DELETE FROM transaccion WHERE id=?', [id]);
		await cargarTodo();
	}

	function abrirEdit(h: any) { editId = h.id; editPrecio = h.precioActual; }
	async function guardarPrecio() {
		if (editId == null || !editPrecio || editPrecio <= 0) { editId = null; return; }
		await query('UPDATE activo SET precio_actual=?, precio_actualizado_en=? WHERE id=?',
			[editPrecio, new Date().toISOString().slice(0, 10), editId]);
		editId = null; editPrecio = null; await cargarTodo();
	}

	function abrirEditLiq(h: any) { editLiq = h.moneda; editSaldo = h.monto; }
	async function guardarLiq() {
		if (editLiq == null || editSaldo == null || editSaldo < 0) { editLiq = null; return; }
		await query('UPDATE liquidez SET saldo=?, actualizado_en=? WHERE perfil_id=1 AND moneda=?',
			[editSaldo, new Date().toISOString().slice(0, 10), editLiq]);
		editLiq = null; editSaldo = null; await cargarTodo();
	}

	async function reimportar() {
		if (!confirm('Reimportar inversiones desde cero (borra y recarga datos)?')) return;
		await query('DELETE FROM transaccion WHERE perfil_id=1');
		await query('DELETE FROM activo WHERE perfil_id=1');
		await query("DELETE FROM cuenta_inversion WHERE perfil_id=1 AND nombre='Cocos Capital'");
		location.reload();
	}

	const money = (n: number, mon: string, dec = 0) => (mon === 'USD' ? 'U$D ' : '$') + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
	const usd = (n: number, dec = 0) => 'U$D ' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
	const pct = (n: number) => (n >= 0 ? '+' : '') + (n * 100).toFixed(1) + '%';
	const nf = (n: number) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 });
	const colorRenta: Record<string, string> = { Fija: '#2e7d32', Mixta: '#1a73e8', Variable: '#e8710a', Liquido: '#888' };
</script>

<h1>Inversiones</h1>

{#if cargando}
	<p>Cargando…</p>
{:else}
	<div class="topbar">
		<button class="nueva" onclick={() => (showForm = !showForm)}>{showForm ? '✕ Cerrar' : '➕ Nueva operación'}</button>
		<button class="reimp" onclick={reimportar}>🔄 Reimportar</button>
	</div>

	{#if showForm}
		<div class="form">
			<div class="medio">
				<button type="button" class:activo={fOp === 'Compra'} onclick={() => (fOp = 'Compra')}>Compra</button>
				<button type="button" class:activo={fOp === 'Venta'} onclick={() => (fOp = 'Venta')}>Venta</button>
			</div>
			<label>Cuenta
				<select bind:value={fCuenta}>
					<option value="" disabled>Elegir…</option>
					{#each cuentas as c (c.id)}<option value={String(c.id)}>{c.nombre}</option>{/each}
					<option value="nueva">+ Cuenta nueva…</option>
				</select>
			</label>
			{#if fCuenta === 'nueva'}<label>Nombre cuenta<input bind:value={fCuentaNueva} /></label>{/if}
			<label>Activo
				<select bind:value={fActivo}>
					<option value="" disabled>Elegir…</option>
					{#each activosList as a (a.id)}<option value={String(a.id)}>{a.nombre} ({a.tipo}/{a.moneda})</option>{/each}
					<option value="nuevo">+ Activo nuevo…</option>
				</select>
			</label>
			{#if fActivo === 'nuevo'}
				<div class="nuevo">
					<label>Ticker<input bind:value={naTicker} /></label>
					<label>Nombre<input bind:value={naNombre} /></label>
					<label>Tipo<select bind:value={naTipo}><option>Accion</option><option>CEDEAR</option><option>Bono</option><option>ON</option><option>FCI</option><option>Indice</option></select></label>
					<label>Renta<select bind:value={naRenta}><option>Variable</option><option>Fija</option><option>Mixta</option><option>Liquido</option></select></label>
					<label>Moneda<select bind:value={naMoneda}><option>USD</option><option>ARS</option></select></label>
				</div>
			{/if}
			<label>Fecha<input type="date" bind:value={fFecha} /></label>
			<label>Unidades<input type="number" step="any" bind:value={fUnidades} /></label>
			<label>Monto ({monedaOp})<input type="number" step="any" bind:value={fMonto} /></label>
			<label>Valor dólar<input type="number" step="any" bind:value={fValorDolar} /></label>
			{#if precioCalc > 0}<p class="hint">Precio efectivo: {money(precioCalc, monedaOp, 4)}</p>{/if}
			<button class="guardar" onclick={guardarOperacion}>Guardar operación</button>
			{#if fMsg}<p class="msg">{fMsg}</p>{/if}
		</div>
	{/if}

	<div class="resumen">
		<div class="card"><span>Cartera total (≈USD)</span><strong>{usd(totalUSD)}</strong></div>
		<div class="card"><span>Activo no realizado (≈USD)</span><strong class={activoNoRealizadoUSD >= 0 ? 'pos' : 'neg'}>{usd(activoNoRealizadoUSD, 2)}</strong></div>
	</div>

	<h2>Resultado realizado por año de cierre (USD)</h2>
	<table class="chica">
		<thead><tr><th>Año cierre</th><th class="num">Realizado</th></tr></thead>
		<tbody>
			{#each anuales as a (a.anio)}<tr><td>{a.anio}</td><td class="num {a.valor >= 0 ? 'pos' : 'neg'}">{usd(a.valor, 2)}</td></tr>{/each}
		</tbody>
	</table>

	<h2>Estructura de renta (≈USD)</h2>
	<div class="bars">
		{#each buckets as b (b.renta)}
			<div class="barrow">
				<span class="lbl">{b.renta}</span>
				<div class="track"><div class="bar" style="width:{b.pct * 100}%; background:{colorRenta[b.renta]}"></div></div>
				<span class="val">{usd(b.v)} · {(b.pct * 100).toFixed(0)}%</span>
			</div>
		{/each}
	</div>

	<h2>Cartera actual</h2>
	<table>
		<thead>
			<tr>
				<th>Tipo</th><th>Activo</th><th class="num">Mix</th><th class="num">Monto</th><th class="num">Unidades</th>
				<th class="num hl">PPC</th><th class="num hl">PPV</th><th class="num">Precio mercado</th><th class="num">Valor mercado</th><th class="num hl">Resultado</th>
			</tr>
		</thead>
		<tbody>
			{#each cartera as h (h.id)}
				<tr class:liqrow={h.esLiq}>
					<td>{h.tipo}</td>
					<td>{h.nombre}</td>
					<td class="pctcol">{(h.peso * 100).toFixed(1)}%</td>
					<td class="num">{money(h.monto, h.moneda)}</td>
					{#if h.esLiq}
						<td class="num">—</td>
						<td class="num hl">—</td>
						<td class="num hl">—</td>
						<td class="num">—</td>
						<td class="num precioedit">
							{#if editLiq === h.moneda}
								<input type="number" step="any" bind:value={editSaldo} onkeydown={(e) => e.key === 'Enter' && guardarLiq()} />
								<button class="okp" onclick={guardarLiq}>✓</button>
								<button class="cancp" onclick={() => (editLiq = null)}>✕</button>
							{:else}
								{money(h.mercado, h.moneda)}
								<button class="lapiz" onclick={() => abrirEditLiq(h)} title="Editar saldo">✏️</button>
							{/if}
						</td>
						<td class="num hl">—</td>
					{:else}
						<td class="num">{nf(h.unidades)}</td>
						<td class="num hl">{money(h.ppc, h.moneda, 2)}</td>
						<td class="num hl">{money(h.ppv, h.moneda, 2)}</td>
						<td class="num precioedit">
							{#if editId === h.id}
								<input type="number" step="any" bind:value={editPrecio} onkeydown={(e) => e.key === 'Enter' && guardarPrecio()} />
								<button class="okp" onclick={guardarPrecio}>✓</button>
								<button class="cancp" onclick={() => (editId = null)}>✕</button>
							{:else}
								{money(h.precioActual, h.moneda, 2)}
								<button class="lapiz" onclick={() => abrirEdit(h)} title="Editar precio">✏️</button>
							{/if}
						</td>
						<td class="num">{money(h.mercado, h.moneda)}</td>
						<td class="num hl {h.resultado >= 0 ? 'pos' : 'neg'}">{money(h.resultado, h.moneda)} ({pct(h.pctRes)})</td>
					{/if}
				</tr>
			{/each}
		</tbody>
	</table>

	<h2>Libro diario (últimas 40)</h2>
	<table>
		<thead><tr><th>Fecha</th><th>Activo</th><th>Tipo</th><th>Op.</th><th class="num">Unidades</th><th class="num">Precio</th><th class="num">Monto</th><th></th></tr></thead>
		<tbody>
			{#each ledger as t (t.id)}
				<tr>
					<td>{t.fecha}</td><td>{t.nombre}</td><td>{t.tipo}</td>
					<td class={t.operacion === 'Compra' ? 'pos' : 'neg'}>{t.operacion}</td>
					<td class="num">{nf(t.unidades)}</td>
					<td class="num">{money(t.precio, t.moneda, 2)}</td>
					<td class="num">{money(t.unidades * t.precio, t.moneda)}</td>
					<td><button class="del" onclick={() => borrarTx(t.id)}>✕</button></td>
				</tr>
			{/each}
		</tbody>
	</table>
	<p class="nota">≈USD al dólar más reciente (${nf(dolar)}). La liquidez (Líquido ARS/USD) es editable con el lapicito para reflejar el rendimiento de tus fondos.</p>
{/if}

<style>
	:global(body) { font-family: system-ui, sans-serif; max-width: 980px; margin: 0 auto; padding: 16px; }
	h2 { font-size: 1.05rem; margin-top: 20px; }
	.topbar { display: flex; gap: 8px; }
	.nueva { background: #1a73e8; color: #fff; border: none; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
	.reimp { background: #fff3e0; color: #8a4b00; border: 1px solid #f0c089; border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 0.8rem; }
	.form { border: 1px solid #cdddff; background: #f7faff; border-radius: 8px; padding: 14px; margin: 12px 0; display: flex; flex-direction: column; gap: 9px; max-width: 380px; }
	.nuevo { border: 1px dashed #aaa; border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
	label { display: flex; flex-direction: column; font-size: 0.82rem; color: #555; gap: 3px; }
	input, select { padding: 6px; border: 1px solid #bbb; border-radius: 6px; font-size: 0.95rem; }
	.medio { display: flex; gap: 8px; }
	.medio button { flex: 1; padding: 7px; border: 1px solid #bbb; background: #fff; border-radius: 6px; cursor: pointer; }
	.medio button.activo { background: #1a73e8; color: #fff; border-color: #1a73e8; }
	.guardar { padding: 9px; background: #137333; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
	.hint { font-size: 0.82rem; color: #555; margin: 0; }
	.msg { font-weight: 600; margin: 0; }
	.resumen { display: flex; gap: 10px; flex-wrap: wrap; margin: 12px 0; }
	.card { border: 1px solid #ddd; border-radius: 8px; padding: 8px 14px; display: flex; flex-direction: column; min-width: 180px; }
	.card span { font-size: 0.72rem; color: #777; }
	.card strong { font-size: 1.05rem; }
	table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
	table.chica { width: auto; min-width: 240px; }
	th, td { border: 1px solid #ddd; padding: 5px 7px; text-align: left; }
	td.num { text-align: right; white-space: nowrap; }
	td.pctcol { text-align: center; }
	th.num { text-align: center; }
	th.hl, td.hl { background: #f1f6ff; }
	tr.liqrow { background: #f4fbf4; font-style: italic; }
	.pos { color: #137333; }
	.neg { color: #c5221f; }
	.lapiz { background: none; border: none; cursor: pointer; font-size: 0.8rem; opacity: 0.5; }
	.lapiz:hover { opacity: 1; }
	.precioedit input { width: 90px; padding: 2px 4px; }
	.okp { background: #137333; color: #fff; border: none; border-radius: 4px; cursor: pointer; padding: 1px 6px; margin-left: 2px; }
	.cancp { background: #eee; border: none; border-radius: 4px; cursor: pointer; padding: 1px 6px; margin-left: 2px; }
	.bars { display: flex; flex-direction: column; gap: 5px; margin-top: 6px; max-width: 640px; }
	.barrow { display: flex; align-items: center; gap: 8px; font-size: 0.82rem; }
	.lbl { width: 70px; color: #555; }
	.track { flex: 1; background: #f0f0f0; border-radius: 4px; height: 16px; overflow: hidden; }
	.bar { height: 100%; }
	.val { width: 170px; text-align: right; color: #333; }
	.del { background: #fce8e6; color: #c5221f; border: none; border-radius: 5px; padding: 2px 8px; cursor: pointer; }
	.nota { font-size: 0.8rem; color: #777; margin-top: 12px; }
</style>
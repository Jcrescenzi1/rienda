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

	const toUSD = (m: number, mon: string, vd: number | null) => (mon === 'USD' ? m : vd ? m / vd : 0);

	onMount(async () => {
		const dq = (await query('SELECT valor FROM cotizacion_dolar WHERE perfil_id=1 ORDER BY fecha DESC LIMIT 1')) as any[];
		dolar = dq[0]?.valor ?? 1;

		const activos = (await query('SELECT id, nombre, tipo, renta, moneda, precio_actual FROM activo WHERE perfil_id=1')) as any[];
		const aMap: Record<number, any> = {};
		for (const a of activos) aMap[a.id] = a;

		const txs = (await query(
			'SELECT activo_id, operacion, unidades, precio, fecha, valor_dolar FROM transaccion WHERE perfil_id=1 ORDER BY activo_id, fecha, id'
		)) as any[];

		// FIFO por activo. Realizado USD atribuido al AÑO DE CIERRE (fecha de la venta).
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
				const anioCierre = t.fecha.slice(0, 4);
				const q = lotes[t.activo_id];
				while (rem > 1e-9 && q.length) {
					const lote = q[0];
					const take = Math.min(rem, lote.u);
					realizAnioUSD[anioCierre] = (realizAnioUSD[anioCierre] ?? 0) + take * (pvUSD - lote.pUSD);
					lote.u -= take;
					rem -= take;
					if (lote.u < 1e-9) q.shift();
				}
			}
		}

		const hold: any[] = [];
		const buck: Record<string, number> = { Fija: 0, Mixta: 0, Variable: 0, Liquido: 0 };
		let tUSD = 0;
		let noRealUSD = 0;
		for (const [aid, q] of Object.entries(lotes)) {
			const u = q.reduce((s, l) => s + l.u, 0);
			if (u < 1e-6) continue;
			const a = aMap[Number(aid)];
			const costo = q.reduce((s, l) => s + l.u * l.pNat, 0);
			const costoUSD = q.reduce((s, l) => s + l.u * l.pUSD, 0);
			const ppc = costo / u;
			const pa = a.precio_actual ?? ppc;
			const mercado = u * pa;
			const ppv = pa;
			const mercadoUSD = a.moneda === 'USD' ? mercado : mercado / dolar;
			noRealUSD += mercadoUSD - costoUSD;
			buck[a.renta] = (buck[a.renta] ?? 0) + mercadoUSD;
			tUSD += mercadoUSD;
			hold.push({
				nombre: a.nombre, tipo: a.tipo, renta: a.renta, moneda: a.moneda,
				monto: costo, unidades: u, ppc, ppv, precioActual: pa, mercado,
				resultado: mercado - costo, pctRes: costo ? (mercado - costo) / costo : 0, mercadoUSD
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
			SELECT t.fecha, a.nombre, a.tipo, a.moneda, t.operacion, t.unidades, t.precio
			FROM transaccion t JOIN activo a ON a.id = t.activo_id
			WHERE t.perfil_id = 1 ORDER BY t.fecha DESC, t.id DESC LIMIT 40`)) as any[];

		cargando = false;
	});

	async function reimportar() {
		if (!confirm('Reimportar inversiones desde cero (borra y recarga los datos corregidos)?')) return;
		await query('DELETE FROM transaccion WHERE perfil_id=1');
		await query('DELETE FROM activo WHERE perfil_id=1');
		await query("DELETE FROM cuenta_inversion WHERE perfil_id=1 AND nombre='Cocos Capital'");
		location.reload();
	}

	const money = (n: number, mon: string, dec = 0) =>
		(mon === 'USD' ? 'U$D ' : '$') + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
	const usd = (n: number, dec = 0) => 'U$D ' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
	const pct = (n: number) => (n >= 0 ? '+' : '') + (n * 100).toFixed(1) + '%';
	const nf = (n: number) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 });
	const colorRenta: Record<string, string> = { Fija: '#2e7d32', Mixta: '#1a73e8', Variable: '#e8710a', Liquido: '#888' };
</script>

<h1>Inversiones</h1>

{#if cargando}
	<p>Cargando…</p>
{:else}
	<button class="reimp" onclick={reimportar}>🔄 Reimportar (corregir migración)</button>

	<div class="resumen">
		<div class="card"><span>Cartera actual (≈USD)</span><strong>{usd(totalUSD)}</strong></div>
		<div class="card"><span>Activo no realizado (≈USD)</span><strong class={activoNoRealizadoUSD >= 0 ? 'pos' : 'neg'}>{usd(activoNoRealizadoUSD, 2)}</strong></div>
	</div>

	<h2>Resultado realizado por año de cierre (USD)</h2>
	<table class="chica">
		<thead><tr><th>Año cierre</th><th>Realizado</th></tr></thead>
		<tbody>
			{#each anuales as a (a.anio)}
				<tr><td>{a.anio}</td><td class="num {a.valor >= 0 ? 'pos' : 'neg'}">{usd(a.valor, 2)}</td></tr>
			{/each}
		</tbody>
	</table>

	<h2>Estructura de renta (cartera ≈USD)</h2>
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
			{#each cartera as h (h.nombre + h.tipo + h.moneda)}
				<tr>
					<td>{h.tipo}</td>
					<td>{h.nombre}</td>
					<td class="pctcol">{(h.peso * 100).toFixed(1)}%</td>
					<td class="num">{money(h.monto, h.moneda)}</td>
					<td class="num">{nf(h.unidades)}</td>
					<td class="num hl">{money(h.ppc, h.moneda, 2)}</td>
					<td class="num hl">{money(h.ppv, h.moneda, 2)}</td>
					<td class="num">{money(h.precioActual, h.moneda, 2)}</td>
					<td class="num">{money(h.mercado, h.moneda)}</td>
					<td class="num hl {h.resultado >= 0 ? 'pos' : 'neg'}">{money(h.resultado, h.moneda)} ({pct(h.pctRes)})</td>
					
				</tr>
			{/each}
		</tbody>
	</table>

	<h2>Libro diario (últimas 40)</h2>
	<table>
		<thead><tr><th>Fecha</th><th>Activo</th><th>Tipo</th><th>Op.</th><th>Unidades</th><th>Precio</th><th>Monto</th></tr></thead>
		<tbody>
			{#each ledger as t (t.fecha + t.nombre + t.tipo + t.operacion + t.unidades)}
				<tr>
					<td>{t.fecha}</td>
					<td>{t.nombre}</td>
					<td>{t.tipo}</td>
					<td class={t.operacion === 'Compra' ? 'pos' : 'neg'}>{t.operacion}</td>
					<td class="num">{nf(t.unidades)}</td>
					<td class="num">{money(t.precio, t.moneda, 2)}</td>
					<td class="num">{money(t.unidades * t.precio, t.moneda)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
	<p class="nota">≈USD al dólar más reciente (${nf(dolar)}). Realizado atribuido al año de cierre (cuando vendiste), convertido a USD al dólar de cada operación.</p>
{/if}

<style>
	:global(body) { font-family: system-ui, sans-serif; max-width: 980px; margin: 0 auto; padding: 16px; }
	h2 { font-size: 1.05rem; margin-top: 20px; }
	.reimp { background: #fff3e0; color: #8a4b00; border: 1px solid #f0c089; border-radius: 6px; padding: 5px 10px; cursor: pointer; font-size: 0.8rem; }
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
	.pos { color: #137333; }
	.neg { color: #c5221f; }
	.bars { display: flex; flex-direction: column; gap: 5px; margin-top: 6px; max-width: 640px; }
	.barrow { display: flex; align-items: center; gap: 8px; font-size: 0.82rem; }
	.lbl { width: 70px; color: #555; }
	.track { flex: 1; background: #f0f0f0; border-radius: 4px; height: 16px; overflow: hidden; }
	.bar { height: 100%; }
	.val { width: 170px; text-align: right; color: #333; }
	.nota { font-size: 0.8rem; color: #777; margin-top: 12px; }
</style>
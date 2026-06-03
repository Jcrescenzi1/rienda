<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';

	let cargando = $state(true);
	let snaps = $state<any[]>([]);
	let modo = $state<'twr' | 'valor'>('twr');
	let periodo = $state<'total' | '1a' | '6m' | '3m' | '1m' | '1s'>('total');
	const periodos: [string, string][] = [['total', 'Total'], ['1a', '1 año'], ['6m', '6 meses'], ['3m', '3 meses'], ['1m', '1 mes'], ['1s', '1 semana']];

	let showFoto = $state(false);
	let realizadoMes = $state<any[]>([]);
	let fFlujo = $state(0); let fValorUSD = $state(0); let fValorARS = $state(0); let fDolar = $state(1);
	let fFecha = $state(new Date().toISOString().slice(0, 10));
	let fMsg = $state(''); let calculando = $state(false);

	async function cargar() {
		const rows = (await query('SELECT fecha, valor_usd, flujo_usd, valor_ars, dolar FROM snapshot WHERE perfil_id=1 ORDER BY fecha')) as any[];
		let idx = 100; let prev: number | null = null;
		snaps = rows.map((s) => {
			let r = 0;
			if (prev !== null && prev > 0) { r = (s.valor_usd - s.flujo_usd) / prev - 1; idx *= 1 + r; }
			prev = s.valor_usd;
			return { ...s, ret: r, idx };
		});
		// Ganancia realizada por mes de cierre (USD), desde las ventas
		const activos = (await query('SELECT id, moneda FROM activo WHERE perfil_id=1')) as any[];
		const aMon: Record<number, string> = {};
		for (const a of activos) aMon[a.id] = a.moneda;
		const txr = (await query('SELECT activo_id, operacion, unidades, precio, fecha, valor_dolar FROM transaccion WHERE perfil_id=1 ORDER BY activo_id, fecha, id')) as any[];
		const lot: Record<number, { u: number; pUSD: number }[]> = {};
		const realMes: Record<string, number> = {};
		const tu = (m: number, mon: string, vd: number | null) => (mon === 'USD' ? m : vd ? m / vd : 0);
		for (const t of txr) {
			const mon = aMon[t.activo_id];
			lot[t.activo_id] ??= [];
			if (t.operacion === 'Compra') {
				lot[t.activo_id].push({ u: t.unidades, pUSD: tu(t.precio, mon, t.valor_dolar) });
			} else {
				let rem = t.unidades; const pvUSD = tu(t.precio, mon, t.valor_dolar); const mes = t.fecha.slice(0, 7);
				const q = lot[t.activo_id];
				while (rem > 1e-9 && q.length) {
					const l = q[0]; const take = Math.min(rem, l.u);
					realMes[mes] = (realMes[mes] ?? 0) + take * (pvUSD - l.pUSD);
					l.u -= take; rem -= take;
					if (l.u < 1e-9) q.shift();
				}
			}
		}
		realizadoMes = Object.keys(realMes).sort().reverse().map((m) => ({ mes: m, valor: realMes[m] }));
		cargando = false;
	}
	onMount(cargar);

	async function prepararFoto() {
		calculando = true; fMsg = '';
		try {
			const dq = (await query("SELECT valor FROM cotizacion_dolar WHERE perfil_id=1 AND casa='bolsa' ORDER BY fecha DESC LIMIT 1")) as any[];
			const dolar = dq[0]?.valor ?? 1; fDolar = dolar;
			const activos = (await query('SELECT id, moneda, precio_actual FROM activo WHERE perfil_id=1')) as any[];
			const aMap: Record<number, any> = {};
			for (const a of activos) aMap[a.id] = a;
			const txs = (await query('SELECT activo_id, operacion, unidades, precio FROM transaccion WHERE perfil_id=1 ORDER BY activo_id, fecha, id')) as any[];
			const net: Record<number, { u: number }> = {};
			for (const t of txs) { net[t.activo_id] ??= { u: 0 }; net[t.activo_id].u += (t.operacion === 'Compra' ? 1 : -1) * t.unidades; }
			let valUSD = 0;
			for (const [aid, h] of Object.entries(net)) {
				if (h.u < 1e-6) continue;
				const a = aMap[Number(aid)]; const mercado = h.u * (a.precio_actual ?? 0);
				valUSD += a.moneda === 'USD' ? mercado : mercado / dolar;
			}
			const anchor = (await query('SELECT moneda, saldo FROM liquidez WHERE perfil_id=1')) as any[];
			const movc = (await query('SELECT moneda, COALESCE(SUM(monto),0) s FROM mov_caja WHERE perfil_id=1 GROUP BY moneda')) as any[];
			const tcash = (await query("SELECT moneda_pago m, COALESCE(SUM(CASE WHEN operacion='Venta' THEN monto_pago ELSE -monto_pago END),0) s FROM transaccion WHERE perfil_id=1 AND monto_pago IS NOT NULL GROUP BY moneda_pago")) as any[];
			const bal: Record<string, number> = { ARS: 0, USD: 0 };
			for (const a of anchor) bal[a.moneda] = (bal[a.moneda] ?? 0) + a.saldo;
			for (const r of movc) bal[r.moneda] = (bal[r.moneda] ?? 0) + r.s;
			for (const r of tcash) if (r.m) bal[r.m] = (bal[r.m] ?? 0) + r.s;
			valUSD += (bal.USD ?? 0) + (bal.ARS ?? 0) / dolar;
			fValorUSD = valUSD; fValorARS = valUSD * dolar;
			const ult = snaps.length ? snaps[snaps.length - 1].fecha : '2000-01-01';
			const fl = (await query("SELECT COALESCE(SUM(CASE WHEN moneda='USD' THEN monto ELSE monto/? END),0) AS f FROM mov_caja WHERE perfil_id=1 AND accion IN ('Ingreso','Retiro') AND fecha > ?", [dolar, ult])) as any[];
			fFlujo = Math.round((fl[0]?.f ?? 0) * 100) / 100;
			showFoto = true;
		} catch (e: any) { fMsg = 'Error: ' + (e?.message ?? String(e)); }
		calculando = false;
	}

	async function guardarFoto() {
		try {
			await query('INSERT INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,?,?,?,?,?) ON CONFLICT(perfil_id,fecha) DO UPDATE SET valor_usd=excluded.valor_usd, flujo_usd=excluded.flujo_usd, dolar=excluded.dolar, valor_ars=excluded.valor_ars',
				[fFecha, fValorUSD, fFlujo, fDolar, fValorARS]);
			showFoto = false; fMsg = ''; await cargar();
		} catch (e: any) { fMsg = 'Error: ' + (e?.message ?? String(e)); }
	}

	const usd = (n: number, d = 0) => 'U$D ' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
	const ars = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
	const pct = (n: number) => (n >= 0 ? '+' : '') + (n * 100).toFixed(1) + '%';
	const mesCorto = (f: string) => {
		const [y, m] = f.split('-');
		return ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][+m] + " '" + y.slice(2);
	};

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
		return d.toISOString().slice(0, 10);
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

	const W = 720, H = 300, P = { l: 52, r: 16, t: 16, b: 28 };
	let chart = $derived.by(() => {
		if (vsnaps.length < 2) return null;
		const vals = vsnaps.map((s) => (modo === 'twr' ? s.cidx : s.valor_usd));
		const xs = vsnaps.map((s) => new Date(s.fecha).getTime());
		const minX = xs[0], maxX = xs[xs.length - 1];
		let minY = Math.min(...vals), maxY = Math.max(...vals);
		const padY = (maxY - minY) * 0.1 || 1; minY -= padY; maxY += padY;
		const px = (x: number) => P.l + ((x - minX) / (maxX - minX || 1)) * (W - P.l - P.r);
		const py = (y: number) => H - P.b - ((y - minY) / (maxY - minY || 1)) * (H - P.t - P.b);
		const pts = vsnaps.map((s, i) => ({ x: px(xs[i]), y: py(vals[i]) }));
		const line = pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
		const area = line + ` L${pts[pts.length - 1].x.toFixed(1)},${H - P.b} L${pts[0].x.toFixed(1)},${H - P.b} Z`;
		const yticks = Array.from({ length: 4 }, (_, i) => {
			const v = minY + ((maxY - minY) * i) / 3;
			return { y: py(v), label: modo === 'twr' ? v.toFixed(0) : Math.round(v / 1000) + 'k' };
		});
		const step = Math.max(1, Math.floor(vsnaps.length / 6));
		const xticks = vsnaps.filter((_, i) => i % step === 0).map((s) => ({ x: px(new Date(s.fecha).getTime()), label: mesCorto(s.fecha) }));
		return { line, area, pts, yticks, xticks };
	});
</script>

<h1>Evolución de cartera</h1>

<button class="foto" onclick={prepararFoto} disabled={calculando}>{calculando ? 'Calculando…' : '📸 Guardar foto'}</button>

{#if showFoto}
	<div class="fotoform">
		<h3>Nueva foto — {fFecha}</h3>
		<label>Fecha<input type="date" bind:value={fFecha} /></label>
		<p class="calc">Valor calculado: <strong>{usd(fValorUSD)}</strong> ({ars(fValorARS)} · dólar {fDolar})</p>
		<label>Flujo neto desde la última foto (USD)<input type="number" step="any" bind:value={fFlujo} /></label>
		<p class="hint">Calculado de tus Ingresos/Retiros. Editalo si hace falta.</p>
		<div class="botones"><button class="guardar" onclick={guardarFoto}>Guardar foto</button><button class="cancelar" onclick={() => (showFoto = false)}>Cancelar</button></div>
		{#if fMsg}<p class="msg">{fMsg}</p>{/if}
	</div>
{/if}

{#if cargando}
	<p>Cargando…</p>
{:else if snaps.length < 2}
	<p>Necesitás al menos 2 fotos para ver evolución.</p>
{:else}
	<div class="periodos">
		{#each periodos as [k, lbl]}
			<button class:activo={periodo === k} onclick={() => (periodo = k as any)}>{lbl}</button>
		{/each}
	</div>

	<div class="resumen">
		<div class="card big"><span>TWR del período</span><strong class={twrVentana >= 0 ? 'pos' : 'neg'}>{pct(twrVentana)}</strong></div>
		<div class="card"><span>Valor actual</span><strong>{usd(actual.valor_usd)}</strong></div>
		<div class="card"><span>Aportes netos (período)</span><strong>{usd(flujoVentana)}</strong></div>
		<div class="card"><span>Desde</span><strong>{baseSnap.fecha}</strong></div>
	</div>

	<div class="toggle">
		<button class:activo={modo === 'twr'} onclick={() => (modo = 'twr')}>Rendimiento (base 100)</button>
		<button class:activo={modo === 'valor'} onclick={() => (modo = 'valor')}>Valor (USD)</button>
	</div>

	{#if chart}
		<svg viewBox="0 0 {W} {H}" class="chart">
			{#each chart.yticks as t}<line x1={P.l} y1={t.y} x2={W - P.r} y2={t.y} class="grid" /><text x={P.l - 6} y={t.y + 3} class="ylbl">{t.label}</text>{/each}
			{#each chart.xticks as t}<text x={t.x} y={H - 8} class="xlbl">{t.label}</text>{/each}
			<path d={chart.area} class="area" /><path d={chart.line} class="line" />
			{#each chart.pts as p}<circle cx={p.x} cy={p.y} r="2.5" class="dot" />{/each}
		</svg>
	{:else}
		<p class="nota">No hay suficientes fotos en este período para graficar.</p>
	{/if}

	<h2>Ganancia realizada por mes (USD)</h2>
	{#if realizadoMes.length}
		<table class="chica">
			<thead><tr><th>Mes</th><th class="num">Realizado</th></tr></thead>
			<tbody>
				{#each realizadoMes as r (r.mes)}
					<tr><td>{r.mes}</td><td class="num {r.valor >= 0 ? 'pos' : 'neg'}">{usd(r.valor, 2)}</td></tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<p class="nota">Todavía no hay ventas registradas.</p>
	{/if}

	<p class="nota">TWR: rendimiento de la estrategia neutralizando aportes y retiros. El gráfico y el TWR de arriba se ajustan al período elegido (re-basado a 100 al inicio de la ventana).</p>
{/if}

<style>
:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	h2 { font-size: 1.05rem; margin-top: 24px; }
	h3 { margin: 0 0 4px; font-size: 1rem; }
	.foto { background: var(--pos); color: #06281a; font-weight: 600; border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer; font-size: 0.95rem; margin-bottom: 10px; }
	.foto:disabled { opacity: 0.6; }
	.fotoform { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 14px; margin-bottom: 14px; display: flex; flex-direction: column; gap: 9px; max-width: 420px; }
	.calc { margin: 0; font-size: 0.9rem; }
	label { display: flex; flex-direction: column; font-size: 0.82rem; color: var(--text-dim); gap: 3px; }
	input { padding: 6px; font-size: 0.95rem; }
	.hint { font-size: 0.78rem; color: var(--text-dim); margin: 0; }
	.botones { display: flex; gap: 8px; }
	.guardar { padding: 8px 14px; background: var(--pos); color: #06281a; font-weight: 600; border: none; border-radius: 6px; cursor: pointer; }
	.cancelar { padding: 8px 14px; background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
	.msg { font-weight: 600; margin: 0; }
	.periodos { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0 12px; }
	.periodos button { padding: 5px 12px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); border-radius: 20px; cursor: pointer; font-size: 0.82rem; }
	.periodos button.activo { background: var(--accent); color: #fff; border-color: var(--accent); }
	.resumen { display: flex; gap: 10px; flex-wrap: wrap; margin: 12px 0; }
	.card { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 8px 14px; display: flex; flex-direction: column; min-width: 130px; }
	.card.big strong { font-size: 1.5rem; }
	.card span { font-size: 0.72rem; color: var(--text-dim); }
	.card strong { font-size: 1.05rem; }
	.toggle { display: flex; gap: 6px; margin: 8px 0; }
	.toggle button { padding: 5px 12px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
	.toggle button.activo { background: var(--accent); color: #fff; border-color: var(--accent); }
	.chart { width: 100%; height: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
	.grid { stroke: var(--border); stroke-width: 1; }
	.ylbl { font-size: 10px; fill: var(--text-dim); text-anchor: end; }
	.xlbl { font-size: 10px; fill: var(--text-dim); text-anchor: middle; }
	.area { fill: rgba(91, 157, 255, 0.10); stroke: none; }
	.line { fill: none; stroke: var(--accent); stroke-width: 2; }
	.dot { fill: var(--accent); }
	table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
	th, td { padding: 5px 7px; text-align: left; }
	td.num, th.num { text-align: right; }
	table.chica { width: auto; min-width: 240px; }
	.nota { font-size: 0.8rem; color: var(--text-dim); margin-top: 12px; }
</style>
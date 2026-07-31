<script lang="ts">
	import { onMount } from 'svelte';
	import { calcularFIFO, calcularLiquidez, dolarActual, aUSD } from '$lib/cartera';
	import { pesos, unidades } from '$lib/format';
	import Guia from '$lib/Guia.svelte';
	import CountUp from '$lib/CountUp.svelte';
	import Skeleton from '$lib/Skeleton.svelte';

	// Foto pura de valuación actual: tipo, unidades, precio y monto de cada
	// activo en tenencia + liquidez ARS/USD, sin recuperado por ventas ni renta
	// ni ganancia — eso ya está en /inversiones. Convierte todo al MEP de HOY
	// (dolarActual()), no al dólar de cada operación. "Valor invertido" es una
	// excepción pedida aparte: el costo de compra de la posición ABIERTA actual
	// (mismo criterio que el PPC/Rend.% de /inversiones — se reinicia si el
	// activo llegó a tenencia cero en algún momento).
	let cargando = $state(true);
	let filas = $state<{ tipo: string; nombre: string; unidades: number; precio: number; moneda: string; montoARS: number; montoUSD: number }[]>([]);
	let dolar = $state(1);
	let vista = $state<'ARS' | 'USD'>('USD');
	let liqUSD = $state(0);
	let invertidoUSD = $state(0);

	onMount(async () => {
		const [{ lotes, aMap, txs }, liq, d] = await Promise.all([calcularFIFO(), calcularLiquidez(), dolarActual()]);
		dolar = d;

		const filasActivos = Object.entries(lotes)
			.map(([aid, q]) => {
				const u = q.reduce((s, l) => s + l.u, 0);
				if (u < 1e-6) return null;
				const a = aMap[Number(aid)];
				const precio = a.precio_actual ?? 0;
				const monto = u * precio; // en moneda nativa del activo
				const montoARS = a.moneda === 'USD' ? monto * dolar : monto;
				const montoUSD = a.moneda === 'USD' ? monto : monto / dolar;
				return { tipo: a.tipo, nombre: a.nombre, unidades: u, precio, moneda: a.moneda, montoARS, montoUSD };
			})
			.filter((f): f is NonNullable<typeof f> => f !== null);

		const filasLiq = (['ARS', 'USD'] as const)
			.map((mon) => {
				const saldo = liq[mon] ?? 0;
				return {
					tipo: 'Caja', nombre: 'Líquido ' + mon, unidades: saldo, precio: 1, moneda: mon,
					montoARS: mon === 'USD' ? saldo * dolar : saldo,
					montoUSD: mon === 'USD' ? saldo : saldo / dolar
				};
			})
			.filter((f) => Math.abs(f.montoARS) > 1e-6);

		filas = [...filasActivos, ...filasLiq];
		liqUSD = filasLiq.reduce((s, f) => s + f.montoUSD, 0);

		// Costo de compra de la posición abierta actual (mismo criterio de reset
		// de episodio que usa /inversiones para PPC): recorro las transacciones y
		// reinicio el acumulado cada vez que la tenencia de un activo vuelve a cero.
		const agg: Record<number, { invUSD: number }> = {};
		const heldRun: Record<number, number> = {};
		for (const t of txs) {
			const a = aMap[t.activo_id];
			if (!a) continue;
			agg[t.activo_id] ??= { invUSD: 0 };
			heldRun[t.activo_id] ??= 0;
			const enUSD = aUSD(t.precio, a.moneda, t.valor_dolar) * t.unidades;
			if (t.operacion === 'Compra') {
				heldRun[t.activo_id] += t.unidades;
				agg[t.activo_id].invUSD += enUSD;
			} else {
				heldRun[t.activo_id] -= t.unidades;
				if (heldRun[t.activo_id] <= 1e-9) { heldRun[t.activo_id] = 0; agg[t.activo_id] = { invUSD: 0 }; }
			}
		}
		invertidoUSD = Object.entries(lotes).reduce((s, [aid, q]) => {
			const u = q.reduce((sq, l) => sq + l.u, 0);
			if (u < 1e-6) return s;
			const costoUSD = q.reduce((sq, l) => sq + l.u * l.pUSD, 0); // fallback si no hay agg
			return s + (agg[Number(aid)]?.invUSD ?? costoUSD);
		}, 0);

		cargando = false;
	});

	let totalUSD = $derived(filas.reduce((s, f) => s + f.montoUSD, 0));
	let liqPct = $derived(totalUSD ? (liqUSD / totalUSD) * 100 : 0);
	let filasOrdenadas = $derived(
		filas
			.map((f) => ({ ...f, pct: totalUSD ? f.montoUSD / totalUSD : 0 }))
			.sort((a, b) => b.montoUSD - a.montoUSD)
	);
	const money = pesos;
	const enVista = (usdVal: number) => (vista === 'ARS' ? money(usdVal * dolar, 'ARS') : money(usdVal, 'USD'));
</script>

<div class="titulo-guia">
	<h1>Tenencia en montos</h1>
	<Guia clave="inversiones-montos" texto="Valuación actual de cada posición: unidades × precio de mercado, en pesos o dólares al tipo de cambio MEP de hoy. No incluye recuperado por ventas, renta ni ganancia/pérdida — eso está en Tenencia Actual." />
</div>
<a href="/inversiones" class="btn-volver">← Volver a Tenencia Actual</a>

{#if cargando}
	<div class="sk-vistas">
		<Skeleton w="80px" h="30px" radius="6px" />
		<Skeleton w="80px" h="30px" radius="6px" />
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
	</div>
{:else}
	<div class="vistas">
		<button class:activo={vista === 'ARS'} onclick={() => (vista = 'ARS')}>ARS</button>
		<button class:activo={vista === 'USD'} onclick={() => (vista = 'USD')}>USD</button>
	</div>

	<div class="resumen">
		<div class="card destacado"><span>Valor cartera ({vista})</span><strong><CountUp value={totalUSD} format={enVista} /></strong></div>
		<div class="card"><span>Valor invertido ({vista})</span><strong><CountUp value={invertidoUSD} format={enVista} /></strong></div>
		<div class="card"><span>% de liquidez</span><strong><CountUp value={liqPct} format={(n) => n.toFixed(1) + '%'} /></strong></div>
	</div>

	<div class="moneda-fija">
		<span class="moneda-badge">Dólar MEP (bolsa) {money(dolar, 'ARS')}</span>
	</div>

	<div class="tabla-scroll">
	<table>
		<thead><tr><th>Tipo</th><th>Activo</th><th class="num">Unidades</th><th class="num">Precio</th><th class="num">Monto ({vista})</th><th class="num">% total</th></tr></thead>
		<tbody>
			{#each filasOrdenadas as f (f.tipo + f.nombre)}
				<tr>
					<td>{f.tipo}</td>
					<td>{f.nombre}</td>
					<td class="num">{f.tipo === 'Caja' ? '—' : unidades(f.unidades)}</td>
					<td class="num">{f.tipo === 'Caja' ? '—' : money(f.precio, f.moneda, 2)}</td>
					<td class="num">{vista === 'ARS' ? money(f.montoARS, 'ARS') : money(f.montoUSD, 'USD')}</td>
					<td class="num">{(f.pct * 100).toFixed(1)}%</td>
				</tr>
			{/each}
			{#if filasOrdenadas.length === 0}<tr><td colspan="6" class="vacio">No tenés activos en cartera.</td></tr>{/if}
		</tbody>
	</table>
	</div>
{/if}

<style>
:global(body) { max-width: 980px; margin: 0 auto; padding: 16px; }
	.sk-vistas { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0; }
	.sk-tabla { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
	/* Cápsula única (mismo look que .toggle-moneda de ToggleMoneda.svelte / .toggle-modo
	   de Categorias.svelte) — acá .vistas es un toggle de moneda, no un selector de
	   período, así que se separa del patrón .vistas de pastillas sueltas del resto de
	   la app y se le da el mismo tratamiento que los otros toggles de moneda. */
	.vistas { display: flex; width: fit-content; gap: 0; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; margin: 10px 0; }
	.vistas button { background: var(--surface-2); color: var(--text); border: none; border-right: 1px solid var(--border); padding: 6px 14px; cursor: pointer; font-size: 0.85rem; white-space: nowrap; }
	.vistas button:last-child { border-right: none; }
	.vistas button.activo { background: var(--accent); color: #fff; font-weight: 600; }
	.moneda-fija { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: 6px 0 12px; }
	.moneda-badge { font-size: 0.8rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 5px 12px; color: var(--text); }
	table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
	th, td { padding: 5px 7px; text-align: left; }
	td.num { text-align: right; white-space: nowrap; }
	th.num { text-align: center; }
	.vacio { text-align: center; color: var(--text-dim); font-style: italic; }
</style>

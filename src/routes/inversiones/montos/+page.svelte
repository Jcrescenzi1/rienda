<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import { calcularTenencia, invalidarFotosDesde } from '$lib/cartera';
	import { upsertPrecioHistorico } from '$lib/db/precios_historicos';
	import { pesos, unidades, parseNum, formatNum, montoAGuardar, soloNum, hoyISO } from '$lib/format';
	import { Toast } from '$lib/toast.svelte';
	import Guia from '$lib/Guia.svelte';
	import CountUp from '$lib/CountUp.svelte';
	import Skeleton from '$lib/Skeleton.svelte';

	// Bloque 6: única pantalla del módulo con montos absolutos, y único lugar
	// donde se edita algo (precio de mercado + caja ARS/USD). Todo lo demás
	// (tenencia, PPC/PPV, estructura, rendimiento) vive en Tenencia Actual.
	let cargando = $state(true);
	let hold = $state<any[]>([]);
	let dolar = $state(1);
	let vista = $state<'ARS' | 'USD'>('USD');
	let totalUSD = $state(0);
	let invertidoUSD = $state(0);
	let resultadoAbiertoUSD = $state(0);
	let liqSaldos = $state<Record<string, number>>({ ARS: 0, USD: 0 });

	const toast = new Toast();

	async function cargarTodo() {
		const t = await calcularTenencia();
		dolar = t.dolar;
		hold = t.hold;
		totalUSD = t.totalUSD;
		invertidoUSD = t.invertidoUSD;
		resultadoAbiertoUSD = t.resultadoAbiertoUSD;
		liqSaldos = t.liqSaldos;
		cargando = false;
	}
	onMount(cargarTodo);

	// Filas de la tabla: activos en tenencia + líquido (ARS/USD), con el monto
	// ya calculado en las dos monedas para no recalcular al togglear vista.
	let filas = $derived.by(() => {
		const filasActivos = hold.map((h) => ({
			id: h.id, tipo: h.tipo, nombre: h.nombre, unidades: h.unidades, precio: h.precioActual, moneda: h.moneda,
			montoARS: h.moneda === 'USD' ? h.mercado * dolar : h.mercado,
			montoUSD: h.mercadoUSD,
			esCaja: false as const, cajaMoneda: null as string | null
		}));
		const filasLiq = (['ARS', 'USD'] as const)
			.map((mon) => {
				const saldo = liqSaldos[mon] ?? 0;
				return {
					id: -1, tipo: 'Caja', nombre: 'Líquido ' + mon, unidades: saldo, precio: 1, moneda: mon,
					montoARS: mon === 'USD' ? saldo * dolar : saldo,
					montoUSD: mon === 'USD' ? saldo : saldo / dolar,
					esCaja: true as const, cajaMoneda: mon as string | null
				};
			})
			.filter((f) => Math.abs(f.montoARS) > 1e-6);
		return [...filasActivos, ...filasLiq]
			.map((f) => ({ ...f, pct: totalUSD ? f.montoUSD / totalUSD : 0 }))
			.sort((a, b) => b.montoUSD - a.montoUSD);
	});

	const money = pesos;
	const enVista = (usdVal: number) => (vista === 'ARS' ? money(usdVal * dolar, 'ARS') : money(usdVal, 'USD'));

	// Edición de precio de mercado: único lugar del módulo donde se edita —
	// necesario para FCI y activos sin cobertura de precio, y como escape para
	// corregir un precio arrastrado (Bloque 1). Además de precio_actual (como
	// antes), queda registrado en precio_historico con origen='manual' — gana
	// sobre cualquier fuente automática (ver precios_historicos.ts) — e invalida
	// la foto de hoy (Bloque 4). Manejo de errores: consola con el detalle
	// técnico, mensaje sobrio en pantalla, confirmación en éxito (patrón Toast).
	let editId = $state<number | null>(null);
	let editPrecio = $state('');
	function abrirEditPrecio(f: any) { editId = f.id; editPrecio = formatNum(f.precio, 2); }
	async function guardarPrecio() {
		const p = parseNum(editPrecio);
		if (editId == null || !Number.isFinite(p) || p <= 0) { editId = null; return; }
		const id = editId;
		try {
			await query('UPDATE activo SET precio_actual=?, precio_actualizado_en=? WHERE id=? AND perfil_id=1', [p, new Date().toISOString(), id]);
			await upsertPrecioHistorico(id, hoyISO(), p, 'manual');
			invalidarFotosDesde(hoyISO()).catch(() => {});
			editId = null; editPrecio = '';
			await cargarTodo();
			toast.exito('Precio actualizado ✅');
		} catch (e: any) { toast.errorTecnico(e); }
	}

	// Edición de Caja ARS/USD: escape para corregir el saldo (p. ej. mientras el
	// money market no esté modelado como activo — Bloque 3). Ledger append-only:
	// no pisa nada, inserta el ajuste como un mov_caja más.
	let editCaja = $state<string | null>(null);
	let editSaldo = $state('');
	function abrirEditCaja(mon: string) { editCaja = mon; editSaldo = formatNum(liqSaldos[mon] ?? 0, 0); }
	async function guardarCaja() {
		const original = liqSaldos[editCaja ?? ''] ?? 0;
		const s = montoAGuardar(editSaldo, original);
		if (editCaja == null || !Number.isFinite(s) || s < 0) { editCaja = null; return; }
		const ajuste = s - (liqSaldos[editCaja] ?? 0);
		if (Math.abs(ajuste) <= 1e-6) { editCaja = null; return; }
		const mon = editCaja;
		try {
			await query('INSERT INTO mov_caja (perfil_id,fecha,accion,moneda,monto,nota) VALUES (1,?,?,?,?,?)',
				[hoyISO(), 'Ajuste', mon, ajuste, 'Ajuste de saldo']);
			invalidarFotosDesde(hoyISO()).catch(() => {});
			editCaja = null; editSaldo = '';
			await cargarTodo();
			toast.exito('Caja actualizada ✅');
		} catch (e: any) { toast.errorTecnico(e); }
	}
</script>

<div class="titulo-guia">
	<h1>Tenencia en montos</h1>
	<Guia clave="inversiones-montos" texto="Valuación con montos, en pesos o dólares al MEP de hoy. Acá se edita: el precio de mercado de cada activo (✏) y la caja en ARS/USD (✏). Ganancia realizada del año, en Evolución de cartera." />
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
		<div class="card"><span>Ganancia no realizada ({vista})</span><strong class={resultadoAbiertoUSD >= 0 ? 'pos' : 'neg'}><CountUp value={resultadoAbiertoUSD} format={enVista} /></strong></div>
	</div>

	<div class="moneda-fija">
		<span class="moneda-badge">Dólar MEP (bolsa) {money(dolar, 'ARS')}</span>
	</div>

	{#if toast.texto}<p class="msg" class:err={toast.esError}>{#if toast.esError}<span class="err-x">✗</span> {/if}{toast.texto}</p>{/if}

	<div class="tabla-scroll">
	<table>
		<thead><tr><th>Tipo</th><th>Activo</th><th class="num">Unidades</th><th class="num">Precio</th><th class="num">Monto ({vista})</th><th class="num">% total</th></tr></thead>
		<tbody>
			{#each filas as f (f.esCaja ? 'caja-' + f.nombre : f.id)}
				<tr>
					<td>{f.tipo}</td>
					<td>{f.nombre}</td>
					<td class="num">{f.esCaja ? '—' : unidades(f.unidades)}</td>
					<td class="num precioedit">
						{#if f.esCaja}
							—
						{:else if editId === f.id}
							<input type="text" inputmode="decimal" use:soloNum bind:value={editPrecio} onkeydown={(e) => e.key === 'Enter' && guardarPrecio()} />
							<button aria-label="Guardar" class="okp" onclick={guardarPrecio}>✓</button><button aria-label="Cancelar" class="cancp" onclick={() => (editId = null)}>✕</button>
						{:else}
							{money(f.precio, f.moneda, 2)}<button aria-label="Editar" class="lapiz" onclick={() => abrirEditPrecio(f)}>✏</button>
						{/if}
					</td>
					<td class="num precioedit">
						{#if f.esCaja && editCaja === f.cajaMoneda}
							<input type="text" inputmode="decimal" use:soloNum bind:value={editSaldo} onkeydown={(e) => e.key === 'Enter' && guardarCaja()} />
							<button aria-label="Guardar" class="okp" onclick={guardarCaja}>✓</button><button aria-label="Cancelar" class="cancp" onclick={() => (editCaja = null)}>✕</button>
						{:else if f.esCaja}
							{vista === 'ARS' ? money(f.montoARS, 'ARS') : money(f.montoUSD, 'USD')}<button aria-label="Editar" class="lapiz" onclick={() => abrirEditCaja(f.cajaMoneda ?? '')}>✏</button>
						{:else}
							{vista === 'ARS' ? money(f.montoARS, 'ARS') : money(f.montoUSD, 'USD')}
						{/if}
					</td>
					<td class="num">{(f.pct * 100).toFixed(1)}%</td>
				</tr>
			{/each}
			{#if filas.length === 0}<tr><td colspan="6" class="vacio">No tenés activos en cartera.</td></tr>{/if}
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
	.precioedit input { width: 90px; padding: 2px 4px; }
	.msg { font-weight: 600; margin: 6px 0; }
	.msg.err { display: flex; align-items: center; gap: 6px; color: var(--neg); }
	.err-x { font-size: 1.3em; line-height: 1; }
	.pos { color: var(--pos); }
	.neg { color: var(--neg); }
</style>

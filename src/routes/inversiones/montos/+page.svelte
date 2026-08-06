<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import { calcularTenencia, invalidarFotosDesde } from '$lib/cartera';
	import { actualizarPreciosYFoto } from '$lib/db/precios';
	import { upsertPrecioHistorico } from '$lib/db/precios_historicos';
	import { pesos, unidades, parseNum, formatNum, soloNum, hoyISO } from '$lib/format';
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
	// % de Invertido sobre el Valor Cartera: como Invertido = valor de mercado de
	// la tenencia (invertidoUSD + liquidez = totalUSD, exacto), el complemento
	// (100% - esto) es cuánto de la cartera es líquido, en una sola foto.
	const pctInvertido = $derived(totalUSD ? invertidoUSD / totalUSD : 0);

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

	// Mismo botón que en Tenencia Actual, para no tener que ir y volver solo para
	// ver los montos frescos. Se cierra la edición de precio que estuviera abierta
	// antes de refrescar: si no, el input quedaría apuntando a una fila ya recargada.
	let actualizandoPrecios = $state(false);
	async function onActualizarPrecios() {
		editId = null; editPrecio = '';
		actualizandoPrecios = true;
		toast.limpiar();
		try { toast.exito(await actualizarPreciosYFoto()); await cargarTodo(); }
		catch (e: any) { toast.errorTecnico(e); }
		actualizandoPrecios = false;
	}

	// Filas de la tabla: activos en tenencia + líquido (ARS/USD), con el monto
	// ya calculado en las dos monedas para no recalcular al togglear vista.
	let filas = $derived.by(() => {
		const filasActivos = hold.map((h) => ({
			id: h.id, tipo: h.tipo, nombre: h.nombre, unidades: h.unidades, precio: h.precioActual, moneda: h.moneda,
			montoARS: h.moneda === 'USD' ? h.mercado * dolar : h.mercado,
			montoUSD: h.mercadoUSD,
			esCaja: false as const
		}));
		const filasLiq = (['ARS', 'USD'] as const)
			.map((mon) => {
				const saldo = liqSaldos[mon] ?? 0;
				return {
					id: -1, tipo: 'Caja', nombre: 'Líquido ' + mon, unidades: saldo, precio: 1, moneda: mon,
					montoARS: mon === 'USD' ? saldo * dolar : saldo,
					montoUSD: mon === 'USD' ? saldo : saldo / dolar,
					esCaja: true as const
				};
			})
			.filter((f) => Math.abs(f.montoARS) > 1e-6);
		return [...filasActivos, ...filasLiq]
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

	// La CAJA NO SE EDITA acá. La liquidez es una consecuencia del ledger: cambia
	// solo por movimientos registrados (ingresos, retiros, conversiones y el efecto
	// caja de compras, ventas y rentas). Antes esta pantalla ofrecía un lápiz que
	// insertaba un mov_caja de 'Ajuste' para cuadrar el saldo a mano; se quitó
	// porque convertía la caja en un número editable y rompía la trazabilidad: el
	// saldo dejaba de poder explicarse por los movimientos que lo formaron. Si el
	// saldo no cuadra, lo que falta es un movimiento, y ese se carga en Movimientos.
	// Los ajustes ya insertados en su momento siguen contando: son mov_caja como
	// cualquier otro, no hay nada que migrar.
</script>

<div class="titulo-guia">
	<h1>Tenencia en montos</h1>
	<Guia
		clave="inversiones-montos"
		para="Ver tu cartera con montos y corregir lo que la fuente de precios no cubre."
		uso="Lo único editable acá es el precio de mercado de un activo, con el lápiz, y es para lo que no se actualiza solo, como los FCI: en lo demás el próximo refresco vuelve al valor de la fuente. La caja no se edita, cambia sola con los movimientos que registrás."
	/>
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
		<div class="card">
			<span>Valor invertido ({vista})</span>
			<strong><CountUp value={invertidoUSD} format={enVista} /></strong>
			<span class="dato-sec">{(pctInvertido * 100).toFixed(1)}% de la cartera</span>
		</div>
		<div class="card"><span>Resultado de tenencia ({vista})</span><strong class={resultadoAbiertoUSD >= 0 ? 'pos' : 'neg'}><CountUp value={resultadoAbiertoUSD} format={enVista} /></strong></div>
	</div>

	<div class="moneda-fija">
		<span class="moneda-badge">Dólar MEP (bolsa) {money(dolar, 'ARS')}</span>
	</div>

	<div class="preciosbar">
		<button class="btn btn-secondary" onclick={onActualizarPrecios} disabled={actualizandoPrecios}>{actualizandoPrecios ? 'Actualizando…' : '⟳ Actualizar precios'}</button>
		<a href="/carga-inversiones" class="btn btn-secondary">💵 Mover caja</a>
	</div>

	{#if toast.texto}<p class="msg" class:err={toast.esError}>{#if toast.esError}<span class="err-x">✗</span> {/if}{toast.texto}</p>{/if}

	<div class="tabla-scroll">
	<table>
		<thead><tr><th>Activo</th><th class="num">Unidades</th><th class="num">Precio</th><th class="num">Monto ({vista})</th></tr></thead>
		<tbody>
			{#each filas as f (f.esCaja ? 'caja-' + f.nombre : f.id)}
				<tr>
					<td><div class="activo-cell"><span class="tipo-mini">{f.tipo}</span><span>{f.nombre}</span></div></td>
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
					<td class="num">
						{vista === 'ARS' ? money(f.montoARS, 'ARS') : money(f.montoUSD, 'USD')}
					</td>
				</tr>
			{/each}
			{#if filas.length === 0}<tr><td colspan="5" class="vacio">No tenés activos en cartera.</td></tr>{/if}
		</tbody>
	</table>
	</div>
{/if}

<style>
:global(body) { max-width: 980px; margin: 0 auto; padding: 16px; }
	.dato-sec { font-size: 0.7rem; color: var(--text-dim); font-weight: 400; text-transform: none; letter-spacing: normal; }
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
	.preciosbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 8px 0; }
	table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
	th, td { padding: 5px 7px; text-align: left; }
	td.num { text-align: right; white-space: nowrap; }
	th.num { text-align: center; }
	/* Tipo arriba (chico, mudo) + nombre abajo, mismo patrón que .activo-cell de
	   Tenencia Actual (inversiones/+page.svelte), para que ambas tablas lean igual. */
	.activo-cell { display: flex; flex-direction: column; gap: 1px; }
	.tipo-mini { font-size: 0.68rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.03em; }
	.vacio { text-align: center; color: var(--text-dim); font-style: italic; }
	.precioedit input { width: 90px; padding: 2px 4px; }
	.msg { font-weight: 600; margin: 6px 0; }
	.msg.err { display: flex; align-items: center; gap: 6px; color: var(--neg); }
	.err-x { font-size: 1.3em; line-height: 1; }
	.pos { color: var(--pos); }
	.neg { color: var(--neg); }
</style>

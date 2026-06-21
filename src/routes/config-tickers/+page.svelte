<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';
	import { previsualizarPrecios, actualizarPrecios, ajustarEscala } from '$lib/db/precios';
	import Guia from '$lib/Guia.svelte';

	let activos = $state<any[]>([]);
	let cargando = $state(true);
	let msg = $state('');
	let preview = $state<Record<string, number> | null>(null);
	let probando = $state(false);
	let actualizando = $state(false);

	async function cargar() {
		activos = (await query(
			"SELECT id, ticker, nombre, tipo, moneda, precio_actual, simbolo_cotizacion FROM activo WHERE perfil_id=1 AND activo=1 AND tipo <> 'FCI' ORDER BY nombre COLLATE NOCASE"
		)) as any[];
		cargando = false;
	}
	onMount(cargar);

	function flash(t: string) { msg = t; setTimeout(() => (msg = ''), 4000); }

	async function guardarSimbolo(a: any) {
		const s = (a.simbolo_cotizacion ?? '').trim().toUpperCase() || null;
		try {
			await query('UPDATE activo SET simbolo_cotizacion=? WHERE id=? AND perfil_id=1', [s, a.id]);
			a.simbolo_cotizacion = s;
			flash('Guardado ✅');
		} catch (e: any) { flash('Error: ' + (e?.message ?? e)); }
	}

	async function guardarNombre(a: any) {
		const n = (a.nombre ?? '').trim();
		if (!n) { flash('El nombre no puede quedar vacío.'); await cargar(); return; }
		try { await query('UPDATE activo SET nombre=? WHERE id=? AND perfil_id=1', [n, a.id]); a.nombre = n; flash('Guardado ✅'); }
		catch (e: any) { flash('Error: ' + (e?.message ?? e)); }
	}

	async function guardarMoneda(a: any) {
		try { await query('UPDATE activo SET moneda=? WHERE id=? AND perfil_id=1', [a.moneda, a.id]); flash('Moneda actualizada ✅'); }
		catch (e: any) { flash('Error: ' + (e?.message ?? e)); }
	}

	// Cambiar el tipo NO afecta el histórico (transacciones, PPC/PPV, FIFO); solo la
	// etiqueta y el escalado del auto-update (÷100 en Bono/ON). Si se pasa a FCI, el
	// activo desaparece de esta tabla (los FCI no cotizan en data912).
	const TIPOS_ACTIVO = ['Bono', 'ON', 'FCI', 'Accion', 'CEDEAR', 'Indice'];
	async function guardarTipo(a: any) {
		try { await query('UPDATE activo SET tipo=? WHERE id=? AND perfil_id=1', [a.tipo, a.id]); await cargar(); flash('Tipo actualizado ✅'); }
		catch (e: any) { flash('Error: ' + (e?.message ?? e)); }
	}

	async function probar() {
		probando = true; preview = null;
		try { preview = await previsualizarPrecios(); flash('Precios traídos de data912 ✅'); }
		catch (e: any) { flash('Error: ' + (e?.message ?? e)); }
		probando = false;
	}

	// Precio de la fuente para un activo, ya escalado (bonos/ONs ÷100).
	function precioFuente(a: any): number | null {
		if (!preview || !a.simbolo_cotizacion) return null;
		const raw = preview[String(a.simbolo_cotizacion).trim().toUpperCase()];
		return raw == null ? null : ajustarEscala(raw, a.tipo);
	}

	async function actualizarAhora() {
		actualizando = true;
		try { flash(await actualizarPrecios()); await cargar(); }
		catch (e: any) { flash('Error: ' + (e?.message ?? e)); }
		actualizando = false;
	}

	const money = (n: number | null, mon: string) =>
		n == null ? '—' : (mon === 'USD' ? 'U$D ' : '$') + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 });
</script>

<div class="titulo-guia">
	<h1>Configurar tickers</h1>
	<Guia clave="config-tickers" texto="Asociá cada activo con su símbolo en data912 para que el precio se actualice solo. Dejalo en blanco para manejar ese precio a mano. Probá los símbolos antes de confiar en ellos." />
</div>

<a href="/inversiones" class="btn-volver">← Volver a Inversiones</a>

{#if msg}<p class="msg">{msg}</p>{/if}

<p class="nota">
	Cada instrumento de BYMA tiene tres símbolos: el pelado en <strong>pesos</strong> (ej. <code>GD35</code>),
	con <strong>D</strong> = dólar MEP (<code>GD35D</code>) y con <strong>C</strong> = dólar CCL (<code>GD35C</code>).
	Para un activo en <strong>USD</strong>, usá el símbolo con D o C; para uno en <strong>pesos</strong>, el pelado.
	Tocá <strong>Probar precios</strong> para ver qué trae cada símbolo antes de guardar.
	Los <strong>FCI</strong> no aparecen acá: no cotizan en data912, se actualizan a mano desde Inversiones.
</p>

<div class="acciones">
	<button class="btn btn-secondary" onclick={probar} disabled={probando}>{probando ? 'Probando…' : '🔎 Probar precios'}</button>
	<button class="btn btn-primary" onclick={actualizarAhora} disabled={actualizando}>{actualizando ? 'Actualizando…' : '⟳ Actualizar precios ahora'}</button>
</div>

{#if cargando}
	<p>Cargando…</p>
{:else}
	<table>
		<thead><tr><th>Activo</th><th>Tipo</th><th>Moneda</th><th>Símbolo data912</th><th class="num">Precio fuente</th><th class="num">Precio guardado</th></tr></thead>
		<tbody>
			{#each activos as a (a.id)}
				<tr>
					<td>
						<input class="nom" bind:value={a.nombre} onchange={() => guardarNombre(a)} onkeydown={(e) => e.key === 'Enter' && guardarNombre(a)} />
						<span class="tk">{a.ticker}</span>
					</td>
					<td>
						<select class="mon" bind:value={a.tipo} onchange={() => guardarTipo(a)}>
							{#each TIPOS_ACTIVO as t}<option value={t}>{t}</option>{/each}
						</select>
					</td>
					<td>
						<select class="mon" bind:value={a.moneda} onchange={() => guardarMoneda(a)}>
							<option value="ARS">ARS</option>
							<option value="USD">USD</option>
						</select>
					</td>
					<td>
						<input
							class="sim"
							bind:value={a.simbolo_cotizacion}
							placeholder="—"
							onchange={() => guardarSimbolo(a)}
							onkeydown={(e) => e.key === 'Enter' && guardarSimbolo(a)}
						/>
					</td>
					<td class="num">
						{#if preview && a.simbolo_cotizacion}
							{#if precioFuente(a) != null}
								<span class="ok">{money(precioFuente(a), a.moneda)}</span>
							{:else}
								<span class="bad">sin match</span>
							{/if}
						{:else}—{/if}
					</td>
					<td class="num">{money(a.precio_actual, a.moneda)}</td>
				</tr>
			{/each}
			{#if activos.length === 0}<tr><td colspan="6" class="vacio">No tenés activos cargados.</td></tr>{/if}
		</tbody>
	</table>
	<p class="nota">El precio se guarda en la moneda que implica el símbolo. Si "Precio fuente" dice <span class="bad">sin match</span>, revisá el símbolo (mayúsculas, sufijo D/C). Nombre y moneda se guardan al salir del campo; <strong>cambiar la moneda reinterpreta los precios de ese activo en la nueva moneda</strong>.</p>
{/if}

<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	.msg { font-weight: 600; color: var(--pos); margin: 6px 0; }
	.nota { font-size: 0.8rem; color: var(--text-dim); margin: 10px 0; line-height: 1.5; }
	.nota strong { color: var(--text); }
	.nota code { background: var(--surface-2); padding: 1px 5px; border-radius: 4px; color: var(--text); }
	.acciones { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
	table { border-collapse: collapse; width: 100%; font-size: 0.88rem; margin-bottom: 8px; }
	th, td { padding: 6px 8px; text-align: left; }
	td.num, th.num { text-align: right; }
	.tk { font-size: 0.75rem; color: var(--text-dim); }
	.sim { width: 100px; padding: 5px 7px; text-transform: uppercase; }
	.nom { width: 150px; padding: 5px 7px; }
	.mon { padding: 5px 6px; }
	.ok { color: var(--pos); font-weight: 600; }
	.bad { color: var(--neg); }
	.vacio { text-align: center; color: var(--text-dim); font-style: italic; }
</style>

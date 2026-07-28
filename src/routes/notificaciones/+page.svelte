<script lang="ts">
	import { onMount } from 'svelte';
	import { cargarNotificaciones, marcarRecurrentesVistos, faltanTxt, type Notificaciones } from '$lib/notificaciones';
	import { notif } from '$lib/notif.svelte';
	import { actualizarCotizaciones } from '$lib/db/cotizaciones';

	let cargando = $state(true);
	let n = $state<Notificaciones>({ pagos: [], cobros: [], reglas: [], badge: 0 });
	let actualizando = $state(false);

	// Hay algo para mostrar si hay reglas rotas o recurrentes en ventana (vistos o no).
	let vacio = $derived(n.reglas.length === 0 && n.pagos.length === 0 && n.cobros.length === 0);

	onMount(async () => {
		n = await cargarNotificaciones();
		cargando = false;
		// Entrar al centro marca vistos los recurrentes en ventana (se apagan del badge,
		// siguen en la lista) y refresca el badge de la campana en el acto.
		await marcarRecurrentesVistos();
		await notif.refrescar();
	});

	async function actualizarCotiz() {
		actualizando = true;
		try {
			const msg = await actualizarCotizaciones();
			alert(msg);
			location.reload();
		} catch (e: any) {
			alert('Error: ' + (e?.message ?? e));
			actualizando = false;
		}
	}
</script>

<a class="volver" href="/">← Volver a Cuenta Corriente</a>
<h1>Notificaciones</h1>

{#if cargando}
	<p class="nota">Cargando…</p>
{:else if vacio}
	<div class="limpio">
		<span class="tilde">✓</span>
		<p>Está todo al día. No hay nada pendiente por ahora.</p>
	</div>
{:else}
	{#if n.pagos.length}
		<section class="grupo">
			<h2>Próximos pagos</h2>
			<ul class="lista">
				{#each n.pagos as p (p.nombre)}
					<li><span class="rec-nombre">{p.nombre}</span><span class="rec-dias">{faltanTxt(p.dias)}</span></li>
				{/each}
			</ul>
			<a class="verlink" href="/suscripciones">Ver todos →</a>
		</section>
	{/if}

	{#if n.cobros.length}
		<section class="grupo">
			<h2>Próximos cobros</h2>
			<ul class="lista">
				{#each n.cobros as c (c.nombre)}
					<li><span class="rec-nombre">{c.nombre}</span><span class="rec-dias">{faltanTxt(c.dias)}</span></li>
				{/each}
			</ul>
			<a class="verlink" href="/ingresos-fijos">Ver todos →</a>
		</section>
	{/if}

	{#each n.reglas as r (r.tipo)}
		{#if r.accion === 'cotiz'}
			<button class="fila" onclick={actualizarCotiz} disabled={actualizando}>
				<span>{actualizando ? 'Actualizando…' : r.texto}</span><span class="chevron">›</span>
			</button>
		{:else}
			<a class="fila" href={r.href}>
				<span>{r.texto}</span><span class="chevron">›</span>
			</a>
		{/if}
	{/each}
{/if}

<style>
	.volver { display: inline-block; margin: 4px 0 8px; color: var(--accent); text-decoration: none; font-size: 0.85rem; }
	.volver:hover { text-decoration: underline; }
	h1 { margin: 0 0 14px; }
	h2 { font-size: 0.95rem; margin: 0 0 8px; }
	.nota { color: var(--text-dim); font-size: 0.85rem; }

	.limpio {
		display: flex; align-items: center; gap: 12px;
		border: 1px solid var(--border); border-left: 3px solid var(--pos);
		background: var(--surface); border-radius: 0 8px 8px 0; padding: 16px 16px;
	}
	.limpio .tilde { color: var(--pos); font-size: 1.4rem; font-weight: 700; }
	.limpio p { margin: 0; color: var(--text); }

	.grupo {
		border: 1px solid var(--border); border-left: 3px solid var(--accent);
		background: var(--surface); border-radius: 0 8px 8px 0; padding: 12px 14px; margin: 0 0 10px;
	}
	.lista { list-style: none; margin: 0 0 6px; padding: 0; }
	.lista li { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 5px 0; border-bottom: 1px solid var(--border); }
	.lista li:last-child { border-bottom: none; }
	.rec-nombre { font-weight: 600; }
	.rec-dias { color: var(--text-dim); font-size: 0.82rem; white-space: nowrap; }
	.verlink { font-size: 0.82rem; color: var(--accent); text-decoration: none; font-weight: 600; }
	.verlink:hover { text-decoration: underline; }

	.fila {
		display: flex; justify-content: space-between; align-items: center; gap: 12px; width: 100%;
		text-align: left; font: inherit; cursor: pointer;
		border: 1px solid var(--border); border-left: 3px solid var(--accent);
		background: var(--surface); color: var(--text); border-radius: 0 8px 8px 0;
		padding: 12px 14px; margin: 0 0 10px; text-decoration: none;
	}
	.fila:hover { border-color: var(--accent); }
	.fila:disabled { opacity: 0.6; cursor: default; }
	.chevron { color: var(--text-dim); font-size: 1.1rem; flex-shrink: 0; }
</style>

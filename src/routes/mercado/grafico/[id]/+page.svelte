<script lang="ts">
	// Vista expandida del gráfico de precio de Mercado, como ruta real de
	// SvelteKit (no modal condicional): así el botón/gesto atrás de Android hace
	// pop de esta entrada del historial y vuelve a Mercado, en vez de salir de la
	// app — que es lo que pasaría con un overlay sin entrada propia en el
	// historial de navegación.
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { query } from '$lib/db/client';
	import { especieDeTicker } from '$lib/db/precios';
	import GraficoPrecio from '$lib/GraficoPrecio.svelte';

	let activos = $state<any[]>([]);
	let cargando = $state(true);
	let graficoId = $state(String($page.params.id ?? ''));

	async function cargar() {
		activos = (await query(
			"SELECT id, ticker, nombre, tipo, moneda, precio_actual FROM activo WHERE perfil_id=1 AND activo=1 ORDER BY tipo COLLATE NOCASE, ticker COLLATE NOCASE"
		)) as any[];
		cargando = false;
	}
	onMount(cargar);

	// Cambiar de activo dentro de la vista expandida actualiza la URL (replace,
	// no push): así queda linkeable/recargable en el activo correcto sin sumar
	// una entrada de historial por cada cambio — solo "Volver"/atrás debe cerrar
	// la vista expandida entera.
	$effect(() => {
		if (graficoId && graficoId !== $page.params.id) {
			goto(`/mercado/grafico/${graficoId}`, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});
</script>

<a href="/config-tickers" class="btn-volver">← Volver a Mercado</a>

{#if cargando}
	<p>Cargando…</p>
{:else}
	<section class="grafico-expandido">
		<GraficoPrecio {activos} bind:value={graficoId} especieDe={(a) => especieDeTicker(a.ticker, a.moneda)} expandible={false} />
	</section>
{/if}

<style>
	:global(body) { max-width: 900px; margin: 0 auto; padding: 16px; }
	.grafico-expandido { margin-top: 8px; }
</style>

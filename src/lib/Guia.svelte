<script lang="ts">
	// Guía por módulo. El "?" vive al lado del título (dentro de .titulo-guia)
	// y el cuadro se despliega debajo, a lo ancho. Aparece abierta la primera
	// vez; "Entendido" la cierra y lo registra en meta (clave guia_<clave>).
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';

	let { clave, texto }: { clave: string; texto: string } = $props();
	let abierta = $state(false);
	let lista = $state(false);

	onMount(async () => {
		try {
			const r = (await query('SELECT valor FROM meta WHERE clave=?', ['guia_' + clave])) as any[];
			abierta = r.length === 0;
		} catch { abierta = false; }
		lista = true;
	});

	async function entendido() {
		abierta = false;
		await query("INSERT INTO meta (clave, valor) VALUES (?, '1') ON CONFLICT(clave) DO UPDATE SET valor='1'", ['guia_' + clave]);
	}
</script>

{#if lista}
	<button class="abrir" class:activo={abierta} onclick={() => (abierta = !abierta)} title="¿Cómo funciona esta pantalla?" aria-label="Ayuda">?</button>
	{#if abierta}
		<div class="guia">
			<p>{texto}</p>
			<button class="ok" onclick={entendido}>Entendido</button>
		</div>
	{/if}
{/if}

<style>
	.abrir {
		background: var(--surface-2); color: var(--text-dim); border: 1px solid var(--border);
		border-radius: 50%; width: 22px; height: 22px; font-size: 0.8rem; line-height: 1;
		cursor: pointer; padding: 0; flex-shrink: 0;
		display: inline-flex; align-items: center; justify-content: center;
	}
	.abrir:hover, .abrir.activo { color: var(--accent); border-color: var(--accent); }
	.guia {
		flex-basis: 100%;
		font-size: 0.85rem; font-weight: 400; color: var(--text);
		background: rgba(91, 157, 255, 0.08);
		border-left: 3px solid var(--accent); border-radius: 0 8px 8px 0;
		padding: 10px 12px; line-height: 1.45;
		display: flex; flex-direction: column; gap: 8px; align-items: flex-start;
	}
	.guia p { margin: 0; }
	.ok {
		background: var(--accent); color: #fff; border: none; border-radius: 6px;
		padding: 5px 12px; cursor: pointer; font-size: 0.8rem; font-weight: 600;
	}
</style>

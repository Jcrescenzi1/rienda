<script lang="ts">
	// Selector de moneda compartido (USD / Pesos reales / Pesos nominales).
	// Lee y escribe el store global, asi la eleccion se propaga entre visuales.
	import { moneda } from '$lib/moneda.svelte';
	import { MODOS_MONEDA, LABEL_MONEDA } from '$lib/moneda';

	const AYUDA: Record<string, string> = {
		usd: 'Al dolar bolsa (MEP) del dia de cada movimiento.',
		nominal: 'Pesos tal cual, sin ajustar por inflacion.',
		real: '"Pesos de hoy" = ajustados por inflacion al ultimo mes con dato de IPC publicado (INDEC publica con ~2 semanas de atraso), no al dia actual.'
	};
</script>

<div class="moneda-box">
	<div class="moneda-wrap">
		<span class="moneda-lbl">Moneda</span>
		<div class="toggle-moneda" role="group" aria-label="Moneda">
			{#each MODOS_MONEDA as m (m)}
				<button type="button" class:activo={moneda.modo === m} title={AYUDA[m]} onclick={() => moneda.set(m)}>
					{LABEL_MONEDA[m]}
				</button>
			{/each}
		</div>
	</div>
	{#if moneda.modo === 'real'}
		<p class="moneda-nota">{AYUDA.real}</p>
	{/if}
</div>

<style>
	.moneda-box { display: flex; flex-direction: column; gap: 4px; margin: 6px 0; }
	.moneda-wrap { display: inline-flex; align-items: center; gap: 8px; }
	.moneda-lbl { font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
	.toggle-moneda {
		display: inline-flex;
		gap: 0;
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
	}
	.toggle-moneda button {
		background: var(--surface-2);
		color: var(--text);
		border: none;
		border-right: 1px solid var(--border);
		padding: 6px 12px;
		cursor: pointer;
		font-size: 0.8rem;
		white-space: nowrap;
	}
	.toggle-moneda button:last-child {
		border-right: none;
	}
	.toggle-moneda button.activo {
		background: var(--accent);
		color: #fff;
	}
	.moneda-nota { font-size: 0.75rem; color: var(--text-dim); margin: 0; max-width: 540px; line-height: 1.35; }
</style>

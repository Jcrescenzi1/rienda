<script lang="ts">
	// Selector de moneda compartido (USD / Pesos reales / Pesos nominales).
	// Lee y escribe el store global, así la elección se propaga entre visuales.
	import { moneda } from '$lib/moneda.svelte';
	import { MODOS_MONEDA, LABEL_MONEDA } from '$lib/moneda';
</script>

<div class="moneda-wrap">
	<span class="moneda-lbl">Moneda</span>
	<div class="toggle-moneda" role="group" aria-label="Moneda">
		{#each MODOS_MONEDA as m (m)}
			<button type="button" class:activo={moneda.modo === m} onclick={() => moneda.set(m)}>
				{LABEL_MONEDA[m]}
			</button>
		{/each}
	</div>
</div>

<style>
	.moneda-wrap { display: inline-flex; align-items: center; gap: 8px; margin: 6px 0; }
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
</style>

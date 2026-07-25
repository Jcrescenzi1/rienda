<script lang="ts">
	// Multi-select con checkboxes + fila "Todas / Ninguna". Efímero: el estado vive
	// en el padre (Set de ids seleccionados) y se comunica por callback `onchange`
	// con un Set NUEVO (para disparar la reactividad de Svelte 5). El trigger muestra
	// "Todas", "Ninguna" o "N seleccionadas". Mantiene el look de los <select> de la app.
	type Opt = { id: any; label: string };
	let {
		options,
		selected,
		onchange,
		label = ''
	}: {
		options: Opt[];
		selected: Set<any>;
		onchange: (s: Set<any>) => void;
		label?: string;
	} = $props();

	let abierto = $state(false);
	let cont = $state<HTMLDivElement | null>(null);

	let todas = $derived(options.length > 0 && selected.size >= options.length);
	let ninguna = $derived(selected.size === 0);
	let resumen = $derived(todas ? 'Todas' : ninguna ? 'Ninguna' : `${selected.size} seleccionadas`);

	function toggle(id: any) {
		const s = new Set(selected);
		if (s.has(id)) s.delete(id);
		else s.add(id);
		onchange(s);
	}
	function todasNinguna() {
		onchange(todas ? new Set() : new Set(options.map((o) => o.id)));
	}
	function onWindowClick(e: MouseEvent) {
		if (abierto && cont && !cont.contains(e.target as Node)) abierto = false;
	}
</script>

<svelte:window onclick={onWindowClick} />

<div class="ms" bind:this={cont}>
	<button type="button" class="ms-trigger" class:activo={abierto} onclick={() => (abierto = !abierto)}>
		<span class="ms-lbl">{resumen}</span>
		<span class="ms-caret" aria-hidden="true">▾</span>
	</button>
	{#if abierto}
		<div class="ms-panel" role="listbox" aria-label={label}>
			<button type="button" class="ms-all" onclick={todasNinguna}>
				{todas ? 'Ninguna' : 'Todas'}
			</button>
			<ul>
				{#each options as o (o.id)}
					<li>
						<label>
							<input type="checkbox" checked={selected.has(o.id)} onchange={() => toggle(o.id)} />
							<span>{o.label}</span>
						</label>
					</li>
				{/each}
				{#if options.length === 0}<li class="ms-vacio">Sin opciones</li>{/if}
			</ul>
		</div>
	{/if}
</div>

<style>
	.ms { position: relative; display: inline-block; }
	.ms-trigger {
		display: inline-flex; align-items: center; gap: 8px; justify-content: space-between;
		padding: 6px 8px; font-size: 0.85rem; min-width: 130px; cursor: pointer;
		background: var(--surface); color: var(--text);
		border: 1px solid var(--border); border-radius: 6px;
	}
	.ms-trigger.activo { border-color: var(--accent); }
	.ms-lbl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.ms-caret { color: var(--text-dim); font-size: 0.7rem; flex-shrink: 0; }
	.ms-panel {
		position: absolute; z-index: 30; top: calc(100% + 4px); left: 0;
		min-width: 100%; max-height: 260px; overflow-y: auto;
		background: var(--surface); border: 1px solid var(--accent); border-radius: 8px;
		padding: 6px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
	}
	.ms-all {
		width: 100%; text-align: left; padding: 6px 8px; margin-bottom: 4px;
		font-size: 0.78rem; font-weight: 600; color: var(--accent); cursor: pointer;
		background: rgba(91, 157, 255, 0.10); border: 1px solid var(--accent); border-radius: 6px;
	}
	.ms-panel ul { list-style: none; margin: 0; padding: 0; }
	.ms-panel li { padding: 0; }
	.ms-panel label {
		display: flex; align-items: center; gap: 8px; padding: 6px 6px;
		font-size: 0.85rem; color: var(--text); cursor: pointer; border-radius: 5px;
	}
	.ms-panel label:hover { background: rgba(91, 157, 255, 0.08); }
	.ms-panel input { width: 15px; height: 15px; flex-shrink: 0; accent-color: var(--accent); }
	.ms-vacio { padding: 6px; font-size: 0.8rem; color: var(--text-dim); font-style: italic; }
</style>

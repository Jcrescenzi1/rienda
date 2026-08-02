<script lang="ts">
	// Descriptivo de una visual, colapsado. Estructura FIJA de tres ranuras, para
	// que todas las visuales de la app se expliquen igual y en el mismo orden:
	//
	//   Qué muestra  -> qué hay dibujado
	//   Cómo leerlo  -> la regla de interpretación (colores, umbrales, unidades)
	//   Cómo usarlo  -> qué decisión habilita
	//
	// Y dos opcionales: `fuente` (de dónde salen los datos, solo cuando no es obvio
	// o tiene un límite que importa) y `glosario` (ancla de /como-funciona).
	//
	// Por qué componente y no un <details> escrito a mano en cada archivo: la
	// estructura queda garantizada en vez de depender de acordarse, el CSS deja de
	// estar duplicado en ocho pantallas, y las definiciones de conceptos (PPC, PPV,
	// TWR…) se linkean a /como-funciona en lugar de repetirse en cada visual — que
	// era de donde salía la mitad del texto.
	//
	// El rótulo visible es "Descripción - <objetivo>": el objetivo de la visual se
	// lee SIN desplegar, así en la mitad de los casos no hace falta abrirlo.

	import type { Snippet } from 'svelte';

	let {
		objetivo,
		muestra,
		leer,
		usar,
		fuente = undefined,
		glosario = undefined,
		glosarioTexto = 'Cómo se calcula'
	}: {
		objetivo: string;
		muestra: Snippet;
		leer: Snippet;
		usar: Snippet;
		fuente?: Snippet;
		// Ancla de sección en /como-funciona (capa 3), donde viven las definiciones.
		glosario?: string;
		glosarioTexto?: string;
	} = $props();
</script>

<details class="nota-visual">
	<summary>Descripción - {objetivo}</summary>
	<dl>
		<dt>Qué muestra</dt>
		<dd>{@render muestra()}</dd>
		<dt>Cómo leerlo</dt>
		<dd>{@render leer()}</dd>
		<dt>Cómo usarlo</dt>
		<dd>{@render usar()}</dd>
		{#if fuente}
			<dt>De dónde sale</dt>
			<dd>{@render fuente()}</dd>
		{/if}
	</dl>
	{#if glosario}
		<a class="glosario" href="/como-funciona#{glosario}">{glosarioTexto} →</a>
	{/if}
</details>

<style>
	.nota-visual { margin: 6px 0 12px; }
	.nota-visual summary { cursor: pointer; font-size: 0.82rem; color: var(--text-dim); }
	.nota-visual summary::marker { color: var(--accent); }

	/* Lista de definiciones: la etiqueta de cada ranura arriba, en small-caps, y el
	   texto debajo. Mismo criterio del resto de la app — una idea por línea, sin
	   párrafos corridos. */
	dl { margin: 8px 0 0; padding-left: 12px; border-left: 2px solid var(--border); }
	dt {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-dim);
		margin-top: 8px;
	}
	dt:first-child { margin-top: 0; }
	dd {
		margin: 2px 0 0;
		font-size: 0.82rem;
		line-height: 1.5;
		color: var(--text);
	}
	dd :global(strong) { color: var(--text); font-weight: 700; }
	.glosario {
		display: inline-block;
		margin: 8px 0 0 12px;
		font-size: 0.78rem;
		color: var(--accent);
		font-weight: 600;
		text-decoration: none;
	}
	.glosario:hover { text-decoration: underline; }
</style>

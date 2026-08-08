<script lang="ts">
	// Guía por módulo. El "?" vive al lado del título (dentro de .titulo-guia)
	// y el cuadro se despliega debajo, a lo ancho. Arranca SIEMPRE colapsada (nunca
	// auto-abre); recuerda la apertura EXPLÍCITA del usuario por clave (guia_<clave>
	// = 'abierta' | 'cerrada'). Valores viejos ('1' = descartada en el modelo
	// anterior) cuentan como cerrada, así que nadie ve guías auto-abiertas.
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';

	// Dos formas de escribir la guía:
	//   - estructurada (`para` + `uso`): para qué es esta PANTALLA y cómo se opera.
	//     Es la forma nueva; deja el "qué muestra cada gráfico" para el descriptivo
	//     de cada visual (NotaVisual), que es donde corresponde.
	//   - `texto` suelto: forma vieja, se mantiene mientras se migran las pantallas.
	// verMas: si true, agrega un link a la página "Cómo funciona" (Capa 3).
	let {
		clave,
		texto = '',
		para = '',
		uso = '',
		verMas = false
	}: { clave: string; texto?: string; para?: string; uso?: string; verMas?: boolean } = $props();
	const estructurada = $derived(Boolean(para || uso));
	let abierta = $state(false);
	let lista = $state(false);

	onMount(async () => {
		try {
			const r = (await query('SELECT valor FROM meta WHERE clave=?', ['guia_' + clave])) as any[];
			abierta = r[0]?.valor === 'abierta'; // default cerrada; nunca auto-abre
		} catch { abierta = false; }
		lista = true;
	});

	async function persistir(v: boolean) {
		try {
			await query(
				"INSERT INTO meta (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor",
				['guia_' + clave, v ? 'abierta' : 'cerrada']
			);
		} catch { /* ignore */ }
	}
	function toggle() { abierta = !abierta; persistir(abierta); }
	function entendido() { abierta = false; persistir(false); }
</script>

{#if lista}
	<button class="abrir" class:activo={abierta} onclick={toggle} title="¿Cómo funciona esta pantalla?" aria-label="Ayuda">?</button>
	{#if abierta}
		<div class="guia">
			{#if estructurada}
				<dl>
					{#if para}<dt>Objetivo</dt><dd>{para}</dd>{/if}
					{#if uso}<dt>Cómo hacerlo</dt><dd>{uso}</dd>{/if}
				</dl>
			{:else}
				<p>{texto}</p>
			{/if}
			{#if verMas}<a class="vermas" href="/sobre-rienda">Sobre Rienda →</a>{/if}
			<button class="ok" onclick={entendido}>Entendido</button>
		</div>
	{/if}
{/if}

<style>
	.abrir {
		background: rgba(91, 157, 255, 0.12); color: var(--accent); border: 1px solid var(--accent);
		border-radius: 50%; width: 22px; height: 22px; font-size: 0.8rem; font-weight: 700; line-height: 1;
		cursor: pointer; padding: 0; flex-shrink: 0;
		display: inline-flex; align-items: center; justify-content: center;
	}
	.abrir:hover, .abrir.activo { background: var(--accent); color: #fff; }
	.guia {
		flex-basis: 100%;
		font-size: 0.85rem; font-weight: 400; color: var(--text);
		background: rgba(91, 157, 255, 0.08);
		border-left: 3px solid var(--accent); border-radius: 0 8px 8px 0;
		padding: 10px 12px; line-height: 1.45;
		display: flex; flex-direction: column; gap: 8px; align-items: flex-start;
	}
	.guia p { margin: 0; }
	/* Guía estructurada: una etiqueta por ranura, en small-caps, con el texto
	   debajo. Mismo criterio que NotaVisual, para que las dos capas de ayuda se
	   lean igual. */
	.guia dl { margin: 0; }
	.guia dt {
		font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.05em;
		color: var(--text-dim); margin-top: 8px;
	}
	.guia dt:first-child { margin-top: 0; }
	.guia dd { margin: 2px 0 0; }
	.vermas { font-size: 0.82rem; color: var(--accent); font-weight: 600; text-decoration: none; }
	.vermas:hover { text-decoration: underline; }
	.ok {
		background: var(--accent); color: #fff; border: none; border-radius: 6px;
		padding: 5px 12px; cursor: pointer; font-size: 0.8rem; font-weight: 600;
	}
</style>

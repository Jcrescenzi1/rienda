<script lang="ts">
	// CTA de instalación reusable (Capa 1.5 / Brief A). Un solo componente para
	// onboarding, /datos y Home. Toda la detección sale de pwa.svelte.ts.
	//   dismissible      → muestra la ✕ y recuerda el cierre (Home como banner).
	//   mostrarInstalada → en standalone muestra "ya instalada ✓" (slide /datos);
	//                       si es false, en standalone no renderiza nada (Home).
	//   compacto         → menos texto (la slide del onboarding).
	import { pwa, esIOS, instalarApp } from '$lib/pwa.svelte';

	let { dismissible = true, mostrarInstalada = false, compacto = false }:
		{ dismissible?: boolean; mostrarInstalada?: boolean; compacto?: boolean } = $props();

	// Solo se usa cuando dismissible=true (el template gatea por dismissible).
	let cerrado = $state(typeof localStorage !== 'undefined' && localStorage.getItem('instalar_cerrado') === '1');
	let verPasosIOS = $state(false);
	let msg = $state('');
	const ios = esIOS();

	function cerrar() {
		cerrado = true;
		try { localStorage.setItem('instalar_cerrado', '1'); } catch { /* ignore */ }
	}
	async function onInstalar() {
		const r = await instalarApp();
		if (r === 'accepted') msg = '¡Listo! Abrila desde el ícono de tu teléfono.';
		else if (r === 'no-prompt') verPasosIOS = true; // sin evento (iOS / sin soporte): mostrar el cómo
	}
</script>

{#if pwa.standalone}
	{#if mostrarInstalada}
		<p class="instalada">✓ Ya tenés la app instalada.</p>
	{/if}
{:else if !(dismissible && cerrado)}
	<div class="instalar">
		{#if dismissible}<button class="cerrar" onclick={cerrar} title="Ocultar" aria-label="Ocultar">✕</button>{/if}
		{#if !compacto}<strong>Instalá Rienda en tu teléfono</strong>{/if}

		{#if msg}
			<p class="ok">{msg}</p>
		{:else if pwa.deferred}
			{#if !compacto}<p class="txt">Más rápida, funciona sin conexión y ayuda a que no se borren tus datos.</p>{/if}
			<button class="btn-inst" onclick={onInstalar}>Instalar app</button>
		{:else if ios || verPasosIOS}
			<p class="pasos">En iPhone/iPad: tocá <strong>Compartir</strong>
				<svg class="ic" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>
				(abajo en Safari) y elegí <strong>"Agregar a inicio"</strong>.</p>
		{:else}
			<p class="pasos">Abrí el menú de tu navegador y elegí <strong>"Instalar app"</strong> / <strong>"Agregar a inicio"</strong>. También funciona igual desde el navegador.</p>
		{/if}
	</div>
{/if}

<style>
	.instalada { color: var(--pos); font-weight: 600; font-size: 0.9rem; margin: 0; }
	.instalar {
		position: relative;
		border: 1px solid var(--accent); border-left: 3px solid var(--accent);
		background: rgba(91, 157, 255, 0.08); border-radius: 8px;
		padding: 12px 14px; margin: 0;
		display: flex; flex-direction: column; gap: 6px;
	}
	.instalar strong { font-size: 0.95rem; }
	.txt { font-size: 0.82rem; color: var(--text-dim); margin: 0; line-height: 1.4; }
	.pasos { font-size: 0.86rem; color: var(--text); margin: 0; line-height: 1.5; }
	.pasos strong { color: var(--accent); }
	.ic { vertical-align: -2px; }
	.ok { font-size: 0.88rem; color: var(--pos); font-weight: 600; margin: 0; }
	.btn-inst { align-self: flex-start; background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 9px 18px; font-weight: 600; cursor: pointer; font-size: 0.92rem; }
	.cerrar { position: absolute; top: 8px; right: 10px; background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 0.95rem; padding: 0 4px; }
	.cerrar:hover { color: var(--text); }
</style>

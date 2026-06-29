<script lang="ts">
	// CTA de instalación (Capa 1.5). Se muestra DESPUÉS del primer registro (la Home
	// decide cuándo montarlo). En standalone no se muestra. Degrada limpio.
	import { pwa, esIOS, instalarApp } from '$lib/pwa.svelte';

	// Recuerda si el usuario lo cerró, para no insistir (clave propia, no global).
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
		if (r === 'accepted') { msg = '¡Listo! Ahora abrila desde el ícono de tu teléfono.'; }
		else if (r === 'no-prompt') { verPasosIOS = true; } // sin evento: mostrar el cómo manual
	}
</script>

{#if !pwa.standalone && !cerrado}
	<div class="instalar">
		<button class="cerrar" onclick={cerrar} title="Ocultar" aria-label="Ocultar">✕</button>
		<strong>Instalá Rienda en tu teléfono</strong>
		<p class="txt">Tus datos viven solo en este dispositivo. Instalarla la hace más rápida, te deja usarla sin conexión y ayuda a que no se borren.</p>

		{#if msg}
			<p class="ok">{msg}</p>
		{:else if pwa.deferred}
			<button class="btn-inst" onclick={onInstalar}>Instalar app</button>
		{:else if ios || verPasosIOS}
			<p class="pasos">En iPhone/iPad: tocá <strong>Compartir</strong> <span class="ic" aria-hidden="true">􀈂</span> (el cuadrito con la flecha hacia arriba, abajo en Safari) y elegí <strong>“Agregar a inicio”</strong>.</p>
		{:else}
			<p class="pasos">Abrí el menú de tu navegador y elegí <strong>“Instalar app”</strong> / <strong>“Agregar a pantalla de inicio”</strong>. También funciona igual desde el navegador.</p>
		{/if}
	</div>
{/if}

<style>
	.instalar {
		position: relative;
		border: 1px solid var(--accent); border-left: 3px solid var(--accent);
		background: rgba(91, 157, 255, 0.08); border-radius: 8px;
		padding: 12px 14px; margin: 0 0 14px;
		display: flex; flex-direction: column; gap: 6px;
	}
	.instalar strong { font-size: 0.95rem; }
	.txt { font-size: 0.82rem; color: var(--text-dim); margin: 0; line-height: 1.4; }
	.pasos { font-size: 0.82rem; color: var(--text); margin: 0; line-height: 1.4; }
	.pasos strong { color: var(--accent); }
	.ic { font-size: 0.95rem; }
	.ok { font-size: 0.85rem; color: var(--pos); font-weight: 600; margin: 0; }
	.btn-inst { align-self: flex-start; background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 8px 16px; font-weight: 600; cursor: pointer; font-size: 0.9rem; }
	.cerrar { position: absolute; top: 8px; right: 10px; background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 0.95rem; padding: 0 4px; }
	.cerrar:hover { color: var(--text); }
</style>

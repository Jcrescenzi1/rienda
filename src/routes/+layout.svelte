<script lang="ts">
	import { page } from '$app/stores';
	import { onNavigate, goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { dev } from '$app/environment';
	import { hayPerfil, crearPerfil } from '$lib/db/perfil';
	import { actualizarCotizaciones } from '$lib/db/cotizaciones';

	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});
	let { children } = $props();

	// ===== Perfil / bienvenida =====
	let perfilListo = $state(false);
	let chequeando = $state(true);
	let nombreNuevo = $state('');
	let creando = $state(false);
	let bienvenidaMsg = $state('');
	let importInputBienvenida: HTMLInputElement;

	async function chequearPerfil() {
		try { perfilListo = await hayPerfil(); }
		catch { perfilListo = false; }
		finally { chequeando = false; }
	}

	async function onCrearPerfil() {
		if (!nombreNuevo.trim()) { bienvenidaMsg = 'Escribí tu nombre.'; return; }
		creando = true; bienvenidaMsg = '';
		try { await crearPerfil(nombreNuevo); location.reload(); }
		catch (e: any) { bienvenidaMsg = e?.message ?? String(e); creando = false; }
	}

	// Import en la bienvenida (para recuperar backup en instalación nueva)
	async function onImportarBienvenida(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			const { importarDatos } = await import('$lib/db/backup');
			const { setMeta } = await import('$lib/db/meta');
			await importarDatos(file);
			await setMeta('ultima_importacion', new Date().toISOString());
			alert('Importación completa. La página se va a recargar.');
			location.reload();
		} catch (err: any) {
			alert(err?.message ?? String(err));
		} finally {
			input.value = '';
		}
	}

	// ===== Menú hamburguesa =====
	let menuAbierto = $state(false);
	let actualizandoCotiz = $state(false);

	function irA(href: string) {
		menuAbierto = false;
		goto(href);
	}

	async function onActualizarCotiz() {
		menuAbierto = false;
		actualizandoCotiz = true;
		try {
			const msg = await actualizarCotizaciones();
			alert(msg);
			location.reload();
		} catch (e: any) {
			alert('Error: ' + (e?.message ?? e));
			actualizandoCotiz = false;
		}
	}

	let actual = $derived($page.url.pathname);

	onMount(() => {
		chequearPerfil();
		if (!dev && 'serviceWorker' in navigator) {
			navigator.serviceWorker.register('/service-worker.js');
		}
	});
</script>

{#if chequeando}
	<div class="cargando-app"><p>Cargando…</p></div>
{:else if !perfilListo}
	<!-- Bienvenida -->
	<div class="bienvenida">
		<div class="bcard">
			<h1>Bienvenido a Rienda</h1>
			<p class="sub">Tus finanzas viven solo en este dispositivo. Empezá creando tu perfil.</p>
			<label>Tu nombre
				<input bind:value={nombreNuevo} placeholder="Ej: Juan" onkeydown={(e) => e.key === 'Enter' && onCrearPerfil()} />
			</label>
			<button class="crear" onclick={onCrearPerfil} disabled={creando}>{creando ? 'Creando…' : 'Empezar'}</button>
			{#if bienvenidaMsg}<p class="bmsg">{bienvenidaMsg}</p>{/if}
			<div class="separador"><span>o</span></div>
			<p class="sub">¿Ya tenés un backup de Rienda?</p>
			<button class="importar-b" onclick={() => importInputBienvenida.click()}>⬆ Importar backup</button>
			<input type="file" accept="application/json" bind:this={importInputBienvenida} onchange={onImportarBienvenida} style="display:none" />
		</div>
	</div>
{:else}
	<!-- App normal -->
	<button class="hamb" onclick={() => (menuAbierto = true)} aria-label="Abrir menú">☰</button>

	{#if menuAbierto}
		<!-- Fondo oscurecido -->
		<div class="overlay" onclick={() => (menuAbierto = false)} role="presentation"></div>
		<!-- Panel lateral derecho -->
		<aside class="panel">
			<button class="cerrar" onclick={() => (menuAbierto = false)} aria-label="Cerrar menú">✕</button>

			<span class="marca-menu">Rienda</span>

			<div class="grupo">
				<span class="gtit">Finanzas</span>
				<button class="item" class:activo={actual === '/'} onclick={() => irA('/')}>Presupuesto</button>
				<button class="item" class:activo={actual === '/ingresos'} onclick={() => irA('/ingresos')}>Ingresos</button>
				<button class="item" class:activo={actual === '/configuracion'} onclick={() => irA('/configuracion')}>Configuración</button>
			</div>

			<div class="grupo">
				<span class="gtit">Inversiones</span>
				<button class="item" class:activo={actual === '/inversiones'} onclick={() => irA('/inversiones')}>Inversiones</button>
				<button class="item" class:activo={actual === '/evolucion'} onclick={() => irA('/evolucion')}>Evolución</button>
			</div>

			<div class="grupo">
				<span class="gtit">Datos</span>
				<button class="item" class:activo={actual === '/datos'} onclick={() => irA('/datos')}>Importar / Exportar</button>
				<button class="item" onclick={onActualizarCotiz} disabled={actualizandoCotiz}>
					{actualizandoCotiz ? 'Actualizando…' : 'Actualizar cotizaciones'}
				</button>
			</div>
		</aside>
	{/if}

	{@render children()}
{/if}

<style>
	:global(:root) {
		--bg: #0f1729;
		--surface: #172033;
		--surface-2: #1d2942;
		--border: #2a3a57;
		--text: #e4e8f0;
		--text-dim: #94a0b8;
		--accent: #5b9dff;
		--accent-hover: #7db0ff;
		--pos: #4ade80;
		--neg: #f87171;
		--warn: #fbbf24;
		--radius: 8px;
	}

	:global(body) {
		background: var(--bg);
		color: var(--text);
		font-family: system-ui, sans-serif;
		margin: 0;
	}

	:global(h1) { color: var(--text); }
	:global(h2), :global(h3) { color: var(--text); }
	:global(p) { color: var(--text); }

	:global(table) { border-collapse: collapse; }
	:global(th), :global(td) { border: 1px solid var(--border) !important; }
	:global(th) { color: var(--text-dim); font-weight: 600; }
	:global(thead tr) { background: var(--surface-2); }
	:global(tbody tr:nth-child(even)) { background: rgba(255, 255, 255, 0.015); }
	:global(tfoot td) { border-top: 2px solid var(--border) !important; }

	:global(input), :global(select) {
		background: var(--surface-2);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	:global(input::placeholder) { color: var(--text-dim); }

	:global(.pos) { color: var(--pos) !important; }
	:global(.neg) { color: var(--neg) !important; }
	:global(td.ok) { color: var(--pos) !important; }
	:global(td.bad) { color: var(--neg) !important; }
	:global(td.warn) { color: var(--warn) !important; }

	/* ===== Barra superior ===== */
	.marca-menu { font-size: 1.6rem; font-weight: 700; color: var(--text); padding: 0 8px 4px; }
	.hamb {
		position: absolute;
		top: 67px;
		right: 16px;
		transform: translateY(-50%);
		z-index: 10;
		background: var(--surface-2); color: var(--text); border: 1px solid var(--border);
		border-radius: 6px; font-size: 1.1rem; padding: 4px 12px; cursor: pointer; line-height: 1;
	}
	.hamb:hover { border-color: var(--accent); }

	/* ===== Menú lateral ===== */
	.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 20; }
	.panel {
		position: fixed; top: 0; right: 0; height: 100%; width: 260px; max-width: 80vw;
		background: var(--surface); border-left: 1px solid var(--border);
		z-index: 21; padding: 16px; display: flex; flex-direction: column; gap: 18px;
		box-shadow: -4px 0 20px rgba(0,0,0,0.3);
	}
	.cerrar {
		align-self: flex-end; background: none; border: none; color: var(--text-dim);
		font-size: 1.2rem; cursor: pointer; padding: 0 4px;
	}
	.cerrar:hover { color: var(--text); }
	.grupo { display: flex; flex-direction: column; gap: 4px; }
	.gtit { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); padding: 0 8px 4px; }
	.item {
		background: none; border: none; color: var(--accent); text-align: left;
		font-size: 0.95rem; font-weight: 600; padding: 9px 12px; border-radius: 6px; cursor: pointer;
	}
	.item:hover { background: rgba(91, 141, 239, 0.12); }
	.item.activo { background: var(--accent); color: #fff; }
	.item:disabled { opacity: 0.6; cursor: default; }

	/* ===== Bienvenida ===== */
	.cargando-app { max-width: 820px; margin: 40px auto; padding: 16px; }
	.bienvenida { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; }
	.bcard {
		background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
		padding: 28px 24px; max-width: 360px; width: 100%; display: flex; flex-direction: column; gap: 12px;
	}
	.bcard h1 { margin: 0; font-size: 1.4rem; }
	.bcard .sub { font-size: 0.85rem; color: var(--text-dim); margin: 0; }
	.bcard label { display: flex; flex-direction: column; font-size: 0.82rem; color: var(--text-dim); gap: 5px; }
	.bcard input { padding: 9px; font-size: 1rem; }
	.crear { background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 10px; font-weight: 600; cursor: pointer; font-size: 0.95rem; }
	.crear:disabled { opacity: 0.6; cursor: default; }
	.bmsg { font-size: 0.82rem; color: var(--neg); margin: 0; }
	.separador { display: flex; align-items: center; gap: 10px; color: var(--text-dim); font-size: 0.8rem; }
	.separador::before, .separador::after { content: ''; flex: 1; height: 1px; background: var(--border); }
	.importar-b { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 9px; cursor: pointer; font-size: 0.9rem; }
	.importar-b:hover { border-color: var(--accent); }

	:global(::view-transition-old(root)), :global(::view-transition-new(root)) {
		animation-duration: 0.25s; animation-timing-function: ease;
	}
</style>
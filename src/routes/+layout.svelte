<script lang="ts">
	import { page } from '$app/stores';
	import { onNavigate, goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { dev } from '$app/environment';
	import { hayPerfil, crearPerfil } from '$lib/db/perfil';
	import { actualizarCotizaciones } from '$lib/db/cotizaciones';
	import { query } from '$lib/db/client';
	import { fechaISO } from '$lib/format';
	import type { ModoPeriodo } from '$lib/periodo';

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
	let modoNuevo = $state<ModoPeriodo | null>(null);
	let creando = $state(false);
	let bienvenidaMsg = $state('');
	let importInputBienvenida: HTMLInputElement | undefined = $state();

	const explicacionModo: Record<ModoPeriodo, string> = {
		sueldo: 'Un cobro define tu mes financiero (sueldo, jubilación, una renta fija). Tu mes de gastos e ingresos arranca el día que lo cobrás.',
		calendario: 'Varios cobros que se complementan, o montos que varían mes a mes. Tus períodos siguen el mes calendario (del 1 al último día).'
	};

	async function chequearPerfil() {
		try { perfilListo = await hayPerfil(); }
		catch { perfilListo = false; }
		finally { chequeando = false; }
		if (perfilListo) autoCotizaciones(); // en segundo plano, no bloquea la app
	}

	// Actualiza dólar/inflación solo si la última cotización tiene más de 3 días.
	// Silencioso: sin internet o con la API caída, sigue con lo guardado.
	async function autoCotizaciones() {
		try {
			const r = (await query("SELECT MAX(fecha) AS f FROM cotizacion_dolar WHERE perfil_id=1")) as any[];
			const ult = r[0]?.f;
			const hace3dias = fechaISO(new Date(Date.now() - 3 * 86400000));
			if (ult && ult >= hace3dias) return; // está fresca
			await actualizarCotizaciones();
		} catch { /* sin conexión o API caída: no molestar */ }
	}

	async function onCrearPerfil() {
		if (!nombreNuevo.trim()) { bienvenidaMsg = 'Escribí tu nombre.'; return; }
		if (!modoNuevo) { bienvenidaMsg = 'Elegí una opción de ingresos.'; return; }
		creando = true; bienvenidaMsg = '';
		try { await crearPerfil(nombreNuevo, modoNuevo); location.reload(); }
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

	// ===== Botón "subir arriba" =====
	let mostrarSubir = $state(false);

	function alScrollear() {
		mostrarSubir = window.scrollY > 400;
	}

	function subirArriba() {
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	let actual = $derived($page.url.pathname);

	onMount(() => {
		chequearPerfil();
		if (!dev && 'serviceWorker' in navigator) {
			navigator.serviceWorker.register('/service-worker.js');
		}
		window.addEventListener('scroll', alScrollear, { passive: true });
		return () => window.removeEventListener('scroll', alScrollear);
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

			<div class="modo">
				<span class="modo-tit">¿Hay un ingreso que marque tu mes?</span>
				<div class="modo-btns">
					<button type="button" class:activo={modoNuevo === 'sueldo'} onclick={() => (modoNuevo = 'sueldo')}>Sí, tengo uno</button>
					<button type="button" class:activo={modoNuevo === 'calendario'} onclick={() => (modoNuevo = 'calendario')}>No, son varios</button>
				</div>
				{#if modoNuevo}
					<p class="modo-exp">{explicacionModo[modoNuevo]}</p>
				{/if}
			</div>

			<button class="crear" onclick={onCrearPerfil} disabled={creando || !nombreNuevo.trim() || !modoNuevo}>{creando ? 'Creando…' : 'Empezar'}</button>
			{#if bienvenidaMsg}<p class="bmsg">{bienvenidaMsg}</p>{/if}
			<div class="separador"><span>o</span></div>
			<p class="sub">¿Ya tenés una copia de seguridad de Rienda?</p>
			<button class="importar-b" onclick={() => importInputBienvenida?.click()}>⬆ Restaurar copia de seguridad</button>
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
				<button class="item" class:activo={actual === '/'} onclick={() => irA('/')}>Gastos y Presupuesto</button>
				<button class="item" class:activo={actual === '/ingresos'} onclick={() => irA('/ingresos')}>Ingresos</button>
				<button class="item" class:activo={actual === '/configuracion'} onclick={() => irA('/configuracion')}>Configuración</button>
			</div>

			<div class="grupo">
				<span class="gtit">Activos</span>
				<button class="item" class:activo={actual === '/inversiones'} onclick={() => irA('/inversiones')}>Inversiones</button>
				<button class="item" class:activo={actual === '/evolucion'} onclick={() => irA('/evolucion')}>Evolución de Cartera</button>
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

	{#if mostrarSubir}
		<button class="subir" onclick={subirArriba} aria-label="Subir al inicio">↑</button>
	{/if}

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
	/* Título con "?" de guía al lado; el cuadro se despliega debajo a lo ancho */
	:global(.titulo-guia) { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 21px 0 12px; }
	:global(.titulo-guia h1) { margin: 0; }
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
		position: fixed;
		top: 16px;
		right: 16px;
		z-index: 10;
		background: var(--surface-2); color: var(--text); border: 1px solid var(--border);
		border-radius: 6px; font-size: 1.1rem; padding: 4px 12px; cursor: pointer; line-height: 1;
	}
	.hamb:hover { border-color: var(--accent); }

	.subir {
		position: fixed;
		bottom: 20px;
		left:50%;
		transform: translateX(-50%);
		z-index: 15;
		width: 44px; height: 44px;
		background: var(--surface-2); color: var(--text); border: 1px solid var(--border);
		border-radius: 50%; font-size: 1.2rem; cursor: pointer; line-height: 1;
		box-shadow: 0 2px 12px rgba(0,0,0,0.4);
	}
	.subir:hover { border-color: var(--accent); }
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

	/* ===== Selección de modo de período ===== */
	.modo { display: flex; flex-direction: column; gap: 6px; }
	.modo-tit { font-size: 0.82rem; color: var(--text-dim); }
	.modo-btns { display: flex; gap: 8px; }
	.modo-btns button {
		flex: 1; padding: 8px 6px; border: 1px solid var(--border); background: var(--surface-2);
		color: var(--text); border-radius: 6px; cursor: pointer; font-size: 0.82rem;
	}
	.modo-btns button.activo { background: var(--accent); color: #fff; border-color: var(--accent); }
	.modo-exp {
		font-size: 0.82rem;
		color: var(--accent);
		background: rgba(91, 157, 255, 0.1);
		border-left: 3px solid var(--accent);
		border-radius: 0 6px 6px 0;
		padding: 8px 10px;
		margin: 2px 0 4px;
		line-height: 1.4;
	}

	:global(::view-transition-old(root)), :global(::view-transition-new(root)) {
		animation-duration: 0.25s; animation-timing-function: ease;
	}
</style>
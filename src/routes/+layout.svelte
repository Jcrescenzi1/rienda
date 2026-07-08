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
	import InstalarApp from '$lib/InstalarApp.svelte';

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
	let modoNuevo = $state<ModoPeriodo>('calendario'); // preseleccionado (Capa 1)
	let creando = $state(false);
	let bienvenidaMsg = $state('');
	let importInputBienvenida: HTMLInputElement | undefined = $state();

	// Stepper de bienvenida (Capa 1): 1 Filosofía · 2 Nombre · 3 Modo · 4 Data · 5 Cierre.
	const TOTAL_PASOS = 5;
	let paso = $state(1);
	const puedeAvanzar = $derived(paso !== 2 || nombreNuevo.trim().length > 0); // el nombre es obligatorio
	function siguiente() { if (puedeAvanzar && paso < TOTAL_PASOS) paso++; }
	function atras() { if (paso > 1) paso--; }

	async function chequearPerfil() {
		try { perfilListo = await hayPerfil(); }
		catch { perfilListo = false; }
		finally { chequeando = false; }
		if (perfilListo) { autoCotizaciones(); autoPrecios(); } // en segundo plano, no bloquea la app
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

	// Actualiza precios de activos desde data912 al abrir, solo en horario de mercado
	// (días hábiles, ~11–18 ART) y si pasó más de 1h del último refresh. Silencioso.
	async function autoPrecios() {
		try {
			const ahora = new Date();
			const dia = ahora.getDay();
			if (dia === 0 || dia === 6) return;        // fin de semana
			const hora = ahora.getHours();
			if (hora < 11 || hora >= 18) return;       // fuera de horario de mercado
			const r = (await query("SELECT valor FROM meta WHERE clave='precios_actualizados_en'")) as any[];
			const ult = r[0]?.valor;
			if (ult && Date.now() - new Date(ult).getTime() < 60 * 60 * 1000) return; // refrescado hace <1h
			const { actualizarPrecios } = await import('$lib/db/precios');
			await actualizarPrecios();
		} catch { /* sin conexión, API caída o sin símbolos configurados: no molestar */ }
	}

	async function onCrearPerfil() {
		if (!nombreNuevo.trim()) { bienvenidaMsg = 'Escribí tu nombre.'; return; }
		if (!modoNuevo) { bienvenidaMsg = 'Elegí una opción de ingresos.'; return; }
		creando = true; bienvenidaMsg = '';
		try { await crearPerfil(nombreNuevo, modoNuevo); location.href = '/'; } // salir del onboarding siempre en Cuenta Corriente
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
			location.href = '/'; // salir del onboarding siempre en Cuenta Corriente
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
		// Pide almacenamiento persistente: sin esto, el navegador puede desalojar
		// el OPFS bajo presión de espacio. Crítico en iOS, donde Safari borra los
		// datos creados por script tras 7 días sin abrir la app (las apps agregadas
		// a la pantalla de inicio quedan exentas). Best-effort: si no está soportado
		// o lo rechaza, la app sigue igual.
		try { navigator.storage?.persist?.(); } catch { /* no soportado */ }
		// La captura de beforeinstallprompt / standalone vive en pwa.svelte.ts (a
		// nivel módulo, se evalúa temprano vía el import de InstalarApp).
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
			<div class="bdots" aria-hidden="true">
				{#each Array.from({ length: TOTAL_PASOS }) as _, i}<span class="bdot" class:on={i + 1 === paso}></span>{/each}
			</div>

			{#if paso === 1}
				<h1>Tomá el control de tu plata, a tu manera.</h1>
			{:else if paso === 2}
				<h2 class="bq">¿Cómo te llamás?</h2>
				<input class="bin" bind:value={nombreNuevo} placeholder="Tu nombre" onkeydown={(e) => e.key === 'Enter' && siguiente()} />
			{:else if paso === 3}
				<h2 class="bq">¿Cuándo arranca tu mes financiero?</h2>
				<div class="modo-btns">
					<button type="button" class:activo={modoNuevo === 'calendario'} onclick={() => (modoNuevo = 'calendario')}>📅 Del 1 al 30 — calendario</button>
					<button type="button" class:activo={modoNuevo === 'sueldo'} onclick={() => (modoNuevo = 'sueldo')}>💸 El día que cobrás — sueldo</button>
				</div>
				<p class="bsub">Lo cambiás cuando quieras en Configuración.</p>
			{:else if paso === 4}
				<p class="bp">Tus datos viven solo en este teléfono. Conviene instalar la app:</p>
				<InstalarApp compacto mostrarInstalada dismissible={false} />
			{:else}
				<p class="bp">Listo. Cargá un gasto y arrancá. Lo demás aparece cuando lo quieras.</p>
			{/if}

			<div class="bnav">
				{#if paso > 1}<button class="bback" onclick={atras}>Atrás</button>{/if}
				{#if paso < TOTAL_PASOS}
					<button class="crear" onclick={siguiente} disabled={!puedeAvanzar}>Siguiente</button>
				{:else}
					<button class="crear" onclick={onCrearPerfil} disabled={creando || !nombreNuevo.trim()}>{creando ? 'Creando…' : 'Empezar'}</button>
				{/if}
			</div>
			{#if bienvenidaMsg}<p class="bmsg">{bienvenidaMsg}</p>{/if}

			{#if paso === 1}
				<div class="separador"><span>o</span></div>
				<button class="importar-b" onclick={() => importInputBienvenida?.click()}>⬆ Ya tengo una copia de seguridad</button>
				<input type="file" accept="application/json" bind:this={importInputBienvenida} onchange={onImportarBienvenida} style="display:none" />
			{/if}
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
				<button class="item" class:activo={actual === '/'} onclick={() => irA('/')}>Cuenta Corriente</button>
				<button class="item" class:activo={actual === '/evolucion-finanzas'} onclick={() => irA('/evolucion-finanzas')}>Evolución</button>
				<button class="item" class:activo={actual === '/configuracion'} onclick={() => irA('/configuracion')}>Configuración</button>
			</div>

			<div class="grupo">
				<span class="gtit">Inversiones</span>
				<button class="item" class:activo={actual === '/inversiones'} onclick={() => irA('/inversiones')}>Tenencia Actual</button>
				<button class="item" class:activo={actual === '/evolucion'} onclick={() => irA('/evolucion')}>Evolución de cartera</button>
			</div>

			<div class="grupo">
				<span class="gtit">Datos</span>
				<button class="item" class:activo={actual === '/datos'} onclick={() => irA('/datos')}>Tus datos</button>
				<button class="item" class:activo={actual === '/como-funciona'} onclick={() => irA('/como-funciona')}>Cómo funciona</button>
				<button class="item" onclick={onActualizarCotiz} disabled={actualizandoCotiz}>
					{actualizandoCotiz ? 'Actualizando…' : 'Actualizar tipo de cambio'}
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
	/* ===== Refresh v2: fuentes self-hosted (offline, cacheadas por el SW) =====
	   Archivo (display: titulos/marca) + Chivo Mono (cifras). Solo estetica. */
	@font-face { font-family: 'Archivo'; src: url('/fonts/archivo-latin-500-normal.woff2') format('woff2'); font-weight: 500; font-style: normal; font-display: swap; }
	@font-face { font-family: 'Archivo'; src: url('/fonts/archivo-latin-600-normal.woff2') format('woff2'); font-weight: 600; font-style: normal; font-display: swap; }
	@font-face { font-family: 'Archivo'; src: url('/fonts/archivo-latin-700-normal.woff2') format('woff2'); font-weight: 700; font-style: normal; font-display: swap; }
	@font-face { font-family: 'Chivo Mono'; src: url('/fonts/chivo-mono-latin-300-normal.woff2') format('woff2'); font-weight: 300; font-style: normal; font-display: swap; }
	@font-face { font-family: 'Chivo Mono'; src: url('/fonts/chivo-mono-latin-400-normal.woff2') format('woff2'); font-weight: 400; font-style: normal; font-display: swap; }
	@font-face { font-family: 'Chivo Mono'; src: url('/fonts/chivo-mono-latin-500-normal.woff2') format('woff2'); font-weight: 500; font-style: normal; font-display: swap; }

	:global(:root) {
		--bg: #070b14;
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
		/* Refresh v2: roles tipograficos (display para titulos, mono para cifras) */
		--font-display: 'Archivo', system-ui, sans-serif;
		--font-num: 'Chivo Mono', ui-monospace, 'Cascadia Mono', monospace;
	}

	:global(body) {
		background: var(--bg);
		color: var(--text);
		font-family: system-ui, sans-serif;
		margin: 0;
	}

	:global(h1) { color: var(--text); font-family: var(--font-display); font-weight: 600; letter-spacing: -0.01em; }
	/* Título con "?" de guía al lado; el cuadro se despliega debajo a lo ancho */
	/* Regla vertical (elemento firma del refresh v2) sobre el titulo de cada pantalla */
	:global(.titulo-guia) { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 21px 0 12px; border-left: 3px solid var(--accent); padding-left: 14px; }
	:global(.titulo-guia h1) { margin: 0; }
	:global(h2), :global(h3) { color: var(--text); font-family: var(--font-display); font-weight: 600; }
	/* Regla firma reutilizable para encabezados de seccion */
	:global(.con-regla) { border-left: 3px solid var(--accent); padding-left: 12px; }
	:global(p) { color: var(--text); }

	/* ===== Tablas (refresh v2): sin grilla — separadores horizontales,
	   encabezado utilitario en mayusculas y cifras en mono. Solo estetica. ===== */
	:global(table) { border-collapse: collapse; }
	:global(th), :global(td) { border: none !important; border-bottom: 1px solid var(--border) !important; }
	:global(th) { color: var(--text-dim); font-weight: 600; }
	:global(thead th) { font-family: var(--font-display); font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.09em; border-bottom: 1px solid var(--text-dim) !important; }
	:global(tbody tr:hover) { background: rgba(255, 255, 255, 0.025); }
	:global(tfoot td) { border-top: 2px solid var(--text-dim) !important; border-bottom: none !important; }
	/* Item 4: dígitos alineados en columnas de cifras */
	:global(table), :global(.num), :global(.card strong), :global(.disp-tabla), :global(.reg-monto), :global(.ficha-monto) { font-variant-numeric: tabular-nums; }
	/* Cifras en mono (celdas numericas y montos destacados) */
	:global(td.num), :global(.card strong), :global(.reg-monto), :global(.ficha-monto) { font-family: var(--font-num); }

	:global(input), :global(select) {
		background: var(--surface-2);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	:global(input::placeholder) { color: var(--text-dim); }

	/* ===== Accesibilidad: foco visible por teclado (a11y) =====
	   Solo aparece al navegar con Tab (no al clickear), gracias a :focus-visible. */
	:global(button:focus-visible), :global(a:focus-visible),
	:global(input:focus-visible), :global(select:focus-visible),
	:global([role="group"] button:focus-visible), :global([tabindex]:focus-visible) {
		outline: 2px solid var(--accent-hover);
		outline-offset: 2px;
		border-radius: 6px;
	}
	:global(button:focus:not(:focus-visible)) { outline: none; }

	/* Respeta "reducir movimiento": desactiva las view-transitions */
	@media (prefers-reduced-motion: reduce) {
		:global(::view-transition-old(root)), :global(::view-transition-new(root)) { animation: none !important; }
	}

	/* ===== Sistema de botones (jerarquia unica para toda la app) =====
	   Uso: class="btn btn-primary" | btn-secondary | btn-ghost | btn-danger | btn-success
	   Tamanos: (normal) | btn-sm | btn-icon. Segmentado: <div class="seg"> con .is-active */
	:global(.btn) {
		font: inherit; font-weight: 600; line-height: 1;
		display: inline-flex; align-items: center; justify-content: center; gap: 6px;
		padding: 8px 14px; font-size: 0.9rem;
		border: 1px solid transparent; border-radius: 6px;
		cursor: pointer; text-decoration: none; white-space: nowrap;
		transition: background 0.12s ease, border-color 0.12s ease, opacity 0.12s ease;
	}
	:global(.btn:disabled), :global(.btn.is-disabled) { opacity: 0.55; cursor: default; pointer-events: none; }
	:global(.btn-primary) { background: var(--accent); color: #fff; }
	:global(.btn-primary:hover) { background: var(--accent-hover); }
	:global(.btn-secondary) { background: var(--surface-2); color: var(--text); border-color: var(--border); }
	:global(.btn-secondary:hover) { border-color: var(--accent); }
	:global(.btn-ghost) { background: none; color: var(--accent); border-color: transparent; padding-left: 4px; padding-right: 4px; }
	:global(.btn-ghost:hover) { text-decoration: underline; }
	:global(.btn-danger) { background: rgba(248, 113, 113, 0.15); color: var(--neg); }
	:global(.btn-danger:hover) { background: rgba(248, 113, 113, 0.28); }
	:global(.btn-success) { background: var(--pos); color: #06281a; }
	:global(.btn-success:hover) { filter: brightness(1.06); }
	:global(.btn-danger-solid) { background: var(--neg); color: #fff; }
	:global(.btn-danger-solid:hover) { filter: brightness(1.06); }
	:global(.btn-danger-outline) { background: transparent; color: var(--neg); border-color: var(--neg); }
	:global(.btn-danger-outline:hover) { background: var(--neg); color: #fff; }
	/* Icono cuadrado, mismo alto que un .btn de texto */
	:global(.btn-icon) { padding: 0; width: 32px; height: 32px; font-size: 0.95rem; }
	/* Fila de botones de ancho parejo: columnas iguales, una sola fuente/alto */
	:global(.btn-row) { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }

	/* Botones inline / ícono estandarizados (✏ ✕ ✓ 🗑), una sola definición */
	:global(.lapiz) { background: rgba(91, 157, 255, 0.12); color: var(--accent); border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem; line-height: 1; padding: 3px 9px; }
	:global(.lapiz:hover) { background: rgba(91, 157, 255, 0.22); }
	:global(.okp) { background: var(--pos); color: #06281a; border: none; border-radius: 6px; cursor: pointer; padding: 3px 9px; font-size: 0.85rem; line-height: 1; margin-left: 2px; }
	:global(.cancp) { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; padding: 3px 9px; font-size: 0.85rem; line-height: 1; margin-left: 2px; }
	:global(.del) { background: rgba(248, 113, 113, 0.15); color: var(--neg); border: none; border-radius: 6px; cursor: pointer; padding: 3px 9px; font-size: 0.85rem; line-height: 1; }
	:global(.del:hover) { background: rgba(248, 113, 113, 0.28); }
	:global(.del.off) { opacity: 0.35; cursor: not-allowed; }

	/* Toggles estandarizados (mismas clases que ya usan las pantallas) */
	:global(.vistas button), :global(.tabs button), :global(.periodos button), :global(.toggle button) {
		font: inherit; font-weight: 600; font-size: 0.82rem; line-height: 1;
		padding: 6px 12px; border: 1px solid var(--border); border-radius: 20px;
		background: var(--surface-2); color: var(--text); cursor: pointer; white-space: nowrap;
	}
	:global(.vistas button.activo), :global(.tabs button.activo), :global(.periodos button.activo), :global(.toggle button.activo) { background: var(--accent); color: #fff; border-color: var(--accent); }
	:global(.modo-btns button), :global(.medio button), :global(.acciones button) {
		font: inherit; font-weight: 600; font-size: 0.85rem; line-height: 1;
		flex: 1; padding: 8px 6px; border: 1px solid var(--border); border-radius: 6px;
		background: var(--surface-2); color: var(--text); cursor: pointer;
	}
	:global(.modo-btns button.activo), :global(.medio button.activo), :global(.acciones button.activo) { background: var(--accent); color: #fff; border-color: var(--accent); }

	/* Links de navegacion / texto */
	:global(.btn-volver) { display: inline-block; background: none; border: none; cursor: pointer; padding: 0; color: var(--accent); text-decoration: none; font-size: 0.9rem; margin: 4px 0 12px; }
	:global(.btn-volver:hover) { text-decoration: underline; }
	:global(.link) { background: none; border: none; color: var(--accent); cursor: pointer; text-decoration: underline; font-size: 0.85rem; padding: 0; }

	/* Control segmentado: pestanas / vistas / modo / medio */
	:global(.seg) { display: inline-flex; flex-wrap: wrap; gap: 6px; align-items: center; }
	:global(.seg > button), :global(.seg > a) {
		font: inherit; font-weight: 600; font-size: 0.82rem; line-height: 1;
		padding: 6px 12px; border: 1px solid var(--border); border-radius: 20px;
		background: var(--surface-2); color: var(--text); cursor: pointer; white-space: nowrap; text-decoration: none;
	}
	:global(.seg > button.is-active), :global(.seg > a.is-active),
	:global(.seg > button.activo), :global(.seg > a.activo) { background: var(--accent); color: #fff; border-color: var(--accent); }
	:global(.seg-block) { display: flex; }
	:global(.seg-block > button) { flex: 1; border-radius: 6px; padding: 8px 6px; }

	:global(.pos) { color: var(--pos) !important; }
	:global(.neg) { color: var(--neg) !important; }
	:global(td.ok) { color: var(--pos) !important; }
	:global(td.bad) { color: var(--neg) !important; }
	:global(td.warn) { color: var(--warn) !important; }

	/* ===== Barra superior ===== */
	.marca-menu { font-family: var(--font-display); font-size: 1.6rem; font-weight: 700; color: var(--text); padding: 0 8px 4px; border-left: 3px solid var(--accent); padding-left: 12px; }
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
	.bcard h1 { margin: 0; font-size: 1.35rem; line-height: 1.25; }
	.bdots { display: flex; gap: 6px; justify-content: center; margin-bottom: 2px; }
	.bdot { width: 7px; height: 7px; border-radius: 50%; background: var(--border); }
	.bdot.on { background: var(--accent); }
	.bq { margin: 0; font-size: 1.15rem; }
	.bin { padding: 9px; font-size: 1rem; }
	.bp { font-size: 1rem; color: var(--text); margin: 0; line-height: 1.5; }
	.bsub { font-size: 0.8rem; color: var(--text-dim); margin: 2px 0 0; }
	.bnav { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
	.bnav .crear { flex: 1; }
	.bback { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 10px 14px; cursor: pointer; font-size: 0.9rem; }
	.crear { background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 10px; font-weight: 600; cursor: pointer; font-size: 0.95rem; }
	.crear:disabled { opacity: 0.6; cursor: default; }
	.bmsg { font-size: 0.82rem; color: var(--neg); margin: 0; }
	.separador { display: flex; align-items: center; gap: 10px; color: var(--text-dim); font-size: 0.8rem; }
	.separador::before, .separador::after { content: ''; flex: 1; height: 1px; background: var(--border); }
	.importar-b { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 9px; cursor: pointer; font-size: 0.9rem; }
	.importar-b:hover { border-color: var(--accent); }

	/* ===== Selección de modo de período (bienvenida) ===== */
	.modo-btns { display: flex; flex-direction: column; gap: 8px; }
	.modo-btns button {
		width: 100%; padding: 11px 12px; border: 1px solid var(--border); background: var(--surface-2);
		color: var(--text); border-radius: 6px; cursor: pointer; font-size: 0.9rem; text-align: left;
	}
	.modo-btns button.activo { background: var(--accent); color: #fff; border-color: var(--accent); }

	:global(::view-transition-old(root)), :global(::view-transition-new(root)) {
		animation-duration: 0.25s; animation-timing-function: ease;
	}
</style>
<script lang="ts">
	import { page } from '$app/stores';
	import { onNavigate } from '$app/navigation';
	import { onMount } from 'svelte';
	import { dev } from '$app/environment';
	import { exportarDatos, importarDatos } from '$lib/db/backup';
	import { hayPerfil, crearPerfil } from '$lib/db/perfil';

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
	let perfilListo = $state(false);   // true si ya hay perfil (mostrar app)
	let chequeando = $state(true);     // true mientras consultamos la base
	let nombreNuevo = $state('');
	let creando = $state(false);
	let bienvenidaMsg = $state('');

	async function chequearPerfil() {
		try {
			perfilListo = await hayPerfil();
		} catch {
			perfilListo = false;
		} finally {
			chequeando = false;
		}
	}

	async function onCrearPerfil() {
		if (!nombreNuevo.trim()) { bienvenidaMsg = 'Escribí tu nombre.'; return; }
		creando = true; bienvenidaMsg = '';
		try {
			await crearPerfil(nombreNuevo);
			location.reload();
		} catch (e: any) {
			bienvenidaMsg = e?.message ?? String(e);
			creando = false;
		}
	}

	let importInput: HTMLInputElement;

	async function onExportar() {
		try {
			await exportarDatos();
		} catch (e: any) {
			alert('Error al exportar: ' + (e?.message ?? e));
		}
	}

	async function onImportar(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		if (!confirm('Importar reemplaza TODOS los datos actuales de este dispositivo. ¿Continuar?')) {
			input.value = '';
			return;
		}
		try {
			await importarDatos(file);
			alert('Importación completa. La página se va a recargar.');
			location.reload();
		} catch (err: any) {
			alert(err?.message ?? String(err));
		} finally {
			input.value = '';
		}
	}

	const finanzas = [
		{ href: '/', label: 'Presupuesto' },
		{ href: '/ingresos', label: 'Ingresos' }
	];
	const inversiones = [
		{ href: '/inversiones', label: 'Inversiones' },
		{ href: '/evolucion', label: 'Evolución' }
	];

	let mundo = $derived.by(() => {
		const p = $page.url.pathname;
		return p === '/inversiones' || p === '/evolucion' ? 'inversiones' : 'finanzas';
	});
	let tabs = $derived(mundo === 'inversiones' ? inversiones : finanzas);
	let actual = $derived($page.url.pathname);

	onMount(() => {
		chequearPerfil();
		if (!dev && 'serviceWorker' in navigator) {
			navigator.serviceWorker.register('/service-worker.js');
		}
	});
</script>

{#if chequeando}
	<!-- Pantalla mínima mientras se consulta la base -->
	<div class="cargando-app"><p>Cargando…</p></div>
{:else if !perfilListo}
	<!-- Pantalla de bienvenida: crear perfil o importar backup -->
	<div class="bienvenida">
		<div class="bcard">
			<h1>Bienvenido a Rienda</h1>
			<p class="sub">Tus finanzas viven solo en este dispositivo. Empezá creando tu perfil.</p>
			<label>Tu nombre
				<input
					bind:value={nombreNuevo}
					placeholder="Ej: Juan"
					onkeydown={(e) => e.key === 'Enter' && onCrearPerfil()}
				/>
			</label>
			<button class="crear" onclick={onCrearPerfil} disabled={creando}>
				{creando ? 'Creando…' : 'Empezar'}
			</button>
			{#if bienvenidaMsg}<p class="bmsg">{bienvenidaMsg}</p>{/if}
			<div class="separador"><span>o</span></div>
			<p class="sub">¿Ya tenés un backup de Rienda?</p>
			<button class="importar-b" onclick={() => importInput.click()}>⬆ Importar backup</button>
			<input
				type="file"
				accept="application/json"
				bind:this={importInput}
				onchange={onImportar}
				style="display:none"
			/>
		</div>
	</div>
{:else}
	<!-- App normal -->
	<header>
		<div class="backup">
			<a class="bk" href="/configuracion" title="Configuración">⚙</a>
			<button class="bk" onclick={onExportar} title="Exportar datos">⬇ Exportar</button>
			<button class="bk" onclick={() => importInput.click()} title="Importar datos">⬆ Importar</button>
			<input
				type="file"
				accept="application/json"
				bind:this={importInput}
				onchange={onImportar}
				style="display:none"
			/>
		</div>
		<div class="nivel1">
			<a href="/" class="mundo" class:activo={mundo === 'finanzas'}>Finanzas</a>
			<a href="/inversiones" class="mundo" class:activo={mundo === 'inversiones'}>Inversiones</a>
		</div>
		<nav class="nivel2">
			{#each tabs as t (t.href)}
				<a href={t.href} class:activo={actual === t.href}>{t.label}</a>
			{/each}
		</nav>
	</header>

	{@render children()}
{/if}

<style>
	/* ===== Sistema de color global (paleta oscura "calma y foco") ===== */
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

	/* Tipografía y elementos base, para toda la app */
	:global(h1) { color: var(--text); }
	:global(h2), :global(h3) { color: var(--text); }
	:global(p) { color: var(--text); }

	/* Tablas */
	:global(table) { border-collapse: collapse; }
	:global(th), :global(td) { border: 1px solid var(--border) !important; }
	:global(th) { color: var(--text-dim); font-weight: 600; }
	:global(thead tr) { background: var(--surface-2); }
	:global(tbody tr:nth-child(even)) { background: rgba(255, 255, 255, 0.015); }
	:global(tfoot td) { border-top: 2px solid var(--border) !important; }

	/* Inputs y selects */
	:global(input), :global(select) {
		background: var(--surface-2);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	:global(input::placeholder) { color: var(--text-dim); }

	/* Semáforo */
	:global(.pos) { color: var(--pos) !important; }
	:global(.neg) { color: var(--neg) !important; }
	:global(td.ok) { color: var(--pos) !important; }
	:global(td.bad) { color: var(--neg) !important; }
	:global(td.warn) { color: var(--warn) !important; }

	/* ===== Bienvenida ===== */
	.cargando-app { max-width: 820px; margin: 40px auto; padding: 16px; }
	.bienvenida { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; }
	.bcard {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 28px 24px;
		max-width: 360px;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.bcard h1 { margin: 0; font-size: 1.4rem; }
	.bcard .sub { font-size: 0.85rem; color: var(--text-dim); margin: 0; }
	.bcard label { display: flex; flex-direction: column; font-size: 0.82rem; color: var(--text-dim); gap: 5px; }
	.bcard input { padding: 9px; font-size: 1rem; }
	.crear {
		background: var(--accent); color: #fff; border: none; border-radius: 6px;
		padding: 10px; font-weight: 600; cursor: pointer; font-size: 0.95rem;
	}
	.crear:disabled { opacity: 0.6; cursor: default; }
	.bmsg { font-size: 0.82rem; color: var(--neg); margin: 0; }
	.separador { display: flex; align-items: center; gap: 10px; color: var(--text-dim); font-size: 0.8rem; }
	.separador::before, .separador::after { content: ''; flex: 1; height: 1px; background: var(--border); }
	.importar-b {
		background: var(--surface-2); color: var(--text); border: 1px solid var(--border);
		border-radius: 6px; padding: 9px; cursor: pointer; font-size: 0.9rem;
	}
	.importar-b:hover { border-color: var(--accent); }

	/* ===== Navegación ===== */
	header { max-width: 820px; margin: 0 auto 12px; position: relative; }
	.nivel1 { display: flex; gap: 8px; padding: 12px 16px 0; }
	.mundo {
		text-decoration: none;
		font-weight: 700;
		font-size: 1.05rem;
		color: var(--text-dim);
		padding: 8px 18px;
		border-radius: 8px 8px 0 0;
		border: 1px solid transparent;
	}
	.mundo.activo {
		color: var(--text);
		background: var(--surface);
		border-color: var(--border);
		border-bottom-color: var(--surface);
	}
	.nivel2 {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		padding: 8px 16px;
		border-bottom: 1px solid var(--border);
		background: var(--surface);
		border-radius: 0 8px 8px 8px;
	}
	.nivel2 a {
		text-decoration: none;
		color: var(--accent);
		font-weight: 600;
		font-size: 0.9rem;
		padding: 5px 12px;
		border-radius: 6px;
	}
	.nivel2 a:hover { background: rgba(91, 141, 239, 0.12); }
	.nivel2 a.activo { background: var(--accent); color: #fff; }

	:global(::view-transition-old(root)),
	:global(::view-transition-new(root)) {
		animation-duration: 0.25s;
		animation-timing-function: ease;
	}
	.backup {
		position: absolute;
		top: 12px;
		right: 16px;
		display: flex;
		gap: 6px;
		z-index: 10;
	}
	@media (max-width: 640px) {
		header { max-width: 100%; }
		.backup {
			position: static;
			justify-content: flex-end;
			padding: 8px 12px 0;
		}
		.nivel1 { flex-wrap: wrap; }
		.nivel2 { overflow-x: auto; }
	}
	.bk {
		background: var(--surface-2);
		color: var(--text-dim);
		border: 1px solid var(--border);
		border-radius: 6px;
		font-size: 0.78rem;
		padding: 4px 10px;
		cursor: pointer;
	}
	.bk:hover { color: var(--text); border-color: var(--accent); }
</style>
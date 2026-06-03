<script lang="ts">
	import { page } from '$app/stores';
	import { onNavigate } from '$app/navigation';

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

	import { exportarDatos, importarDatos } from '$lib/db/backup';

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
</script>

<header>
	<div class="backup">
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

	/* Semáforo: las clases .pos/.neg que ya usás en todas las pantallas */
	:global(.pos) { color: var(--pos) !important; }
	:global(.neg) { color: var(--neg) !important; }
	:global(td.ok) { color: var(--pos) !important; }
	:global(td.bad) { color: var(--neg) !important; }
	:global(td.warn) { color: var(--warn) !important; }

	/* ===== Navegación ===== */
	header { max-width: 820px; margin: 0 auto 12px; }
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
	header { position: relative; }
	.backup {
		position: absolute;
		top: 12px;
		right: 16px;
		display: flex;
		gap: 6px;
		z-index: 10;
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
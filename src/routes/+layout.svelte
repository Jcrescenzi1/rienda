<script lang="ts">
	import { page } from '$app/stores';
	let { children } = $props();

	const finanzas = [
		{ href: '/', label: 'Cargar gasto' },
		{ href: '/credito', label: 'Crédito' },
		{ href: '/presupuesto', label: 'Presupuesto' },
		{ href: '/suscripciones', label: 'Suscripciones' },
		{ href: '/ingresos', label: 'Ingresos' },
		{ href: '/salario', label: 'Salario' }
	];
	const inversiones = [
		{ href: '/inversiones', label: 'Inversiones' },
		{ href: '/evolucion', label: 'Evolución' }
	];

	// Mundo actual según la ruta
	let mundo = $derived.by(() => {
		const p = $page.url.pathname;
		return p === '/inversiones' || p === '/evolucion' ? 'inversiones' : 'finanzas';
	});
	let tabs = $derived(mundo === 'inversiones' ? inversiones : finanzas);
	let actual = $derived($page.url.pathname);
</script>

<header>
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
	header { max-width: 820px; margin: 0 auto 12px; }
	.nivel1 {
		display: flex;
		gap: 8px;
		padding: 10px 16px 0;
	}
	.mundo {
		text-decoration: none;
		font-weight: 700;
		font-size: 1.05rem;
		color: #888;
		padding: 8px 18px;
		border-radius: 8px 8px 0 0;
		border: 1px solid transparent;
	}
	.mundo.activo {
		color: #111;
		background: #f3f6fb;
		border-color: #ddd;
		border-bottom-color: #f3f6fb;
	}
	.nivel2 {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		padding: 8px 16px;
		border-bottom: 1px solid #ddd;
		background: #f3f6fb;
		border-radius: 0 8px 8px 8px;
	}
	.nivel2 a {
		text-decoration: none;
		color: #1a73e8;
		font-weight: 600;
		font-size: 0.9rem;
		padding: 5px 12px;
		border-radius: 6px;
	}
	.nivel2 a:hover { background: #e6eefb; }
	.nivel2 a.activo { background: #1a73e8; color: #fff; }
</style>
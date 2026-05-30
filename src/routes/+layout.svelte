<script lang="ts">
	let { children } = $props();
</script>

<nav>
	<a href="/">Cargar gasto</a>
	<a href="/credito">Crédito</a>
	<a href="/presupuesto">Presupuesto</a>
	<a href="/subscripciones">Suscripciones</a>
	<a href="/ingresos">Ingresos</a>
	<a href="/salario">Salario</a>
</nav>

{@render children()}

<style>
	nav {
		display: flex;
		gap: 16px;
		padding: 12px 16px;
		border-bottom: 1px solid #ddd;
		max-width: 820px;
		margin: 0 auto 8px;
	}
	nav a { text-decoration: none; color: #1a73e8; font-weight: 600; }
</style>
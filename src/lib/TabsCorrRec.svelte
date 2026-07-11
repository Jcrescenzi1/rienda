<script lang="ts">
	// Tabs Corriente/Recurrente compartidas entre Gastos↔Gastos Fijos e Ingresos↔Ingresos Fijos.
	// Navegacion real entre rutas (no estado compartido): cada pestaña es un link a la
	// ruta correspondiente, y el mismo header se repite en ambas rutas para que se
	// sienta una sola pantalla con dos vistas. Los deep-links a /suscripciones e
	// /ingresos-fijos siguen funcionando igual que siempre.
	let { activo, corriente, recurrente }: { activo: 'corriente' | 'recurrente'; corriente: string; recurrente: string } = $props();
</script>

<div class="seg tabs-cr">
	<a href={corriente} class:is-active={activo === 'corriente'}>Corriente</a>
	<a href={recurrente} class:is-active={activo === 'recurrente'}>Recurrente</a>
</div>

<style>
	.tabs-cr { margin: 0; }
</style>

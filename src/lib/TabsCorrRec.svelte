<script lang="ts">
	// Tabs Corriente/Recurrente compartidas entre Gastos y Ingresos (la vista "Recurrente"
	// muestra /suscripciones o /ingresos-fijos, rutas internas sin renombrar).
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
	/* Ancho completo y jerarquía de selector: son DOS VISTAS de la misma pantalla,
	   no un control menor. Antes competía en tamaño con el botón "Volver" y el
	   selector de mes que lo rodean y pasaba desapercibido.
	   align-self: stretch estira el componente dentro del .cr-nav de las 4 rutas
	   (es flex column con align-items: flex-start), así que no hay que tocarlas.
	   Solo estético: la navegación y los deep-links no cambian. */
	.tabs-cr { margin: 0; display: flex; width: 100%; align-self: stretch; flex-wrap: nowrap; }
	.tabs-cr > a {
		flex: 1;
		text-align: center;
		font-size: 0.95rem;
		font-weight: 600;
		padding: 11px 8px;
		border-radius: 8px;
	}
</style>

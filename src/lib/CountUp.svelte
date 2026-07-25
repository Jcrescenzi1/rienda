<script lang="ts">
	// Count-up para KPIs hero: el valor sube desde 0 al montar y desde el valor
	// previo cuando cambia por una interacción (período, filtro, moneda). Los
	// re-renders que no cambian el número no re-disparan el tween (el $effect solo
	// depende de `value`). Anima sobre el número ya calculado; no recalcula nada.
	import { tweened } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';

	// === Parámetros ajustables (velocidad del count-up) ===
	const DURACION_MS = 500; // 400–600 ms recomendado
	const EASING = cubicOut;

	let { value, format }: { value: number; format: (n: number) => string } = $props();

	// Reduced-motion: sin animación, el número aparece directo en su valor final.
	// Mismo criterio que las view-transitions de la app.
	const sinMovimiento =
		typeof window !== 'undefined' &&
		window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

	const store = tweened(0, { duration: sinMovimiento ? 0 : DURACION_MS, easing: EASING });
	// Corre al montar (0 → value) y en cada cambio real de value (previo → nuevo).
	$effect(() => {
		store.set(value);
	});
</script>

<span>{format($store)}</span>

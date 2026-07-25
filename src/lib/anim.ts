import { tweened } from 'svelte/motion';
import { cubicOut } from 'svelte/easing';

// === Parámetros ajustables (animación de gráficos) ===
export const DUR_CHART = 380; // 300–500 ms recomendado
export const EASING_CHART = cubicOut;

// Reduced-motion: sin animación (mismo criterio que las view-transitions de la app).
export const sinMovimiento =
	typeof window !== 'undefined' &&
	window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

// Progreso 0→1 que se puede "reproducir" (reinicia a 0 y anima a 1) cada vez que
// cambia el estado del gráfico. Anima sobre valores ya calculados; no recalcula datos.
export function progresoReplay() {
	const p = tweened(0, { duration: sinMovimiento ? 0 : DUR_CHART, easing: EASING_CHART });
	const replay = () => {
		p.set(0, { duration: 0 });
		p.set(1);
	};
	return { p, replay };
}

<script lang="ts">
	// Ícono de calculadora único y compartido (Brief H / B9) — antes estaba
	// duplicado como SVG crudo en Gastos y CargaIngresos, con una divergencia real
	// entre las dos copias (a CargaIngresos le faltaba la fila del medio). Se usa
	// acá la versión completa.
	let { size = 18 }: { size?: number } = $props();
</script>

<svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width="2">
	<rect x="4" y="2" width="16" height="20" rx="2" />
	<line x1="8" y1="6" x2="16" y2="6" />
	<line x1="8" y1="11" x2="8" y2="11" />
	<line x1="12" y1="11" x2="12" y2="11" />
	<line x1="16" y1="11" x2="16" y2="11" />
	<line x1="8" y1="15" x2="8" y2="15" />
	<line x1="12" y1="15" x2="12" y2="15" />
	<line x1="16" y1="15" x2="16" y2="18" />
</svg>

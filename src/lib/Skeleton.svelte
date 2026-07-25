<script lang="ts">
	// Bloque placeholder con shimmer sobrio para estados de carga. Con "reducir
	// movimiento" queda estático (sin shimmer). Tamaño configurable por props.
	let { w = '100%', h = '1rem', radius = '8px' }: { w?: string; h?: string; radius?: string } = $props();
</script>

<span class="sk" style="width:{w};height:{h};border-radius:{radius}"></span>

<style>
	.sk {
		display: block;
		background: var(--surface-2);
		position: relative;
		overflow: hidden;
	}
	.sk::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.05), transparent);
		transform: translateX(-100%);
		animation: sk-shimmer 1.4s ease-in-out infinite;
	}
	@media (prefers-reduced-motion: reduce) {
		.sk::after { animation: none; }
	}
	@keyframes sk-shimmer {
		100% { transform: translateX(100%); }
	}
</style>

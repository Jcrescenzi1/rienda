<script lang="ts">
	import { evalMonto } from '$lib/format';

	// Calculadora opt-in para los campos de monto (mobile no ofrece signos matemáticos).
	// Overlay/bottom-sheet: el formulario de carga queda vivo atrás. Doble confirmación:
	// se arma la expresión → '=' resuelve y muestra el resultado → '✓' vuelca al campo.
	// Parser: evalMonto (shunting-yard, NUNCA eval). La expresión se guarda en ASCII
	// (+ - * /) para evaluar; se muestra con símbolos lindos (+ − × ÷).
	let { abierto = false, onConfirm, onCerrar }:
		{ abierto?: boolean; onConfirm: (valor: string) => void; onCerrar: () => void } = $props();

	let expr = $state('');
	let resultado = $state<number | null>(null);
	let resuelto = $state(false);

	// Reset al abrir (no re-monta el form de atrás).
	$effect(() => { if (abierto) { expr = ''; resultado = null; resuelto = false; } });

	const fmtNum = (n: number) => String(n).replace('.', ',');
	const pretty = (e: string) =>
		e.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−').replace(/([+×÷−])/g, ' $1 ');

	function meter(car: string) {
		// dígito o coma
		if (resuelto) { expr = car; resuelto = false; resultado = null; return; }
		expr += car;
	}
	function operador(op: string) {
		if (resuelto && resultado != null) { expr = fmtNum(resultado) + op; resuelto = false; resultado = null; return; }
		if (!expr) { if (op === '-') expr = '-'; return; } // permite arrancar con negativo
		expr += op;
	}
	function borrarUno() { resuelto = false; resultado = null; expr = expr.slice(0, -1); }
	function limpiar() { expr = ''; resultado = null; resuelto = false; }
	function accion() {
		if (resuelto) {
			if (resultado != null) { onConfirm(fmtNum(resultado)); }
			return;
		}
		const r = evalMonto(expr);
		if (r == null) return; // inválido: dejar editable
		resultado = r;
		resuelto = true;
	}
</script>

{#if abierto}
	<div class="cal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) onCerrar(); }} role="presentation">
		<div class="cal-sheet" role="dialog" aria-modal="true" aria-label="Calculadora" tabindex="-1">
			<div class="cal-head">
				<button type="button" class="cal-atras" onclick={onCerrar} aria-label="Cerrar sin cargar">✕</button>
				<span class="cal-tit">Calculadora</span>
			</div>
			<div class="cal-display">
				<div class="cal-expr">{expr ? pretty(expr) : '0'}</div>
				<div class="cal-res">{resuelto && resultado != null ? '= ' + fmtNum(resultado) : ''}</div>
			</div>
			<div class="cal-keys">
				<button type="button" class="k fn" onclick={limpiar}>C</button>
				<button type="button" class="k fn" onclick={borrarUno} aria-label="Borrar">⌫</button>
				<button type="button" class="k op" onclick={() => operador('/')}>÷</button>
				<button type="button" class="k op" onclick={() => operador('*')}>×</button>

				<button type="button" class="k" onclick={() => meter('7')}>7</button>
				<button type="button" class="k" onclick={() => meter('8')}>8</button>
				<button type="button" class="k" onclick={() => meter('9')}>9</button>
				<button type="button" class="k op" onclick={() => operador('-')}>−</button>

				<button type="button" class="k" onclick={() => meter('4')}>4</button>
				<button type="button" class="k" onclick={() => meter('5')}>5</button>
				<button type="button" class="k" onclick={() => meter('6')}>6</button>
				<button type="button" class="k op" onclick={() => operador('+')}>+</button>

				<button type="button" class="k" onclick={() => meter('1')}>1</button>
				<button type="button" class="k" onclick={() => meter('2')}>2</button>
				<button type="button" class="k" onclick={() => meter('3')}>3</button>
				<button type="button" class="k" onclick={() => meter(',')}>,</button>

				<button type="button" class="k cero" onclick={() => meter('0')}>0</button>
				<button type="button" class="k accion" class:listo={resuelto} onclick={accion}>{resuelto ? '✓' : '='}</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.cal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55); z-index: 1000; display: flex; align-items: flex-end; justify-content: center; }
	.cal-sheet { width: 100%; max-width: 460px; background: var(--bg); border: 1px solid var(--border); border-radius: 14px 14px 0 0; padding: 12px 12px calc(12px + env(safe-area-inset-bottom)); box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.4); }
	.cal-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
	.cal-atras { background: none; border: none; color: var(--text); font-size: 1.3rem; line-height: 1; cursor: pointer; padding: 4px 8px; border-radius: 6px; }
	.cal-atras:hover { background: var(--surface-2); }
	.cal-tit { font-family: var(--font-display); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim); }
	.cal-display { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; min-height: 56px; text-align: right; }
	.cal-expr { font-family: var(--font-num); font-size: 1.25rem; color: var(--text); word-break: break-all; min-height: 1.4em; }
	.cal-res { font-family: var(--font-num); font-size: 0.95rem; color: var(--accent); min-height: 1.2em; }
	.cal-keys { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
	.k { padding: 16px 0; font-family: var(--font-num); font-size: 1.2rem; border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 10px; cursor: pointer; }
	.k:active { background: var(--surface-2); }
	.k.fn { color: var(--text-dim); font-size: 1.05rem; }
	.k.op { color: var(--accent); font-weight: 600; }
	.k.cero { grid-column: span 2; }
	.k.accion { grid-column: span 2; background: var(--accent); border-color: var(--accent); color: #071019; font-weight: 700; font-size: 1.3rem; }
	.k.accion.listo { background: var(--pos); border-color: var(--pos); }
	@media (prefers-reduced-motion: no-preference) { .cal-sheet { animation: cal-up 0.18s ease-out; } }
	@keyframes cal-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
</style>

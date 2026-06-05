// src/lib/format.ts
// Helpers para manejar números en formato argentino (punto miles, coma decimal).

// Convierte un texto en formato argentino a número.
// "1.234,56" -> 1234.56  |  "1234,5" -> 1234.5  |  "1000" -> 1000
// Acepta number tal cual (para inputs aún no migrados a texto).
// Devuelve NaN si no es un número válido.
export function parseNum(texto: string | number | null | undefined): number {
	if (texto == null) return NaN;
	if (typeof texto === 'number') return texto;
	let s = String(texto).trim();
	if (s === '') return NaN;
	s = s.replace(/\./g, '').replace(',', '.');
	return Number(s);
}

// ¿El texto es un número válido en formato argentino?
export function esNumValido(texto: string | number | null | undefined): boolean {
	return Number.isFinite(parseNum(texto));
}

// Filtra en vivo lo tecleado: solo dígitos, coma, punto y signo menos.
export function soloNumerico(texto: string): string {
	return texto.replace(/[^0-9.,-]/g, '');
}

// Formatea un número al formato argentino para PREFILL de inputs de texto.
// 1234.56 -> "1.234,56". Si no es número válido, devuelve "".
export function formatNum(n: number | null | undefined, dec = 2): string {
	if (n == null || !Number.isFinite(n)) return '';
	return n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// Action Svelte: filtra en vivo el input al teclear, escribiendo el valor limpio
// de vuelta en el DOM. Usar con bind:value para que el estado quede sincronizado.
//   <input type="text" inputmode="decimal" bind:value={x} use:soloNum />
export function soloNum(node: HTMLInputElement) {
	const handler = () => {
		const limpio = soloNumerico(node.value);
		if (node.value !== limpio) {
			node.value = limpio;
			node.dispatchEvent(new Event('input', { bubbles: true }));
		}
	};
	node.addEventListener('input', handler);
	return { destroy() { node.removeEventListener('input', handler); } };
}
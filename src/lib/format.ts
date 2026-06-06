// src/lib/format.ts
// Helpers para manejar números y fechas en formato argentino.

// "1.234,56" -> 1234.56  |  "1234,5" -> 1234.5  |  "1000" -> 1000
// Acepta number tal cual (inputs aún no migrados a texto). NaN si inválido.
export function parseNum(texto: string | number | null | undefined): number {
	if (texto == null) return NaN;
	if (typeof texto === 'number') return texto;
	let s = String(texto).trim();
	if (s === '') return NaN;
	s = s.replace(/\./g, '').replace(',', '.');
	return Number(s);
}

export function esNumValido(texto: string | number | null | undefined): boolean {
	return Number.isFinite(parseNum(texto));
}

// Filtra en vivo lo tecleado: solo dígitos, coma, punto y signo menos.
export function soloNumerico(texto: string): string {
	return texto.replace(/[^0-9.,-]/g, '');
}

// Número -> string formato AR, para PREFILL de inputs de texto. 1234.56 -> "1.234,56".
export function formatNum(n: number | null | undefined, dec = 2): string {
	if (n == null || !Number.isFinite(n)) return '';
	return n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// Action Svelte: filtra en vivo el input al teclear.
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

// "yyyy-mm-dd" -> "dd-mmm" para tablas (ej. "2025-06-05" -> "05-jun").
// Parsea el string crudo (no new Date) para evitar corrimiento de día por UTC.
const MESES_AR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export function fmtFecha(iso: string): string {
	if (!iso) return '';
	const [, m, d] = iso.split('-');
	const mi = Number(m) - 1;
	if (mi < 0 || mi > 11 || !d) return iso;
	return `${d}-${MESES_AR[mi]}`;
}
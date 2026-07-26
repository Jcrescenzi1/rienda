// src/lib/format.ts
// Helpers para manejar números y fechas en formato argentino.

// "1.234,56" -> 1234.56  |  "1234,5" -> 1234.5  |  "1000" -> 1000
// Acepta number tal cual por compatibilidad. NaN si inválido.
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

// Importe para MOSTRAR: formato AR redondeado sin decimales, con símbolo de
// moneda ($ / U$D). La carga y el guardado mantienen los decimales; esto es solo
// presentación. Único helper de moneda para las vistas de finanzas personales.
export function pesos(n: number | null | undefined, mon = 'ARS'): string {
	return (mon === 'USD' ? 'U$D ' : '$') + (Math.round(Number(n)) || 0).toLocaleString('es-AR');
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

// Date -> 'yyyy-mm-dd' en hora LOCAL. Evita toISOString(), que usa UTC y
// después de las 21:00 (AR es UTC-3) devuelve el día siguiente.
export function fechaISO(d: Date): string {
	return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Hoy en 'yyyy-mm-dd' (local).
export function hoyISO(): string {
	return fechaISO(new Date());
}

// Mes actual en 'yyyy-mm' (local).
export function mesActual(): string {
	return hoyISO().slice(0, 7);
}

// Días enteros entre dos fechas. Acepta 'yyyy-mm-dd' o datetime (usa la porción de
// fecha). Parsea las partes y compara con Date.UTC: determinístico, NO usa "ahora"
// ni corre el día por zona horaria. diasEntre(a, b) > 0 si b es posterior a a.
export function diasEntre(isoA: string, isoB: string): number {
	const utc = (s: string) => {
		const [y, m, d] = s.slice(0, 10).split('-').map(Number);
		return Date.UTC(y, m - 1, d);
	};
	return Math.round((utc(isoB) - utc(isoA)) / 86400000);
}

// Default de fecha de cobro para un disparo de fijo: el día de HOY montado sobre
// el mes/año del selector, clampeado al último día de ese mes. Si el selector es
// el mes actual, equivale a hoyISO(). Si no (ej. registro de agosto estando en
// junio), cae dentro del mes del selector y nunca fuerza el día a un mes ajeno.
// El cálculo de "último día" es aritmética de mes (no toma "ahora"), así que no
// corre el día por UTC.
export function fechaCobroDefault(periodo: string): string {
	const [y, m] = periodo.split('-').map(Number);
	const diaHoy = Number(hoyISO().slice(8, 10));
	const ultimoDia = new Date(y, m, 0).getDate(); // día 0 del mes siguiente = último del actual
	const dia = Math.min(diaHoy, ultimoDia);
	return `${periodo}-${String(dia).padStart(2, '0')}`;
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

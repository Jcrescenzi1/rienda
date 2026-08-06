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

// Para inputs de "Monto" en edición cuyo prefill se redondea a 0 decimales para
// mostrar (Brief H / B1): si el usuario NO tocó el campo, devuelve el monto
// ORIGINAL con toda su precisión (nunca se pierde un decimal real guardado solo
// porque el display ahora lo redondea); si lo tocó, parsea lo que haya tipeado.
// `original` es el monto tal cual vino de la base al abrir la edición.
export function montoAGuardar(textoActual: string, original: number | null | undefined): number {
	if (original != null && textoActual === formatNum(original, 0)) return original;
	return parseNum(textoActual);
}

// Importe para MOSTRAR: formato AR con símbolo de moneda ($ / U$D), redondeado a
// `dec` decimales (default 0 = sin decimales, el criterio para montos de plata:
// gastos/ingresos/presupuestos/totales/tipo de cambio/liquidez común). Para precio
// de activo financiero (bonos/acciones/CEDEARs) se llama con dec=2 (o el que pida
// el caso puntual) para conservar los centavos. La carga y el guardado mantienen
// siempre el dato con todos sus decimales; esto es solo presentación. Único
// helper de moneda de la app — no reimplementar localmente por pantalla.
export function pesos(n: number | null | undefined, mon = 'ARS', dec = 0): string {
	const v = Number(n) || 0;
	const factor = 10 ** dec;
	let redondeado = Math.round(v * factor) / factor;
	// Un valor chico y negativo (ej. -0,004 en Caja Líquido) redondea a -0, que
	// toLocaleString muestra como "-0" — normaliza a 0 (=== also matches -0).
	if (redondeado === 0) redondeado = 0;
	return (mon === 'USD' ? 'U$D ' : '$') + redondeado.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// Cantidad de unidades de un activo para MOSTRAR: sin símbolo de moneda, hasta
// `dec` decimales pero SIN mínimo forzado (10 se ve "10", 10.5 se ve "10,5") —
// a diferencia de pesos()/precios, que sí fuerzan el mismo número de decimales
// siempre. Único helper de unidades de la app.
export function unidades(n: number | null | undefined, dec = 2): string {
	return (Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: dec });
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

// Evalúa una expresión aritmética simple (+ − * / y paréntesis) con números en formato
// es-AR (coma decimal, punto miles). Mini-parser propio (shunting-yard), NUNCA eval().
// Devuelve el número resultante o null si la expresión es inválida (carácter no
// permitido, paréntesis desbalanceado, división por cero, etc.).
export function evalMonto(texto: string): number | null {
	const s = (texto ?? '').trim();
	if (!s) return null;
	const tokens: (number | string)[] = [];
	let i = 0;
	while (i < s.length) {
		const c = s[i];
		if (c === ' ') { i++; continue; }
		if ('+-*/()'.includes(c)) { tokens.push(c); i++; continue; }
		if (/[0-9.,]/.test(c)) {
			let j = i;
			while (j < s.length && /[0-9.,]/.test(s[j])) j++;
			const num = parseNum(s.slice(i, j));
			if (!Number.isFinite(num)) return null;
			tokens.push(num);
			i = j;
			continue;
		}
		return null; // carácter inválido
	}
	if (!tokens.length) return null;
	const prec: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
	const out: (number | string)[] = [];
	const ops: string[] = [];
	let prev: number | string | null = null;
	for (const tk of tokens) {
		if (typeof tk === 'number') {
			out.push(tk);
		} else if (tk === '(') {
			ops.push(tk);
		} else if (tk === ')') {
			while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop() as string);
			if (!ops.length) return null;
			ops.pop();
		} else {
			// Unario: + o − al inicio o tras operador/'(' → 0 <op> num.
			if ((tk === '-' || tk === '+') && (prev === null || prev === '(' || (typeof prev === 'string' && '+-*/'.includes(prev)))) {
				out.push(0);
			}
			while (ops.length && ops[ops.length - 1] !== '(' && prec[ops[ops.length - 1]] >= prec[tk]) out.push(ops.pop() as string);
			ops.push(tk);
		}
		prev = tk;
	}
	while (ops.length) {
		const op = ops.pop() as string;
		if (op === '(') return null;
		out.push(op);
	}
	const st: number[] = [];
	for (const tk of out) {
		if (typeof tk === 'number') { st.push(tk); continue; }
		const b = st.pop();
		const a = st.pop();
		if (a === undefined || b === undefined) return null;
		let r: number;
		if (tk === '+') r = a + b;
		else if (tk === '-') r = a - b;
		else if (tk === '*') r = a * b;
		else if (tk === '/') { if (b === 0) return null; r = a / b; }
		else return null;
		st.push(r);
	}
	if (st.length !== 1 || !Number.isFinite(st[0])) return null;
	return Math.round(st[0] * 1e6) / 1e6; // mata ruido de coma flotante
}

// Action para inputs de monto: permite tipear una expresión aritmética y la evalúa al
// salir del campo (blur). Filtra en vivo a dígitos/separadores/operadores. Si no hay
// operador, es un número plano y no se toca. Si la expresión es inválida, se deja el
// texto como está (editable), no rompe ni guarda basura. inputmode lo define el markup.
export function calc(node: HTMLInputElement) {
	const filtro = () => {
		const limpio = node.value.replace(/[^0-9.,+\-*/() ]/g, '');
		if (node.value !== limpio) {
			node.value = limpio;
			node.dispatchEvent(new Event('input', { bubbles: true }));
		}
	};
	const evaluar = () => {
		// ¿Tiene operador? (ignora un signo inicial). Si no, número plano: no tocar.
		if (!/[+\-*/()]/.test(node.value.slice(1))) return;
		const r = evalMonto(node.value);
		if (r == null) return; // inválido: dejar editable
		const txt = String(r).replace('.', ',');
		if (node.value !== txt) {
			node.value = txt;
			node.dispatchEvent(new Event('input', { bubbles: true }));
		}
	};
	node.addEventListener('input', filtro);
	node.addEventListener('blur', evaluar);
	return {
		destroy() {
			node.removeEventListener('input', filtro);
			node.removeEventListener('blur', evaluar);
		}
	};
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
// Criterio único de la app para FECHA PUNTUAL de un movimiento (Brief H / B2).
const MESES_AR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export function fmtFecha(iso: string): string {
	if (!iso) return '';
	const [, m, d] = iso.split('-');
	const mi = Number(m) - 1;
	if (mi < 0 || mi > 11 || !d) return iso;
	return `${d}-${MESES_AR[mi]}`;
}

// "yyyy-mm" (o "yyyy-mm-dd", el día se ignora) -> "jun '26". Criterio único de la
// app para PERÍODO COMO UNIDAD: columnas de consolidado, selectores de mes, ejes
// de gráfico de evolución (Brief H / B2). Nunca mes completo (desborda, ej.
// "septiembre"). Reemplaza las ~6 reimplementaciones locales de "mesCorto"/
// "labelMes" que había repartidas por evol/* y Home.
export function mesCorto(periodo: string): string {
	if (!periodo) return '';
	const [y, m] = periodo.split('-');
	const mi = Number(m) - 1;
	if (mi < 0 || mi > 11 || !y) return periodo;
	return `${MESES_AR[mi]} '${y.slice(2)}`;
}

// Timestamp de sistema (última edición/importación/actualización de precios) para
// MOSTRAR: "28/07 14:30", SIEMPRE sin año (criterio único, Brief H / B2 — antes
// convivían una versión con año en Datos y otra sin año en Inversiones).
// `sinDato` es el texto para iso null/vacío (cada pantalla puede pedir su propia
// palabra, ej. "Nunca" vs "nunca").
export function fechaHoraCorta(iso: string | null | undefined, sinDato = 'nunca'): string {
	if (!iso) return sinDato;
	const d = new Date(iso);
	return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

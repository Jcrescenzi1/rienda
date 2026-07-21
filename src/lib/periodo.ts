// src/lib/periodo.ts
// Lógica de asignación de gastos a "período", compartida entre Presupuesto e Ingresos.
// Hay dos modos (decididos por perfil):
//   'sueldo'     → el período lo abre la fecha real del sueldo (cortes).
//   'calendario' → el período es el mes calendario del gasto (yyyy-mm).

import { query } from './db/client';
import { fechaISO } from './format';

export type ModoPeriodo = 'sueldo' | 'calendario';

// ---------------------------------------------------------------------------
// Día esperado de los recurrentes (gastos e ingresos fijos)
// ---------------------------------------------------------------------------
// El campo dia_esperado es el mismo entero en los dos modos; solo cambia cómo se
// lee y cómo se convierte en una fecha real. Los helpers de abajo concentran esa
// interpretación para que las pantallas no la repitan.

// Suma días a un 'yyyy-mm-dd'. Construye la fecha desde las partes del string
// (nunca desde "ahora"), así que es determinística y no corre el día por UTC-3.
// Se apoya en el desborde del constructor de Date para cruzar de mes/año solo.
export function addDias(iso: string, n: number): string {
	const [y, m, d] = iso.split('-').map(Number);
	return fechaISO(new Date(y, m - 1, d + n));
}

// Modo calendario: próxima vez que cae el día `dia`, igual o posterior a `hoy`.
// Si el día de este mes ya pasó, salta al mes siguiente. Esa única regla reemplaza
// al par "día X del mes corriente" + "filtrar los vencidos": por construcción el
// resultado nunca es anterior a hoy, así que no hay nada que filtrar después, y
// desaparece el punto ciego de fin de mes (el 31 de agosto, un fijo de día 1
// devuelve el 1 de septiembre y no el 1 de agosto ya pasado).
// Si el mes no tiene ese día (31 en abril, 30 en febrero) se clampea al último
// día del mes, igual que un cobro real. El clamp además evita que new Date()
// desborde silenciosamente al mes siguiente.
export function proximaOcurrencia(dia: number, hoy: string): string {
	const [y, m] = hoy.split('-').map(Number);
	const enMes = (yy: number, mm: number) => {
		const ultimo = new Date(yy, mm, 0).getDate(); // día 0 del mes siguiente = último de mm
		return `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`;
	};
	const esteMes = enMes(y, m);
	if (esteMes >= hoy) return esteMes;
	return m === 12 ? enMes(y + 1, 1) : enMes(y, m + 1);
}

// Etiqueta visible de un dia_esperado, según el modo del perfil.
//   calendario → "Día 8"      (día del mes)
//   sueldo     → "8° día"     (posición dentro del período; 1 = el día que cobrás)
export function etiquetaDia(dia: number, modo: ModoPeriodo): string {
	if (modo === 'calendario') return `Día ${dia}`;
	return dia === 1 ? 'Día de cobro' : `${dia}° día`;
}

// Las 31 opciones del selector, ya etiquetadas para el modo activo.
export function opcionesDia(modo: ModoPeriodo): { valor: number; label: string }[] {
	return Array.from({ length: 31 }, (_, i) => ({ valor: i + 1, label: etiquetaDia(i + 1, modo) }));
}

// Suma/resta meses a un 'yyyy-mm'. addMonths('2025-03', -2) -> '2025-01'.
export function addMonths(ym: string, delta: number): string {
	const [y, m] = ym.split('-').map(Number);
	const d = new Date(y, m - 1 + delta, 1);
	return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// Regla del veinte: período sugerido de un ingreso según su fecha de cobro.
// Ingreso Principal cobrado el día >= 20 abre el período del mes SIGUIENTE; el
// resto (y Secundarios/Otros) caen en el mes de la fecha. Parsea el string
// directo (sin new Date sobre el ISO) para no correr el día por UTC-3.
export function periodoRegla(fecha: string, categoria: string): string {
	const [y, m, d] = fecha.split('-').map(Number);
	const base = `${y}-${String(m).padStart(2, '0')}`;
	return categoria === 'Ingreso Principal' && d >= 20 ? addMonths(base, 1) : base;
}

// Período activo de Cuenta Corriente, leído de su sessionStorage (misma clave que
// usa la Home; acá SOLO se lee, no se crea ni se persiste nada nuevo). Sirve para
// que Gastos/Ingresos Fijos arranquen en el período que el usuario está mirando.
// La Home guarda { periodo, ultimoCorte } bajo 'cc_periodo'; en ambos modos
// 'periodo' es un 'yyyy-mm' (en sueldo es la etiqueta del corte, no un rango), así
// que el selector mensual de Fijos lo adopta directo. Devuelve 'yyyy-mm' o null.
export function periodoActivoCC(): string | null {
	try {
		const raw = sessionStorage.getItem('cc_periodo');
		if (!raw) return null;
		const p = (JSON.parse(raw) as { periodo?: unknown })?.periodo;
		return typeof p === 'string' && /^\d{4}-\d{2}$/.test(p) ? p : null;
	} catch {
		return null;
	}
}

// Lee el modo del perfil. Default 'sueldo' si la columna viniera NULL
// (p. ej. backup viejo importado antes de la migración).
export async function cargarModo(): Promise<ModoPeriodo> {
	const r = (await query('SELECT modo_periodo FROM perfil WHERE id=1')) as any[];
	return r[0]?.modo_periodo === 'calendario' ? 'calendario' : 'sueldo';
}

// Trae los cortes (fechas de Ingreso Principal Regular con su período), ordenados.
// Solo los ingresos Regular (internamente tipo='Sueldo') marcan el ritmo del período;
// los Extraordinario (aguinaldo, bonos) son plata extra dentro del mismo mes, no abren corte.
// Solo se usa en modo 'sueldo'; en 'calendario' no hace falta.
export async function cargarCortes(): Promise<{ fecha: string; periodo: string }[]> {
	const sueldos = (await query(
		"SELECT fecha, periodo FROM ingreso WHERE perfil_id=1 AND categoria='Ingreso Principal' AND tipo='Sueldo' AND periodo IS NOT NULL ORDER BY fecha"
	)) as any[];
	return sueldos.map((s) => ({ fecha: s.fecha, periodo: s.periodo }));
}

// Devuelve la función que asigna una fecha de gasto a su período, según el modo.
//   modo 'calendario' → (fecha) => fecha.slice(0,7)   (siempre devuelve algo)
//   modo 'sueldo'     → (fecha) => período del corte que la contiene (o null)
export function crearAsignador(
	modo: ModoPeriodo,
	cortes: { fecha: string; periodo: string }[]
): (fecha: string) => string | null {
	if (modo === 'calendario') {
		return (fecha: string) => fecha.slice(0, 7);
	}
	// cortes viene ordenado ascendente por fecha -> binary search del último corte
	// con fecha <= la del movimiento. Antes era scan lineal por fecha: O(cortes)
	// por movimiento, llamado en varios derivados de las pantallas de evolución.
	return (fecha: string) => {
		let lo = 0, hi = cortes.length - 1, periodo: string | null = null;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (cortes[mid].fecha <= fecha) { periodo = cortes[mid].periodo; lo = mid + 1; }
			else hi = mid - 1;
		}
		return periodo;
	};
}
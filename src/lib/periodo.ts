// src/lib/periodo.ts
// Lógica de asignación de gastos a "período", compartida entre Presupuesto e Ingresos.
// Hay dos modos (decididos por perfil):
//   'sueldo'     → el período lo abre la fecha real del sueldo (cortes).
//   'calendario' → el período es el mes calendario del gasto (yyyy-mm).

import { query } from './db/client';

export type ModoPeriodo = 'sueldo' | 'calendario';

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
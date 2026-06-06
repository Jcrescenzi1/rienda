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
	return (fecha: string) => {
		let elegido: string | null = null;
		for (const c of cortes) {
			if (c.fecha <= fecha) elegido = c.periodo;
			else break;
		}
		return elegido;
	};
}
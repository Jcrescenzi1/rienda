// src/lib/moneda.ts
// Conversión de montos entre las tres vistas de moneda que comparten las
// visuales de análisis (Ingresos vs Gastos, Evolución de Gastos):
//   'usd'     → dólar bolsa del día del movimiento.
//   'nominal' → pesos tal cual (montos USD pasados a ARS al dólar del día).
//   'real'    → pesos de HOY: el monto nominal en ARS ajustado por inflación
//               desde el mes del movimiento hasta el último mes con dato de IPC.
//
// Funciones puras + cargadores. El modo elegido (reactivo y persistido) vive
// en moneda.svelte.ts para no mezclar runes con lógica pura.

import { query } from './db/client';

export type ModoMoneda = 'usd' | 'real' | 'nominal';

export const MODOS_MONEDA: ModoMoneda[] = ['usd', 'real', 'nominal'];

export const LABEL_MONEDA: Record<ModoMoneda, string> = {
	usd: 'USD',
	real: 'Pesos reales',
	nominal: 'Pesos nominales'
};

// ===== Dólar =====
export type DolarSerie = { fecha: string; valor: number }[];

// Serie diaria del dólar bolsa, ordenada ascendente.
export async function cargarDolarSerie(): Promise<DolarSerie> {
	const rows = (await query(
		"SELECT fecha, valor FROM cotizacion_dolar WHERE perfil_id=1 AND casa='bolsa' ORDER BY fecha"
	)) as any[];
	return rows.map((d) => ({ fecha: d.fecha, valor: d.valor }));
}

// Último valor del dólar conocido en/antes de la fecha (null si no hay ninguno previo).
export function dolarDeFecha(serie: DolarSerie, fecha: string): number | null {
	let elegido: number | null = null;
	for (const d of serie) {
		if (d.fecha <= fecha) elegido = d.valor;
		else break;
	}
	return elegido;
}

// ===== Inflación / IPC =====
// Índice de precios acumulado a partir de la tabla inflacion (valores mensuales
// en decimal, ej. 0.021 = 2,1%). El índice del mes M es el producto acumulado
// de (1+infl) hasta M inclusive, con base 1 en el primer mes con dato.
export type IPC = {
	indice: Record<string, number>;
	ultimoPeriodo: string | null;
	// Factor para llevar un monto de un 'yyyy-mm' a pesos del último mes con dato.
	factorAHoy: (periodo: string) => number;
};

export async function cargarIPC(): Promise<IPC> {
	const rows = (await query(
		'SELECT periodo, valor FROM inflacion WHERE perfil_id=1 ORDER BY periodo'
	)) as any[];
	const indice: Record<string, number> = {};
	const claves: string[] = [];
	let acc = 1;
	let ultimoPeriodo: string | null = null;
	for (const r of rows) {
		acc *= 1 + (r.valor ?? 0);
		indice[r.periodo] = acc;
		claves.push(r.periodo);
		ultimoPeriodo = r.periodo;
	}
	const idxUltimo = ultimoPeriodo ? indice[ultimoPeriodo] : 1;

	const factorAHoy = (periodo: string): number => {
		let idx = indice[periodo];
		if (idx == null) {
			// Sin dato exacto: tomamos el último mes con dato <= período.
			let elegido: number | null = null;
			for (const k of claves) {
				if (k <= periodo) elegido = indice[k];
				else break;
			}
			// Período posterior al último dato (lag de la API) o anterior al primero:
			// sin ajuste fiable -> factor 1.
			idx = elegido ?? idxUltimo;
		}
		return idx > 0 ? idxUltimo / idx : 1;
	};

	return { indice, ultimoPeriodo, factorAHoy };
}

// ===== Conversión de un movimiento =====
// Devuelve el monto convertido al modo pedido, o null si falta el dato necesario
// (p. ej. un movimiento en USD sin cotización previa a su fecha).
export function convertir(
	monto: number,
	moneda: string,
	fecha: string,
	modo: ModoMoneda,
	dolar: DolarSerie,
	ipc: IPC
): number | null {
	if (modo === 'usd') {
		if (moneda === 'USD') return monto;
		const d = dolarDeFecha(dolar, fecha);
		return d ? monto / d : null;
	}
	// Pesos: primero a ARS nominal.
	let ars: number | null;
	if (moneda === 'ARS') ars = monto;
	else {
		const d = dolarDeFecha(dolar, fecha);
		ars = d ? monto * d : null;
	}
	if (ars == null) return null;
	if (modo === 'nominal') return ars;
	// Real: inflar a hoy según el mes calendario del movimiento.
	return ars * ipc.factorAHoy(fecha.slice(0, 7));
}

// Formateador acorde al modo (USD sin decimales / pesos con $).
export function fmtMoneda(n: number, modo: ModoMoneda, dec = 0): string {
	const v = Number(n || 0).toLocaleString('es-AR', {
		minimumFractionDigits: dec,
		maximumFractionDigits: dec
	});
	return modo === 'usd' ? 'U$D ' + v : '$' + v;
}

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

// Día de cobro (1-31) que abre el período activo en modo sueldo: el día del mes de
// la fecha del último Ingreso Principal Regular (tipo='Sueldo') registrado. null si
// no hay ninguno (o en modo calendario, donde no se llama). Se usa SOLO para rotar
// la lista de recurrentes por presentación; no interviene en el cálculo del aviso.
export async function diaCobroActivo(): Promise<number | null> {
	const r = (await query(
		"SELECT fecha FROM ingreso WHERE perfil_id=1 AND categoria='Ingreso Principal' AND tipo='Sueldo' ORDER BY fecha DESC LIMIT 1"
	)) as any[];
	const f = r[0]?.fecha;
	return typeof f === 'string' ? Number(f.slice(8, 10)) : null;
}

// Clave de orden de un dia_esperado para la lista de recurrentes.
//   cobro = null (calendario, o sueldo sin ingreso) → orden crudo por día (1→31).
//   cobro = C (1-31)  → rotación: la lista arranca en C y da la vuelta
//                       (C, C+1, …, 31, 1, …, C-1). Es puro reordenamiento visual
//                       sobre el entero guardado; no construye fechas.
// dia null (sin día) va siempre al final.
export function ordenDia(dia: number | null, cobro: number | null): number {
	if (dia == null) return Infinity;
	if (cobro == null) return dia;
	return ((dia - cobro) % 31 + 31) % 31;
}

// Secuencia COMPLETA de períodos de la ventana elegida, para el eje del gráfico de
// evolución (los períodos sin dato se dibujan en cero; el dato se hace left-join).
// Respeta el modo, usando el mismo enumerador que la navegación de la Home:
//   sueldo     → la secuencia real de cortes (su label ES el período).
//   calendario → meses consecutivos yyyy-mm (addMonths).
// `actual` = período actual (usar mesActual(), no new Date()). `primerDato` = primer
// período con dato en el filtro actual (para acotar "histórico" por abajo).
export function secuenciaPeriodos(
	vista: 'historico' | 'ult12' | 'anio',
	opts: { modo: ModoPeriodo; cortePeriodos: string[]; primerDato: string | null; actual: string; anio: string }
): string[] {
	const { modo, cortePeriodos, primerDato, actual } = opts;
	const anio = /^\d{4}$/.test(opts.anio) ? opts.anio : actual.slice(0, 4); // fallback si viene vacío
	if (modo === 'sueldo' && cortePeriodos.length) {
		// Límite superior real = el último corte conocido, NO el mes calendario
		// crudo: la regla del veinte puede abrir un período por delante del
		// calendario (ej. sueldo cobrado el 25/07 abre el período 2026-08), y
		// filtrar por `actual` (mesActual()) lo descartaba del eje hasta que el
		// calendario alcanzaba ese mes — el sueldo recién cargado "desaparecía"
		// de Evolución (Brief I). cortePeriodos viene ascendente por fecha, y el
		// período derivado de periodoRegla() nunca retrocede cuando la fecha
		// avanza, así que el último elemento es el corte más nuevo.
		const ultimoCorte = cortePeriodos[cortePeriodos.length - 1];
		const limite = ultimoCorte > actual ? ultimoCorte : actual;
		const arr = cortePeriodos.filter((p) => p <= limite); // ascendente
		if (vista === 'ult12') return arr.slice(-12);
		if (vista === 'anio') return arr.filter((p) => p.startsWith(anio));
		const desde = primerDato ?? arr[0] ?? actual;
		return arr.filter((p) => p >= desde);
	}
	// calendario (o sueldo sin cortes): meses consecutivos.
	if (vista === 'ult12') {
		const out: string[] = [];
		for (let i = 11; i >= 0; i--) out.push(addMonths(actual, -i));
		return out;
	}
	if (vista === 'anio') {
		const fin = anio === actual.slice(0, 4) ? actual : `${anio}-12`;
		const out: string[] = [];
		let p = `${anio}-01`;
		while (p <= fin) { out.push(p); p = addMonths(p, 1); }
		return out;
	}
	// histórico: desde el primer dato (o el actual) hasta el actual, sin huecos.
	const out: string[] = [];
	let p = primerDato ?? actual;
	if (p > actual) return [actual];
	while (p <= actual) { out.push(p); p = addMonths(p, 1); }
	return out;
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
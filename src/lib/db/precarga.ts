// src/lib/db/precarga.ts
// Planillas: un .xlsx por módulo (Finanzas: Gastos+Ingresos · Inversiones:
// Activos+Renta y amortización+Caja), generado dinámico y poblado con la data
// actual — el mismo archivo sirve para bajar (backup liviano / mirar en Excel)
// y para volver a subir (carga masiva / conciliar contra el extracto del
// broker). No hay plantilla estática ni CSVs de solo lectura: todo sale de la
// base en el momento.
// Reglas generales:
//  - Las hojas vacías se saltean al importar: el usuario sube solo lo que quiere.
//  - Todo-o-nada por hoja: si una fila tiene error, esa hoja no se importa.
//  - Categorías, subcategorías, tarjetas, cuentas y (en Activos) activos que no
//    existan se crean solos. Renta y amortización es la excepción: el ticker
//    tiene que existir de antes (ver importarRentaFilas).

import { query, queryBatch } from './client';
import { parseNum, formatNum, fechaISO } from '../format';

export type ResultadoImport = { filas: number; creados: string[]; omitidas: number; cancelado?: boolean };

// Si hay duplicadas, el usuario decide: importar solo las nuevas, o cancelar la hoja.
// Devuelve true si hay que seguir adelante.
function confirmarDuplicadas(hoja: string, criterio: string, omitidas: number, total: number, nuevas: number): boolean {
	if (omitidas === 0 || nuevas === 0) return true; // nada que preguntar
	return confirm(
		`${hoja}: ${omitidas} de ${total} fila(s) ya parecen cargadas (${criterio}) y se omitirán.\n` +
		`¿Importar las ${nuevas} restantes?`
	);
}
type Fila = Record<string, string>;

// Único punto de descarga de archivo (los dos módulos son .xlsx binarios).
export function descargarBlob(nombre: string, blob: Blob) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = nombre;
	a.click();
	URL.revokeObjectURL(url);
}

// ---------- Helpers de validación ----------

function normFecha(s: string): string | null {
	const t = s.trim();
	if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
	const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
	if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
	return null;
}

function normPeriodo(s: string): string | null {
	const t = s.trim();
	if (/^\d{4}-\d{2}$/.test(t)) return t;
	if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t.slice(0, 7); // celda de Excel formateada como fecha
	return null;
}

function lanzarErrores(errores: string[]) {
	if (!errores.length) return;
	const msj = errores.slice(0, 10).join('\n') + (errores.length > 10 ? `\n…y ${errores.length - 10} errores más.` : '');
	throw new Error('No se importó nada de este bloque. Corregí y volvé a intentar:\n' + msj);
}

// get-or-create genérico por nombre. Devuelve mapa nombre(minúsculas) -> id.
async function mapaPorNombre(tabla: string): Promise<Record<string, number>> {
	const rows = (await query(`SELECT id, nombre FROM ${tabla} WHERE perfil_id=1`)) as any[];
	const m: Record<string, number> = {};
	for (const r of rows) m[r.nombre.toLowerCase()] = r.id;
	return m;
}

// ---------- Importar GASTOS ----------

export async function importarGastosFilas(filas: Fila[]): Promise<ResultadoImport> {
	const errores: string[] = [];
	const creados: string[] = [];

	const cats = await mapaPorNombre('categoria');
	const subs = await mapaPorNombre('subcategoria');
	const tarjetas = await mapaPorNombre('tarjeta');

	type FilaOK = { fecha: string; monto: number; moneda: string; cat: string; sub: string; detalle: string; medio: string; tarjeta: string; cuotas: number; mesInicio: string | null };
	const ok: FilaOK[] = [];

	filas.forEach((f, i) => {
		const n = i + 2; // número de línea en el archivo (1 = encabezado)
		const fecha = normFecha(f['fecha'] ?? '');
		const monto = parseNum(f['monto']);
		const moneda = (f['moneda'] || 'ARS').toUpperCase();
		const cat = (f['categoria'] ?? '').trim();
		const detalle = (f['detalle'] ?? '').trim();
		const medio = (f['medio'] || 'debito').toLowerCase();
		const tarjeta = (f['tarjeta'] ?? '').trim();
		const cuotas = f['cuotas']?.trim() ? Number(f['cuotas']) : 1;
		let mesInicio: string | null = f['mes_inicio_pago']?.trim() ? normPeriodo(f['mes_inicio_pago']) : null;

		if (!fecha) errores.push(`Línea ${n}: fecha inválida "${f['fecha']}" (usar AAAA-MM-DD o DD/MM/AAAA).`);
		if (!Number.isFinite(monto) || monto <= 0) errores.push(`Línea ${n}: monto inválido "${f['monto']}" (coma decimal, ej 1.234,56).`);
		if (moneda !== 'ARS' && moneda !== 'USD') errores.push(`Línea ${n}: moneda "${f['moneda']}" (solo ARS o USD).`);
		if (!cat) errores.push(`Línea ${n}: falta la categoría.`);
		if (!detalle) errores.push(`Línea ${n}: falta el detalle.`);
		if (medio !== 'debito' && medio !== 'credito') errores.push(`Línea ${n}: medio "${f['medio']}" (solo debito o credito).`);
		if (medio === 'credito') {
			if (!tarjeta) errores.push(`Línea ${n}: gasto en crédito sin tarjeta.`);
			if (!Number.isInteger(cuotas) || cuotas < 1) errores.push(`Línea ${n}: cuotas inválidas "${f['cuotas']}".`);
			if (f['mes_inicio_pago']?.trim() && !mesInicio) errores.push(`Línea ${n}: mes_inicio_pago inválido "${f['mes_inicio_pago']}" (usar AAAA-MM).`);
			if (!mesInicio && fecha) mesInicio = fecha.slice(0, 7);
		}
		if (fecha && Number.isFinite(monto) && monto > 0)
			ok.push({ fecha, monto, moneda, cat, sub: (f['subcategoria'] ?? '').trim(), detalle, medio, tarjeta, cuotas, mesInicio });
	});
	lanzarErrores(errores);

	// Anti-duplicados: omite filas idénticas a gastos YA cargados en la base
	// (misma fecha + monto + detalle). No compara entre filas del archivo:
	// dos compras iguales el mismo día en tu planilla entran ambas.
	const existentes = (await query('SELECT fecha, monto, detalle FROM gasto WHERE perfil_id=1')) as any[];
	const setExist = new Set(existentes.map((g) => `${g.fecha}|${g.monto.toFixed(2)}|${g.detalle.toLowerCase()}`));
	const total = ok.length;
	const nuevos = ok.filter((f) => !setExist.has(`${f.fecha}|${f.monto.toFixed(2)}|${f.detalle.toLowerCase()}`));
	const omitidas = total - nuevos.length;
	if (!confirmarDuplicadas('Gastos', 'misma fecha, monto y detalle', omitidas, total, nuevos.length))
		return { filas: 0, creados: [], omitidas, cancelado: true };
	ok.length = 0;
	ok.push(...nuevos);

	// Alta de catálogos faltantes (pocas filas: viajes individuales con RETURNING)
	for (const f of ok) {
		const ck = f.cat.toLowerCase();
		if (!(ck in cats)) {
			const r = (await query('INSERT INTO categoria (perfil_id, nombre) VALUES (1, ?) RETURNING id', [f.cat])) as any[];
			cats[ck] = r[0].id; creados.push(`categoría "${f.cat}"`);
		}
		if (f.sub) {
			const sk = f.sub.toLowerCase();
			if (!(sk in subs)) {
				const r = (await query('INSERT INTO subcategoria (perfil_id, nombre) VALUES (1, ?) RETURNING id', [f.sub])) as any[];
				subs[sk] = r[0].id; creados.push(`subcategoría "${f.sub}"`);
			}
		}
		if (f.medio === 'credito') {
			const tk = f.tarjeta.toLowerCase();
			if (!(tk in tarjetas)) {
				const r = (await query("INSERT INTO tarjeta (perfil_id, nombre, tipo) VALUES (1, ?, 'credito') RETURNING id", [f.tarjeta])) as any[];
				tarjetas[tk] = r[0].id; creados.push(`tarjeta "${f.tarjeta}"`);
			}
		}
	}

	// Lote: gastos + reglas del diccionario (detalle -> subcategoría, sin pisar las existentes)
	const stmts: { sql: string; bind?: unknown[] }[] = [];
	for (const f of ok) {
		const scid = f.sub ? subs[f.sub.toLowerCase()] : null;
		if (scid) stmts.push({ sql: 'INSERT OR IGNORE INTO mapeo_detalle (perfil_id, detalle, subcategoria_id) VALUES (1, ?, ?)', bind: [f.detalle, scid] });
		if (f.medio === 'debito') {
			stmts.push({
				sql: "INSERT INTO gasto (perfil_id,fecha,monto,moneda,categoria_id,detalle,subcategoria_id,medio,cuotas) VALUES (1,?,?,?,?,?,?,'debito',1)",
				bind: [f.fecha, f.monto, f.moneda, cats[f.cat.toLowerCase()], f.detalle, scid]
			});
		} else {
			stmts.push({
				sql: "INSERT INTO gasto (perfil_id,fecha,monto,moneda,categoria_id,detalle,subcategoria_id,medio,tarjeta_id,cuotas,mes_inicio_pago) VALUES (1,?,?,?,?,?,?,'credito',?,?,?)",
				bind: [f.fecha, f.monto, f.moneda, cats[f.cat.toLowerCase()], f.detalle, scid, tarjetas[f.tarjeta.toLowerCase()], f.cuotas, f.mesInicio + '-01']
			});
		}
	}
	await queryBatch(stmts);
	return { filas: ok.length, creados, omitidas };
}

// ---------- Importar INGRESOS ----------

const CATS_INGRESO = ['Ingreso Principal', 'Ingresos Secundarios', 'Otros', 'Desahorro'];

export async function importarIngresosFilas(filas: Fila[]): Promise<ResultadoImport> {
	const errores: string[] = [];
	type FilaOK = { fecha: string; monto: number; moneda: string; cat: string; tipo: string | null; detalle: string | null; periodo: string | null };
	const ok: FilaOK[] = [];

	filas.forEach((f, i) => {
		const n = i + 2;
		const fecha = normFecha(f['fecha'] ?? '');
		const monto = parseNum(f['monto']);
		const moneda = (f['moneda'] || 'ARS').toUpperCase();
		const cat = CATS_INGRESO.find((c) => c.toLowerCase() === (f['categoria'] ?? '').trim().toLowerCase());
		const tipoRaw = (f['tipo'] ?? '').trim().toLowerCase();
		const tipo = tipoRaw === '' ? null
			: ['regular', 'sueldo'].includes(tipoRaw) ? 'Sueldo'
			: ['extraordinario', 'aciclico', 'acíclico'].includes(tipoRaw) ? 'Aciclico'
			: undefined;
		let periodo = f['periodo']?.trim() ? normPeriodo(f['periodo']) : null;

		if (!fecha) errores.push(`Línea ${n}: fecha inválida "${f['fecha']}".`);
		if (!Number.isFinite(monto) || monto <= 0) errores.push(`Línea ${n}: monto inválido "${f['monto']}".`);
		if (moneda !== 'ARS' && moneda !== 'USD') errores.push(`Línea ${n}: moneda "${f['moneda']}" (solo ARS o USD).`);
		if (!cat) errores.push(`Línea ${n}: categoría "${f['categoria']}" (usar: ${CATS_INGRESO.join(' / ')}).`);
		if (tipo === undefined) errores.push(`Línea ${n}: tipo "${f['tipo']}" (usar Regular o Extraordinario, o dejar vacío).`);
		if (f['periodo']?.trim() && !periodo) errores.push(`Línea ${n}: período inválido "${f['periodo']}" (usar AAAA-MM).`);

		if (fecha && !periodo) {
			// Regla estándar: Ingreso Principal cobrado el día >= 20 pertenece al mes siguiente
			const [y, m, d] = fecha.split('-').map(Number);
			const delta = cat === 'Ingreso Principal' && d >= 20 ? 1 : 0;
			const fp = new Date(y, m - 1 + delta, 1);
			periodo = fp.getFullYear() + '-' + String(fp.getMonth() + 1).padStart(2, '0');
		}

		if (fecha && Number.isFinite(monto) && monto > 0 && cat && tipo !== undefined) {
			ok.push({ fecha, monto, moneda, cat, tipo, detalle: (f['detalle'] ?? '').trim() || null, periodo });
		}
	});
	lanzarErrores(errores);

	// Anti-duplicados: omite filas idénticas a ingresos ya cargados
	// (misma fecha + monto + categoría).
	const existentes = (await query('SELECT fecha, monto, categoria FROM ingreso WHERE perfil_id=1')) as any[];
	const setExist = new Set(existentes.map((r) => `${r.fecha}|${r.monto.toFixed(2)}|${r.categoria}`));
	const nuevos = ok.filter((f) => !setExist.has(`${f.fecha}|${f.monto.toFixed(2)}|${f.cat}`));
	const omitidas = ok.length - nuevos.length;
	if (!confirmarDuplicadas('Ingresos', 'misma fecha, monto y categoría', omitidas, ok.length, nuevos.length))
		return { filas: 0, creados: [], omitidas, cancelado: true };

	const stmts = nuevos.map((f) => ({
		sql: 'INSERT INTO ingreso (perfil_id,fecha,monto,moneda,categoria,tipo,detalle,periodo) VALUES (1,?,?,?,?,?,?,?)',
		bind: [f.fecha, f.monto, f.moneda, f.cat, f.tipo, f.detalle, f.periodo]
	}));
	await queryBatch(stmts);
	return { filas: nuevos.length, creados: [], omitidas };
}

// ---------- Importar INVERSIONES ----------

const TIPOS_ACTIVO = ['Bono', 'ON', 'FCI', 'Accion', 'CEDEAR', 'Indice'];
const RENTAS = ['Fija', 'Mixta', 'Variable', 'Liquido'];

export async function importarInversionesFilas(filas: Fila[]): Promise<ResultadoImport> {
	const errores: string[] = [];
	const creados: string[] = [];

	// Activos existentes por ticker
	const activos = (await query('SELECT id, ticker FROM activo WHERE perfil_id=1')) as any[];
	const porTicker: Record<string, number> = {};
	for (const a of activos) porTicker[a.ticker.toLowerCase()] = a.id;
	const cuentas = await mapaPorNombre('cuenta_inversion');

	type FilaOK = { fecha: string; operacion: string; ticker: string; nombre: string; tipo: string; renta: string; moneda: string; cuenta: string; unidades: number; monto: number; vd: number | null };
	const ok: FilaOK[] = [];

	filas.forEach((f, i) => {
		const n = i + 2;
		const fecha = normFecha(f['fecha'] ?? '');
		const opRaw = (f['operacion'] ?? '').trim().toLowerCase();
		const operacion = opRaw === 'compra' ? 'Compra' : opRaw === 'venta' ? 'Venta' : null;
		const ticker = (f['ticker'] ?? '').trim();
		const cuenta = (f['cuenta'] ?? '').trim();
		const unidades = parseNum(f['unidades']);
		const monto = parseNum(f['monto_total']);
		const vd = f['valor_dolar']?.trim() ? parseNum(f['valor_dolar']) : null;
		const esNuevo = ticker && !(ticker.toLowerCase() in porTicker);
		const tipo = (f['tipo'] ?? '').trim();
		const renta = (f['renta'] ?? '').trim();
		const moneda = (f['moneda'] ?? '').trim().toUpperCase();

		if (!fecha) errores.push(`Línea ${n}: fecha inválida "${f['fecha']}".`);
		if (!operacion) errores.push(`Línea ${n}: operación "${f['operacion']}" (solo Compra o Venta).`);
		if (!ticker) errores.push(`Línea ${n}: falta el ticker.`);
		if (!cuenta) errores.push(`Línea ${n}: falta la cuenta.`);
		if (!Number.isFinite(unidades) || unidades <= 0) errores.push(`Línea ${n}: unidades inválidas "${f['unidades']}".`);
		if (!Number.isFinite(monto) || monto <= 0) errores.push(`Línea ${n}: monto_total inválido "${f['monto_total']}".`);
		if (vd !== null && (!Number.isFinite(vd) || vd <= 0)) errores.push(`Línea ${n}: valor_dolar inválido "${f['valor_dolar']}".`);
		if (esNuevo) {
			// Para crear el activo hacen falta sus datos (solo en la primera fila que lo menciona)
			if (!TIPOS_ACTIVO.includes(tipo)) errores.push(`Línea ${n}: ticker nuevo "${ticker}" necesita tipo válido (${TIPOS_ACTIVO.join('/')}).`);
			if (!RENTAS.includes(renta)) errores.push(`Línea ${n}: ticker nuevo "${ticker}" necesita renta válida (${RENTAS.join('/')}).`);
			if (moneda !== 'ARS' && moneda !== 'USD') errores.push(`Línea ${n}: ticker nuevo "${ticker}" necesita moneda ARS o USD.`);
			// Lo registramos como "visto" para no exigir datos en las filas siguientes
			porTicker[ticker.toLowerCase()] = -1;
		}
		ok.push({ fecha: fecha ?? '', operacion: operacion ?? '', ticker, nombre: (f['nombre'] ?? '').trim() || ticker, tipo, renta, moneda, cuenta, unidades, monto, vd });
	});
	lanzarErrores(errores);

	// Anti-duplicados: omite filas idénticas a operaciones ya cargadas
	// (misma fecha + operación + ticker + unidades).
	const existentes = (await query(
		'SELECT t.fecha, t.operacion, a.ticker, t.unidades FROM transaccion t JOIN activo a ON a.id = t.activo_id WHERE t.perfil_id=1'
	)) as any[];
	const setExist = new Set(existentes.map((r) => `${r.fecha}|${r.operacion}|${r.ticker.toLowerCase()}|${r.unidades.toFixed(4)}`));
	const nuevosInv = ok.filter((f) => !setExist.has(`${f.fecha}|${f.operacion}|${f.ticker.toLowerCase()}|${f.unidades.toFixed(4)}`));
	const omitidas = ok.length - nuevosInv.length;
	if (!confirmarDuplicadas('Inversiones', 'misma fecha, operación, ticker y unidades', omitidas, ok.length, nuevosInv.length))
		return { filas: 0, creados: [], omitidas, cancelado: true };
	ok.length = 0;
	ok.push(...nuevosInv);

	// Alta de cuentas y activos nuevos
	for (const f of ok) {
		const ck = f.cuenta.toLowerCase();
		if (!(ck in cuentas)) {
			const r = (await query("INSERT INTO cuenta_inversion (perfil_id, nombre, tipo) VALUES (1, ?, 'broker') RETURNING id", [f.cuenta])) as any[];
			cuentas[ck] = r[0].id; creados.push(`cuenta "${f.cuenta}"`);
		}
		const tk = f.ticker.toLowerCase();
		if (porTicker[tk] === -1) {
			const r = (await query('INSERT INTO activo (perfil_id,ticker,nombre,tipo,renta,moneda) VALUES (1,?,?,?,?,?) RETURNING id',
				[f.ticker, f.nombre, f.tipo, f.renta, f.moneda])) as any[];
			porTicker[tk] = r[0].id; creados.push(`activo "${f.ticker}"`);
		}
	}

	// Lote de transacciones (histórico: sin efecto caja, la liquidez se ancla a mano)
	const stmts = ok.map((f) => ({
		sql: 'INSERT INTO transaccion (perfil_id,activo_id,cuenta_inversion_id,fecha,operacion,unidades,precio,valor_dolar) VALUES (1,?,?,?,?,?,?,?)',
		bind: [porTicker[f.ticker.toLowerCase()], cuentas[f.cuenta.toLowerCase()], f.fecha, f.operacion, f.unidades, f.monto / f.unidades, f.vd]
	}));
	await queryBatch(stmts);

	// Actualiza el precio de mercado de cada activo con su operación MÁS NUEVA,
	// solo si es más nueva que la última actualización registrada.
	const ultPorActivo: Record<string, FilaOK> = {};
	for (const f of ok) {
		const k = f.ticker.toLowerCase();
		if (!ultPorActivo[k] || f.fecha > ultPorActivo[k].fecha) ultPorActivo[k] = f;
	}
	for (const f of Object.values(ultPorActivo)) {
		const id = porTicker[f.ticker.toLowerCase()];
		const pa = (await query('SELECT precio_actualizado_en FROM activo WHERE id=? AND perfil_id=1', [id])) as any[];
		const ult = pa[0]?.precio_actualizado_en;
		if (!ult || f.fecha >= ult) {
			await query('UPDATE activo SET precio_actual=?, precio_actualizado_en=? WHERE id=? AND perfil_id=1', [f.monto / f.unidades, f.fecha, id]);
		}
	}

	return { filas: ok.length, creados, omitidas };
}

// ---------- Importar RENTA Y AMORTIZACIÓN ----------

// A diferencia de importarInversionesFilas, acá el ticker NO se crea solo: la
// renta/amortización es un cobro sobre un activo que ya existe en la cartera
// (nace de Compra/Venta). Un ticker que no matchea es un error de tipeo o un
// activo que falta cargar antes — mejor cortar duro que inventar el activo con
// datos que esta hoja ni siquiera trae completos (falta tipo).
export async function importarRentaFilas(filas: Fila[]): Promise<ResultadoImport> {
	const errores: string[] = [];

	const activos = (await query('SELECT id, ticker FROM activo WHERE perfil_id=1')) as any[];
	const porTicker: Record<string, number> = {};
	for (const a of activos) porTicker[a.ticker.toLowerCase()] = a.id;

	type FilaOK = { fecha: string; ticker: string; moneda: string; monto_renta: number; monto_amort: number; vd: number | null };
	const ok: FilaOK[] = [];

	filas.forEach((f, i) => {
		const n = i + 2;
		const fecha = normFecha(f['fecha'] ?? '');
		const ticker = (f['ticker'] ?? '').trim();
		const moneda = (f['moneda'] ?? '').trim().toUpperCase();
		const renta = f['monto_renta']?.trim() ? parseNum(f['monto_renta']) : 0;
		const amort = f['monto_amort']?.trim() ? parseNum(f['monto_amort']) : 0;
		const vd = f['valor_dolar']?.trim() ? parseNum(f['valor_dolar']) : null;

		if (!fecha) errores.push(`Línea ${n}: fecha inválida "${f['fecha']}".`);
		if (!ticker) errores.push(`Línea ${n}: falta el ticker.`);
		else if (!(ticker.toLowerCase() in porTicker)) errores.push(`Línea ${n}: el ticker "${ticker}" no existe en tu catálogo de activos — cargalo primero en Mercado.`);
		if (moneda !== 'ARS' && moneda !== 'USD') errores.push(`Línea ${n}: moneda "${f['moneda']}" (solo ARS o USD).`);
		if (!Number.isFinite(renta) || renta < 0) errores.push(`Línea ${n}: monto_renta inválido "${f['monto_renta']}".`);
		if (!Number.isFinite(amort) || amort < 0) errores.push(`Línea ${n}: monto_amort inválido "${f['monto_amort']}".`);
		if (Number.isFinite(renta) && Number.isFinite(amort) && renta + amort <= 0) errores.push(`Línea ${n}: cargá al menos un monto (renta o amortización).`);
		if (vd !== null && (!Number.isFinite(vd) || vd <= 0)) errores.push(`Línea ${n}: valor_dolar inválido "${f['valor_dolar']}".`);

		if (fecha && ticker && ticker.toLowerCase() in porTicker && (moneda === 'ARS' || moneda === 'USD') &&
			Number.isFinite(renta) && renta >= 0 && Number.isFinite(amort) && amort >= 0 && renta + amort > 0)
			ok.push({ fecha, ticker, moneda, monto_renta: renta, monto_amort: amort, vd });
	});
	lanzarErrores(errores);

	// Anti-duplicados: misma fecha + ticker + montos ya cargados.
	const existentes = (await query(
		'SELECT r.fecha, a.ticker, r.monto_renta, r.monto_amort FROM renta_activo r JOIN activo a ON a.id = r.activo_id WHERE r.perfil_id=1'
	)) as any[];
	const setExist = new Set(existentes.map((r) => `${r.fecha}|${r.ticker.toLowerCase()}|${r.monto_renta.toFixed(2)}|${r.monto_amort.toFixed(2)}`));
	const nuevos = ok.filter((f) => !setExist.has(`${f.fecha}|${f.ticker.toLowerCase()}|${f.monto_renta.toFixed(2)}|${f.monto_amort.toFixed(2)}`));
	const omitidas = ok.length - nuevos.length;
	if (!confirmarDuplicadas('Renta y amortización', 'misma fecha, ticker y montos', omitidas, ok.length, nuevos.length))
		return { filas: 0, creados: [], omitidas, cancelado: true };

	const stmts = nuevos.map((f) => ({
		sql: 'INSERT INTO renta_activo (perfil_id,activo_id,fecha,moneda,monto_renta,monto_amort,valor_dolar) VALUES (1,?,?,?,?,?,?)',
		bind: [porTicker[f.ticker.toLowerCase()], f.fecha, f.moneda, f.monto_renta, f.monto_amort, f.vd]
	}));
	await queryBatch(stmts);
	return { filas: nuevos.length, creados: [], omitidas };
}

// ---------- Importar CAJA ----------

const ACCIONES_CAJA = ['Ingreso', 'Retiro', 'Convertir'];

// Los pares "Convertir" (dos filas: la moneda que sale en negativo y la que
// entra en positivo, unidas por `grupo`) se tratan como una sola unidad: si al
// reimportar falta una de las dos patas (se borró una fila al editar la
// planilla, o se pegó un rango incompleto), se bloquea toda la hoja con el
// detalle de qué grupo quedó a medias — insertar solo una pata dejaría una
// conversión que no cierra (plata que "desaparece" de una moneda sin aparecer
// en la otra).
export async function importarCajaFilas(filas: Fila[]): Promise<ResultadoImport> {
	const errores: string[] = [];
	type FilaOK = { fecha: string; accion: string; moneda: string; monto: number; grupo: string | null; nota: string | null };
	const ok: FilaOK[] = [];

	filas.forEach((f, i) => {
		const n = i + 2;
		const fecha = normFecha(f['fecha'] ?? '');
		const accion = (f['accion'] ?? '').trim();
		const moneda = (f['moneda'] ?? '').trim().toUpperCase();
		const monto = parseNum(f['monto']);
		const grupo = (f['grupo'] ?? '').trim() || null;
		const nota = (f['nota'] ?? '').trim() || null;

		if (!fecha) errores.push(`Línea ${n}: fecha inválida "${f['fecha']}".`);
		if (!ACCIONES_CAJA.includes(accion)) errores.push(`Línea ${n}: accion "${f['accion']}" (usar Ingreso, Retiro o Convertir).`);
		if (moneda !== 'ARS' && moneda !== 'USD') errores.push(`Línea ${n}: moneda "${f['moneda']}" (solo ARS o USD).`);
		if (!Number.isFinite(monto) || monto === 0) errores.push(`Línea ${n}: monto inválido "${f['monto']}".`);
		if (accion === 'Convertir' && !grupo) errores.push(`Línea ${n}: fila Convertir sin "grupo" — no se puede aparear con su otra pata.`);

		if (fecha && ACCIONES_CAJA.includes(accion) && (moneda === 'ARS' || moneda === 'USD') && Number.isFinite(monto) && monto !== 0 && (accion !== 'Convertir' || grupo))
			ok.push({ fecha, accion, moneda, monto, grupo, nota });
	});
	lanzarErrores(errores);

	// Anti-duplicados: misma fecha + acción + moneda + monto + grupo ya cargada
	// (el grupo entra a la clave para no confundir dos conversiones distintas
	// que por casualidad tengan el mismo monto el mismo día).
	const existentes = (await query('SELECT fecha, accion, moneda, monto, grupo FROM mov_caja WHERE perfil_id=1')) as any[];
	const clave = (r: { fecha: string; accion: string; moneda: string; monto: number; grupo: string | null }) =>
		`${r.fecha}|${r.accion}|${r.moneda}|${r.monto.toFixed(2)}|${r.grupo ?? ''}`;
	const setExist = new Set(existentes.map(clave));
	const nuevos = ok.filter((f) => !setExist.has(clave(f)));
	const omitidas = ok.length - nuevos.length;
	if (!confirmarDuplicadas('Caja', 'misma fecha, acción, moneda, monto y grupo', omitidas, ok.length, nuevos.length))
		return { filas: 0, creados: [], omitidas, cancelado: true };

	// Chequeo de pares: por cada grupo de una fila Convertir nueva, cuenta
	// cuántas patas hay en total (ya guardadas en la base + las nuevas de este
	// import). Si no da exactamente 2, esa conversión está incompleta.
	const gruposNuevos = [...new Set(nuevos.filter((f) => f.accion === 'Convertir' && f.grupo).map((f) => f.grupo as string))];
	if (gruposNuevos.length) {
		const enBase = (await query(
			`SELECT grupo, COUNT(*) n FROM mov_caja WHERE perfil_id=1 AND grupo IN (${gruposNuevos.map(() => '?').join(',')}) GROUP BY grupo`,
			gruposNuevos
		)) as any[];
		const enBaseMap = new Map<string, number>(enBase.map((r) => [r.grupo, r.n]));
		const enNuevosMap = new Map<string, number>();
		for (const f of nuevos) if (f.accion === 'Convertir' && f.grupo) enNuevosMap.set(f.grupo, (enNuevosMap.get(f.grupo) ?? 0) + 1);
		const incompletos: string[] = [];
		for (const g of gruposNuevos) {
			const total = (enBaseMap.get(g) ?? 0) + (enNuevosMap.get(g) ?? 0);
			if (total !== 2) {
				const fila = nuevos.find((f) => f.grupo === g)!;
				incompletos.push(`Falta la otra pata del grupo "${g}" (${fila.fecha}, ${fila.moneda} ${fila.monto}).`);
			}
		}
		if (incompletos.length) {
			throw new Error('No se importó la hoja Caja: hay conversiones incompletas.\n' + incompletos.join('\n'));
		}
	}

	const stmts = nuevos.map((f) => ({
		sql: 'INSERT INTO mov_caja (perfil_id,fecha,accion,moneda,monto,grupo,nota) VALUES (1,?,?,?,?,?,?)',
		bind: [f.fecha, f.accion, f.moneda, f.monto, f.grupo, f.nota]
	}));
	await queryBatch(stmts);
	return { filas: nuevos.length, creados: [], omitidas };
}

// ---------- Importar EXCEL único (hojas Gastos / Ingresos / Inversiones) ----------

// Normaliza una celda de Excel a string compatible con los validadores:
// Date -> 'yyyy-mm-dd' · número -> coma decimal (formato AR) · resto -> texto.
function celdaATexto(v: any): string {
	if (v == null) return '';
	if (v instanceof Date) return fechaISO(v);
	if (typeof v === 'number') return String(v).replace('.', ',');
	return String(v).trim();
}

// Una hoja de un workbook ya leído -> filas normalizadas (misma limpieza que
// usaba el importador único de antes): claves en minúscula/trim, celdas a
// texto, filas 100% vacías descartadas.
function hojaAFilas(XLSX: typeof import('xlsx'), wb: import('xlsx').WorkBook, nombre: string): Fila[] {
	const ws = wb.Sheets[nombre];
	if (!ws) return [];
	const crudas = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { raw: true, defval: '' });
	return crudas
		.map((r) => {
			const f: Fila = {};
			for (const [k, v] of Object.entries(r)) f[k.toLowerCase().trim()] = celdaATexto(v);
			return f;
		})
		.filter((f) => Object.values(f).some((v) => v !== ''));
}

// Motor común de importación multi-hoja: cada módulo (Finanzas, Inversiones)
// arma su propio .xlsx de carga/descarga con un subconjunto de hojas, pero el
// recorrido — leer hoja, importar, resumir, cortar todo-o-nada por hoja con el
// error de esa hoja nombrado — es el mismo para las dos.
async function importarHojas(
	file: File,
	hojas: [string, (filas: Fila[]) => Promise<ResultadoImport>][],
	nombreModulo: string
): Promise<string> {
	const XLSX = await import('xlsx'); // carga diferida: solo pesa cuando se usa
	const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });

	const partes: string[] = [];
	for (const [nombre, importar] of hojas) {
		const filas = hojaAFilas(XLSX, wb, nombre);
		if (!filas.length) continue;
		try {
			const res = await importar(filas);
			if (res.cancelado) {
				partes.push(`${nombre}: cancelada por vos (${res.omitidas} duplicadas detectadas)`);
				continue;
			}
			partes.push(
				`${nombre}: ${res.filas} fila(s)` +
				(res.omitidas ? ` · ${res.omitidas} omitida(s) por duplicado` : '') +
				(res.creados.length ? ` · creados: ${res.creados.join(', ')}` : '')
			);
		} catch (err: any) {
			const previo = partes.length ? 'Ya importado: ' + partes.join(' | ') + '\n\n' : '';
			throw new Error(previo + `Hoja ${nombre}: ` + (err?.message ?? String(err)));
		}
	}
	if (!partes.length) throw new Error(`El Excel no tiene filas de datos en las hojas de ${nombreModulo}.`);
	return partes.join('\n');
}

export async function importarFinanzasXLSX(file: File): Promise<string> {
	return importarHojas(
		file,
		[
			['Gastos', importarGastosFilas],
			['Ingresos', importarIngresosFilas]
		],
		'Finanzas (Gastos / Ingresos)'
	);
}

export async function importarInversionesXLSX(file: File): Promise<string> {
	return importarHojas(
		file,
		[
			['Activos', importarInversionesFilas],
			['Renta y amortización', importarRentaFilas],
			['Caja', importarCajaFilas]
		],
		'Inversiones (Activos / Renta y amortización / Caja)'
	);
}

// Exporta TODO el flujo de Finanzas en un solo .xlsx de dos hojas (Gastos ·
// Ingresos), poblado con la data actual: el mismo archivo sirve para bajar y
// para volver a subir (importarFinanzasXLSX), así no hace falta mantener una
// plantilla vacía aparte ni CSVs de solo lectura.
export async function exportarFinanzasXLSX(): Promise<Blob> {
	const XLSX = await import('xlsx'); // carga diferida: solo pesa cuando se usa

	const gastos = (await query(`
		SELECT g.fecha, g.monto, g.moneda, c.nombre AS categoria,
		       COALESCE(s.nombre, sm.nombre, '') AS subcategoria,
		       g.detalle, g.medio, COALESCE(t.nombre, '') AS tarjeta, g.cuotas, g.mes_inicio_pago
		FROM gasto g
		JOIN categoria c ON c.id = g.categoria_id
		LEFT JOIN subcategoria s ON s.id = g.subcategoria_id
		LEFT JOIN mapeo_detalle md ON md.perfil_id = g.perfil_id AND md.detalle = g.detalle
		LEFT JOIN subcategoria sm ON sm.id = md.subcategoria_id
		LEFT JOIN tarjeta t ON t.id = g.tarjeta_id
		WHERE g.perfil_id = 1 ORDER BY g.fecha, g.id`)) as any[];
	const hojaGastos = [
		['fecha', 'monto', 'moneda', 'categoria', 'subcategoria', 'detalle', 'medio', 'tarjeta', 'cuotas', 'mes_inicio_pago'],
		...gastos.map((r) => [r.fecha, formatNum(r.monto), r.moneda, r.categoria, r.subcategoria, r.detalle, r.medio, r.tarjeta,
			r.medio === 'credito' ? r.cuotas : '', r.mes_inicio_pago ? r.mes_inicio_pago.slice(0, 7) : ''])
	];

	const ingresos = (await query(
		'SELECT fecha, monto, moneda, categoria, tipo, detalle, periodo FROM ingreso WHERE perfil_id=1 ORDER BY fecha, id'
	)) as any[];
	const tipoLabel = (t: string | null) => (t === 'Sueldo' ? 'Regular' : t === 'Aciclico' ? 'Extraordinario' : '');
	const hojaIngresos = [
		['fecha', 'monto', 'moneda', 'categoria', 'tipo', 'detalle', 'periodo'],
		...ingresos.map((r) => [r.fecha, formatNum(r.monto), r.moneda, r.categoria, tipoLabel(r.tipo), r.detalle ?? '', r.periodo ?? ''])
	];

	const wb = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hojaGastos), 'Gastos');
	XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hojaIngresos), 'Ingresos');
	const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
	return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// Exporta TODO el flujo de inversiones en un solo .xlsx de tres hojas
// (Activos · Renta y amortización · Caja) para conciliar contra el extracto
// del broker. Las tres hojas van siempre con su encabezado, aunque queden
// vacías (consistencia para el parseo). Fechas y montos: mismo tratamiento
// que la hoja Activos de siempre (formatNum, sin reformatear aparte).
export async function exportarInversionesXLSX(): Promise<Blob> {
	const XLSX = await import('xlsx'); // carga diferida: solo pesa cuando se usa

	// Hoja 1 — Activos (compra/venta): idéntica a como salía en el CSV.
	const activos = (await query(`
		SELECT t.fecha, t.operacion, a.ticker, a.nombre, a.tipo, a.renta, a.moneda,
		       c.nombre AS cuenta, t.unidades, t.unidades * t.precio AS monto_total, t.valor_dolar
		FROM transaccion t
		JOIN activo a ON a.id = t.activo_id
		JOIN cuenta_inversion c ON c.id = t.cuenta_inversion_id
		WHERE t.perfil_id = 1 ORDER BY t.fecha, t.id`)) as any[];
	const hojaActivos = [
		['fecha', 'operacion', 'ticker', 'nombre', 'tipo', 'renta', 'moneda', 'cuenta', 'unidades', 'monto_total', 'valor_dolar'],
		...activos.map((r) => [r.fecha, r.operacion, r.ticker, r.nombre, r.tipo, r.renta, r.moneda, r.cuenta,
			formatNum(r.unidades, 4), formatNum(r.monto_total), r.valor_dolar != null ? formatNum(r.valor_dolar, 2) : ''])
	];

	// Hoja 2 — Renta y amortización: renta_activo + JOIN activo por activo_id.
	const renta = (await query(`
		SELECT ra.fecha, a.ticker, a.nombre, a.tipo, a.renta, ra.moneda,
		       ra.monto_renta, ra.monto_amort, ra.valor_dolar
		FROM renta_activo ra
		JOIN activo a ON a.id = ra.activo_id
		WHERE ra.perfil_id = 1 ORDER BY ra.fecha, ra.id`)) as any[];
	const hojaRenta = [
		['fecha', 'ticker', 'nombre', 'tipo', 'renta', 'moneda', 'monto_renta', 'monto_amort', 'valor_dolar'],
		...renta.map((r) => [r.fecha, r.ticker, r.nombre, r.tipo, r.renta, r.moneda,
			formatNum(r.monto_renta), formatNum(r.monto_amort), r.valor_dolar != null ? formatNum(r.valor_dolar, 2) : ''])
	];

	// Hoja 3 — Caja: mov_caja directo, sin joins. Las conversiones son dos filas
	// con el mismo grupo y se exportan tal cual (no se aparean ni se netean).
	const caja = (await query(
		'SELECT fecha, accion, moneda, monto, grupo, nota FROM mov_caja WHERE perfil_id = 1 ORDER BY fecha, id'
	)) as any[];
	const hojaCaja = [
		['fecha', 'accion', 'moneda', 'monto', 'grupo', 'nota'],
		...caja.map((r) => [r.fecha, r.accion, r.moneda, formatNum(r.monto), r.grupo ?? '', r.nota ?? ''])
	];

	const wb = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hojaActivos), 'Activos');
	XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hojaRenta), 'Renta y amortización');
	XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hojaCaja), 'Caja');
	const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
	return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

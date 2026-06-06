import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { SCHEMA } from './schema';
import { SEED_MACRO } from './seed_macro';

let db: any = null;

// ===== Clasificación de tablas por módulo (para registrar última edición) =====
const TABLAS_FINANZAS = new Set([
	'gasto', 'ingreso', 'categoria', 'subcategoria', 'mapeo_detalle',
	'tarjeta', 'suscripcion', 'suscripcion_registro', 'presupuesto'
]);
const TABLAS_INVERSIONES = new Set([
	'activo', 'transaccion', 'cuenta_inversion', 'snapshot', 'liquidez', 'mov_caja'
]);
// Neutras (no cuentan como edición del usuario): cotizacion_dolar, inflacion,
// perfil, meta. No actualizan ninguna fecha.

// Detecta si un SQL es de escritura y a qué tabla apunta.
function tablaAfectada(sql: string): string | null {
	const s = sql.trim().toLowerCase();
	let m: RegExpMatchArray | null = null;
	if (s.startsWith('insert')) m = s.match(/insert\s+(?:or\s+\w+\s+)?into\s+["']?(\w+)/);
	else if (s.startsWith('update')) m = s.match(/update\s+["']?(\w+)/);
	else if (s.startsWith('delete')) m = s.match(/delete\s+from\s+["']?(\w+)/);
	return m ? m[1] : null;
}

// Registra la última edición del módulo correspondiente (si aplica).
function registrarEdicion(sql: string) {
	const tabla = tablaAfectada(sql);
	if (!tabla) return;
	let clave: string | null = null;
	if (TABLAS_FINANZAS.has(tabla)) clave = 'ultima_edicion_finanzas';
	else if (TABLAS_INVERSIONES.has(tabla)) clave = 'ultima_edicion_inversiones';
	if (!clave) return; // tabla neutra
	const ahora = new Date().toISOString();
	db.exec({
		sql: "INSERT INTO meta (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor",
		bind: [clave, ahora]
	});
}

async function init() {
	const sqlite3 = await sqlite3InitModule();
	const poolUtil = await sqlite3.installOpfsSAHPoolVfs({ name: 'rienda-pool' });
	db = new poolUtil.OpfsSAHPoolDb('/rienda.sqlite3');
	db.exec(SCHEMA);

	// Columna periodo en ingreso (agregada después del schema original)
	const cols = db.exec({ sql: 'PRAGMA table_info(ingreso)', rowMode: 'object', returnValue: 'resultRows' });
	if (!cols.some((c: any) => c.name === 'periodo')) {
		db.exec('ALTER TABLE ingreso ADD COLUMN periodo TEXT');
	}

	// Columnas de pago en transaccion (para mover liquidez en la moneda de pago)
	const tcols = db.exec({ sql: 'PRAGMA table_info(transaccion)', rowMode: 'object', returnValue: 'resultRows' });
	if (!tcols.some((c: any) => c.name === 'moneda_pago')) {
		db.exec('ALTER TABLE transaccion ADD COLUMN moneda_pago TEXT');
	}
	if (!tcols.some((c: any) => c.name === 'monto_pago')) {
		db.exec('ALTER TABLE transaccion ADD COLUMN monto_pago REAL');
	}

	// Columna modo_periodo en perfil (sueldo | calendario). Default 'sueldo'
	// mantiene el comportamiento histórico para perfiles ya existentes.
	const pcols = db.exec({ sql: 'PRAGMA table_info(perfil)', rowMode: 'object', returnValue: 'resultRows' });
	if (!pcols.some((c: any) => c.name === 'modo_periodo')) {
		db.exec("ALTER TABLE perfil ADD COLUMN modo_periodo TEXT NOT NULL DEFAULT 'sueldo'");
	}

	// Migración: renombrar categorías de ingreso (Salario→Ingreso Principal) y
	// ampliar el CHECK para 'Ingresos Secundarios'. El CHECK está cocido en el
	// CREATE, así que hay que recrear la tabla. Idempotente: solo corre si el
	// esquema actual NO menciona 'Ingreso Principal'.
	const isql = db.exec({
		sql: "SELECT sql FROM sqlite_master WHERE type='table' AND name='ingreso'",
		rowMode: 'object', returnValue: 'resultRows'
	});
	const ingDef: string = isql[0]?.sql ?? '';
	if (ingDef && !ingDef.includes('Ingreso Principal')) {
		db.exec(`
			BEGIN;
			ALTER TABLE ingreso RENAME TO ingreso_old;
			CREATE TABLE ingreso (
				id          INTEGER PRIMARY KEY,
				perfil_id   INTEGER NOT NULL REFERENCES perfil(id),
				fecha       TEXT NOT NULL,
				monto       REAL NOT NULL CHECK (monto > 0),
				moneda      TEXT NOT NULL CHECK (moneda IN ('ARS','USD')),
				categoria   TEXT NOT NULL CHECK (categoria IN ('Ingreso Principal','Ingresos Secundarios','Otros')),
				tipo        TEXT CHECK (tipo IN ('Sueldo','Aciclico')),
				detalle     TEXT,
				periodo     TEXT,
				CHECK (
					(categoria = 'Ingreso Principal' AND tipo IS NOT NULL)
					OR
					(categoria IN ('Ingresos Secundarios','Otros') AND tipo IS NULL)
				)
			);
			INSERT INTO ingreso (id, perfil_id, fecha, monto, moneda, categoria, tipo, detalle, periodo)
				SELECT id, perfil_id, fecha, monto, moneda,
					CASE categoria WHEN 'Salario' THEN 'Ingreso Principal' ELSE categoria END,
					tipo, detalle, periodo
				FROM ingreso_old;
			DROP TABLE ingreso_old;
			COMMIT;
		`);
	}
	
	// Migración: si la tabla cotizacion_dolar no tiene columna 'casa', la recreamos.
	const cdcols = db.exec({ sql: 'PRAGMA table_info(cotizacion_dolar)', rowMode: 'object', returnValue: 'resultRows' });
	if (!cdcols.some((c: any) => c.name === 'casa')) {
		db.exec(`
			BEGIN;
			ALTER TABLE cotizacion_dolar RENAME TO cotizacion_dolar_old;
			CREATE TABLE cotizacion_dolar (
				id INTEGER PRIMARY KEY,
				perfil_id INTEGER NOT NULL REFERENCES perfil(id),
				casa TEXT NOT NULL DEFAULT 'bolsa',
				fecha TEXT NOT NULL,
				valor REAL NOT NULL CHECK (valor > 0),
				UNIQUE (perfil_id, casa, fecha)
			);
			INSERT INTO cotizacion_dolar (perfil_id, casa, fecha, valor)
				SELECT perfil_id, 'bolsa', fecha, valor FROM cotizacion_dolar_old;
			DROP TABLE cotizacion_dolar_old;
			COMMIT;
		`);
	}

	// Datos macro (dólar/inflación): públicos, fallback inicial. Solo si hay perfil.
	const rp = db.exec({ sql: 'SELECT COUNT(*) AS n FROM perfil', rowMode: 'object', returnValue: 'resultRows' });
	if (rp[0].n > 0) {
		const rm = db.exec({ sql: 'SELECT COUNT(*) AS n FROM cotizacion_dolar', rowMode: 'object', returnValue: 'resultRows' });
		if (rm[0].n === 0 && SEED_MACRO && SEED_MACRO.trim()) {
			db.exec(SEED_MACRO);
		}
	}
}

const ready = init();

self.onmessage = async (e: MessageEvent) => {
	const { id, sql, bind } = e.data;
	try {
		await ready;
		const rows = db.exec({ sql, bind, rowMode: 'object', returnValue: 'resultRows' });
		// Registrar última edición por módulo (después de ejecutar, si fue escritura)
		try { registrarEdicion(sql); } catch { /* no romper la query principal por esto */ }
		self.postMessage({ id, rows });
	} catch (err: any) {
		self.postMessage({ id, error: err?.message ?? String(err) });
	}
};
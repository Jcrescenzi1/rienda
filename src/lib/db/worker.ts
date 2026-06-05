import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { SCHEMA } from './schema';
import { SEED_MACRO } from './seed_macro';

let db: any = null;

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

	// NOTA: el perfil ya NO se crea acá. Lo crea la pantalla de bienvenida con el
	// nombre del usuario (ver src/lib/db/perfil.ts). Hasta que exista un perfil,
	// la app muestra la bienvenida.

	// Datos macro (dólar/inflación): públicos, sirven de fallback inicial hasta
	// que el usuario toque "Actualizar cotizaciones". Necesitan perfil_id=1, así que
	// solo se cargan si ya existe el perfil.
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
		self.postMessage({ id, rows });
	} catch (err: any) {
		self.postMessage({ id, error: err?.message ?? String(err) });
	}
};
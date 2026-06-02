import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { SCHEMA } from './schema';
import { SEED } from './seed';
import { SEED_GASTOS } from './seed_gastos';
import { SEED_INGRESOS } from './seed_ingresos';
import { SEED_MACRO } from './seed_macro';
import { SEED_INVERSIONES } from './seed_inversiones';
import { SEED_SNAPSHOTS } from './seed_snapshots';
import { SEED_LIQUIDEZ } from './seed_liquidez';

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

	const r = db.exec({ sql: 'SELECT COUNT(*) AS n FROM perfil', rowMode: 'object', returnValue: 'resultRows' });
	if (r[0].n === 0) {
		db.exec(SEED);
		db.exec(SEED_GASTOS);
	}

	const ri = db.exec({ sql: 'SELECT COUNT(*) AS n FROM ingreso', rowMode: 'object', returnValue: 'resultRows' });
	if (ri[0].n === 0) {
		db.exec(SEED_INGRESOS);
	}

	const rm = db.exec({ sql: 'SELECT COUNT(*) AS n FROM cotizacion_dolar', rowMode: 'object', returnValue: 'resultRows' });
	if (rm[0].n === 0) {
		db.exec(SEED_MACRO);
	}

	const rt = db.exec({ sql: 'SELECT COUNT(*) AS n FROM transaccion', rowMode: 'object', returnValue: 'resultRows' });
	if (rt[0].n === 0) {
		db.exec(SEED_INVERSIONES);
	}

	const rs = db.exec({ sql: 'SELECT COUNT(*) AS n FROM snapshot', rowMode: 'object', returnValue: 'resultRows' });
	if (rs[0].n === 0) {
		db.exec(SEED_SNAPSHOTS);
	}

	const rl = db.exec({ sql: 'SELECT COUNT(*) AS n FROM liquidez', rowMode: 'object', returnValue: 'resultRows' });
	if (rl[0].n === 0) {
		db.exec(SEED_LIQUIDEZ);
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
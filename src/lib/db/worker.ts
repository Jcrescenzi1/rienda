import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { SCHEMA } from './schema';
import { SEED } from './seed';
import { SEED_GASTOS } from './seed_gastos';
import { SEED_INGRESOS } from './seed_ingresos';
import { SEED_MACRO } from './seed_macro';
import { SEED_INVERSIONES } from './seed_inversiones';

let db: any = null;

async function init() {
	const sqlite3 = await sqlite3InitModule();
	const poolUtil = await sqlite3.installOpfsSAHPoolVfs({ name: 'rienda-pool' });
	db = new poolUtil.OpfsSAHPoolDb('/rienda.sqlite3');
	db.exec(SCHEMA);

	const cols = db.exec({ sql: 'PRAGMA table_info(ingreso)', rowMode: 'object', returnValue: 'resultRows' });
	if (!cols.some((c: any) => c.name === 'periodo')) {
		db.exec('ALTER TABLE ingreso ADD COLUMN periodo TEXT');
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
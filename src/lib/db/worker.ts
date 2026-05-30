import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { SCHEMA } from './schema';
import { SEED } from './seed';
import { SEED_GASTOS } from './seed_gastos';

let db: any = null;

async function init() {
	const sqlite3 = await sqlite3InitModule();
	const poolUtil = await sqlite3.installOpfsSAHPoolVfs({ name: 'rienda-pool' });
	db = new poolUtil.OpfsSAHPoolDb('/rienda.sqlite3');
	db.exec(SCHEMA);

	// Carga datos base + gastos historicos una sola vez (solo si el perfil no existe).
	const r = db.exec({
		sql: 'SELECT COUNT(*) AS n FROM perfil',
		rowMode: 'object',
		returnValue: 'resultRows'
	});
	if (r[0].n === 0) {
		db.exec(SEED);
		db.exec(SEED_GASTOS);
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
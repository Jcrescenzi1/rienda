// src/lib/db/backup.ts
// Exporta toda la base a un archivo JSON e importa de vuelta.
// Modelo: volcado completo + reemplazar todo.

import { query, queryBatch } from './client';
import { hoyISO } from '../format';
import { setMeta } from './meta';

// Tablas ordenadas de "padres" a "hijas" (segun foreign keys).
// meta va al final: no tiene dependencias.
const TABLAS = [
	'perfil',
	'categoria',
	'subcategoria',
	'mapeo_detalle',
	'tarjeta',
	'cuenta_inversion',
	'activo',
	'gasto',
	'ingreso',
	'ingreso_fijo',
	'suscripcion',
	'suscripcion_registro',
	'ingreso_fijo_registro',
	'transaccion',
	'inflacion',
	'cotizacion_dolar',
	'presupuesto',
	'reserva_credito',
	'snapshot',
	'liquidez',
	'mov_caja',
	'meta'
];

// ---------- SERIALIZAR (volcado completo en memoria) ----------
// Compartido por la exportacion descargable y por el auto-backup en OPFS.
export async function serializarBackup(): Promise<{ obj: any; json: string }> {
	const tablas: Record<string, any[]> = {};
	for (const t of TABLAS) {
		tablas[t] = await query(`SELECT * FROM ${t}`);
	}
	const obj = {
		app: 'rienda',
		version: 2,
		exportado_en: new Date().toISOString(),
		tablas
	};
	return { obj, json: JSON.stringify(obj, null, 2) };
}

// ---------- EXPORTAR ----------
export async function exportarDatos(): Promise<void> {
	const { json } = await serializarBackup();
	const blob = new Blob([json], { type: 'application/json' });
	const url = URL.createObjectURL(blob);

	const a = document.createElement('a');
	a.href = url;
	a.download = `rienda-backup-${hoyISO()}.json`;
	a.click();
	URL.revokeObjectURL(url);

	// Registra cuando se exporto (para el recordatorio de backup en el home)
	await setMeta('ultima_exportacion', new Date().toISOString());
}

// Tipo para la comparacion previa
export type FechasBackup = {
	valido: boolean;
	tieneMeta: boolean;
	edicion_finanzas: string | null;
	edicion_inversiones: string | null;
	exportado_en: string | null;
};

// ---------- LEER FECHAS DE UN BACKUP (sin importar) ----------
// Acepta un File (input) o un string JSON (auto-backups de OPFS).
export async function leerFechasBackup(src: File | string): Promise<{ backup: any; fechas: FechasBackup }> {
	const texto = typeof src === 'string' ? src : await src.text();
	let backup: any;
	try {
		backup = JSON.parse(texto);
	} catch {
		throw new Error('El archivo no es un JSON valido.');
	}
	if (backup?.app !== 'rienda' || !backup?.tablas) {
		throw new Error('El archivo no es un backup valido de Rienda.');
	}

	const metaRows: any[] = Array.isArray(backup.tablas.meta) ? backup.tablas.meta : [];
	const m: Record<string, string> = {};
	for (const r of metaRows) if (r?.clave) m[r.clave] = r.valor;

	const fechas: FechasBackup = {
		valido: true,
		tieneMeta: metaRows.length > 0,
		edicion_finanzas: m['ultima_edicion_finanzas'] ?? null,
		edicion_inversiones: m['ultima_edicion_inversiones'] ?? null,
		exportado_en: backup.exportado_en ?? null
	};

	return { backup, fechas };
}

// ---------- IMPORTAR ----------
// Acepta un backup ya parseado (de leerFechasBackup) o un File.
export async function importarDatos(fileOrBackup: File | any): Promise<void> {
	let backup: any;
	if (fileOrBackup instanceof File) {
		const texto = await fileOrBackup.text();
		try { backup = JSON.parse(texto); }
		catch { throw new Error('El archivo no es un JSON valido.'); }
	} else {
		backup = fileOrBackup;
	}

	if (backup?.app !== 'rienda' || !backup?.tablas) {
		throw new Error('El archivo no es un backup valido de Rienda.');
	}

	const tablas = backup.tablas as Record<string, any[]>;

	// Todo en UN lote atomico (un solo viaje al worker, transaccion incluida).
	// FK apagadas durante el import para tolerar backups viejos con huerfanos;
	// se reactivan siempre al final.
	const stmts: { sql: string; bind?: unknown[] }[] = [];
	for (const t of [...TABLAS].reverse()) {
		stmts.push({ sql: `DELETE FROM ${t}` }); // hijas primero
	}
	for (const t of TABLAS) {
		const filas = tablas[t];
		if (!Array.isArray(filas) || filas.length === 0) continue;
		for (const fila of filas) {
			const cols = Object.keys(fila);
			if (cols.length === 0) continue;
			const placeholders = cols.map(() => '?').join(', ');
			stmts.push({ sql: `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${placeholders})`, bind: cols.map((c) => fila[c]) });
		}
	}

	await query('PRAGMA foreign_keys=OFF');
	try {
		await queryBatch(stmts);
	} catch (err: any) {
		throw new Error('Fallo la importacion, no se modifico nada: ' + (err?.message ?? err));
	} finally {
		await query('PRAGMA foreign_keys=ON');
	}
}

// ---------- RESETEAR (borrado total / "factory reset") ----------
export async function resetearBase(): Promise<void> {
	const stmts: { sql: string }[] = [...TABLAS].reverse().map((t) => ({ sql: `DELETE FROM ${t}` }));
	const seq = (await query(
		`SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'`
	)) as any[];
	if (seq.length) stmts.push({ sql: 'DELETE FROM sqlite_sequence' });
	try {
		await queryBatch(stmts);
	} catch (err: any) {
		throw new Error('Fallo el borrado, no se modifico nada: ' + (err?.message ?? err));
	}
}

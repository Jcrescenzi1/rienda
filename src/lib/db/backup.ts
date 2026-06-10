// src/lib/db/backup.ts
// Exporta toda la base a un archivo JSON e importa de vuelta.
// Modelo: volcado completo + reemplazar todo.

import { query, queryBatch } from './client';
import { hoyISO } from '../format';
import { setMeta } from './meta';

// Tablas ordenadas de "padres" a "hijas" (según foreign keys).
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
	'suscripcion',
	'suscripcion_registro',
	'transaccion',
	'inflacion',
	'cotizacion_dolar',
	'presupuesto',
	'snapshot',
	'liquidez',
	'mov_caja',
	'meta'
];

// ---------- EXPORTAR ----------
export async function exportarDatos(): Promise<void> {
	const tablas: Record<string, any[]> = {};
	for (const t of TABLAS) {
		tablas[t] = await query(`SELECT * FROM ${t}`);
	}

	const backup = {
		app: 'rienda',
		version: 2,
		exportado_en: new Date().toISOString(),
		tablas
	};

	const json = JSON.stringify(backup, null, 2);
	const blob = new Blob([json], { type: 'application/json' });
	const url = URL.createObjectURL(blob);

	const fecha = hoyISO();
	const a = document.createElement('a');
	a.href = url;
	a.download = `rienda-backup-${fecha}.json`;
	a.click();
	URL.revokeObjectURL(url);

	// Registra cuándo se exportó (para el recordatorio de backup en el home)
	await setMeta('ultima_exportacion', new Date().toISOString());
}

// Tipo para la comparación previa
export type FechasBackup = {
	valido: boolean;
	tieneMeta: boolean;
	edicion_finanzas: string | null;
	edicion_inversiones: string | null;
	exportado_en: string | null;
};

// ---------- LEER FECHAS DE UN BACKUP (sin importar) ----------
// Sirve para la comparación previa: leer qué trae el archivo antes de pisar nada.
export async function leerFechasBackup(file: File): Promise<{ backup: any; fechas: FechasBackup }> {
	const texto = await file.text();
	let backup: any;
	try {
		backup = JSON.parse(texto);
	} catch {
		throw new Error('El archivo no es un JSON válido.');
	}
	if (backup?.app !== 'rienda' || !backup?.tablas) {
		throw new Error('El archivo no es un backup válido de Rienda.');
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
		catch { throw new Error('El archivo no es un JSON válido.'); }
	} else {
		backup = fileOrBackup;
	}

	if (backup?.app !== 'rienda' || !backup?.tablas) {
		throw new Error('El archivo no es un backup válido de Rienda.');
	}

	const tablas = backup.tablas as Record<string, any[]>;

	// Todo en UN lote atómico (un solo viaje al worker, transacción incluida).
	// FK apagadas durante el import para tolerar backups viejos con huérfanos;
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
		throw new Error('Falló la importación, no se modificó nada: ' + (err?.message ?? err));
	} finally {
		await query('PRAGMA foreign_keys=ON');
	}
}

// ---------- RESETEAR (borrado total / "factory reset") ----------
// Borra TODOS los datos del dispositivo y deja la base vacía.
// Reusa TABLAS para no desincronizarse nunca con el backup: si mañana agregás
// una tabla al export, el reset la contempla solo.
// Mismo patrón transaccional que importarDatos (borra hijas primero), por eso
// NO necesita tocar PRAGMA foreign_keys (que sería no-op dentro de la transacción).
export async function resetearBase(): Promise<void> {
	// Un solo lote atómico: borra hijas primero, igual que el import.
	const stmts: { sql: string }[] = [...TABLAS].reverse().map((t) => ({ sql: `DELETE FROM ${t}` }));
	// Reinicia los contadores AUTOINCREMENT para que arranque como recién instalada.
	// sqlite_sequence solo existe si hay alguna tabla con AUTOINCREMENT.
	const seq = (await query(
		`SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'`
	)) as any[];
	if (seq.length) stmts.push({ sql: 'DELETE FROM sqlite_sequence' });
	try {
		await queryBatch(stmts);
	} catch (err: any) {
		throw new Error('Falló el borrado, no se modificó nada: ' + (err?.message ?? err));
	}
}
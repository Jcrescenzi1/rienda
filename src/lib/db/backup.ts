// src/lib/db/backup.ts
// Exporta toda la base a un archivo JSON e importa de vuelta.
// Modelo: volcado completo + reemplazar todo.

import { query } from './client';

// Las 18 tablas, ordenadas de "padres" a "hijas" (según las foreign keys).
// El EXPORT usa este orden; el IMPORT inserta en este orden y borra en el inverso.
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
	'mov_caja'
];

// ---------- EXPORTAR ----------
export async function exportarDatos(): Promise<void> {
	const tablas: Record<string, any[]> = {};
	for (const t of TABLAS) {
		// SELECT * toma automáticamente columnas agregadas por ALTER (moneda_pago, etc.)
		tablas[t] = await query(`SELECT * FROM ${t}`);
	}

	const backup = {
		app: 'rienda',
		version: 1,
		exportado_en: new Date().toISOString(),
		tablas
	};

	const json = JSON.stringify(backup, null, 2);
	const blob = new Blob([json], { type: 'application/json' });
	const url = URL.createObjectURL(blob);

	const fecha = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
	const a = document.createElement('a');
	a.href = url;
	a.download = `rienda-backup-${fecha}.json`;
	a.click();
	URL.revokeObjectURL(url);
}

// ---------- IMPORTAR ----------
export async function importarDatos(file: File): Promise<void> {
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

	const tablas = backup.tablas as Record<string, any[]>;

	// Transacción manual: si algo falla, ROLLBACK deja la base intacta.
	await query('BEGIN');
	try {
		// Borrar en orden inverso (hijas primero) para no chocar con foreign keys.
		for (const t of [...TABLAS].reverse()) {
			await query(`DELETE FROM ${t}`);
		}

		// Insertar en orden directo (padres primero).
		for (const t of TABLAS) {
			const filas = tablas[t];
			if (!Array.isArray(filas) || filas.length === 0) continue;

			for (const fila of filas) {
				const cols = Object.keys(fila);
				if (cols.length === 0) continue;
				const placeholders = cols.map(() => '?').join(', ');
				const valores = cols.map((c) => fila[c]);
				const sql = `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${placeholders})`;
				await query(sql, valores);
			}
		}

		await query('COMMIT');
	} catch (err: any) {
		await query('ROLLBACK');
		throw new Error('Falló la importación, no se modificó nada: ' + (err?.message ?? err));
	}
}
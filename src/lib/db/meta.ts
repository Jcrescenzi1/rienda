// src/lib/db/meta.ts
// Lectura/escritura de los timestamps de actividad (tabla meta).

import { query } from './client';

export type Metadatos = {
	ultima_importacion: string | null;
	ultima_edicion_finanzas: string | null;
	ultima_edicion_inversiones: string | null;
	ultima_exportacion: string | null;
	// Blindaje iOS (Brief 2): resultado de la última corrida de crearAutobackup()
	// (diaria o previa a import/reset). autobackup_ultimo_error es un JSON
	// string { fecha, mensaje } o null si nunca falló (o nunca corrió).
	autobackup_ultimo_ok: string | null;
	autobackup_ultimo_error: string | null;
};

export async function leerMeta(): Promise<Metadatos> {
	const rows = (await query('SELECT clave, valor FROM meta')) as any[];
	const m: Record<string, string> = {};
	for (const r of rows) m[r.clave] = r.valor;
	return {
		ultima_importacion: m['ultima_importacion'] ?? null,
		ultima_edicion_finanzas: m['ultima_edicion_finanzas'] ?? null,
		ultima_edicion_inversiones: m['ultima_edicion_inversiones'] ?? null,
		ultima_exportacion: m['ultima_exportacion'] ?? null,
		autobackup_ultimo_ok: m['autobackup_ultimo_ok'] ?? null,
		autobackup_ultimo_error: m['autobackup_ultimo_error'] ?? null
	};
}

export async function setMeta(clave: string, valor: string): Promise<void> {
	await query(
		'INSERT INTO meta (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor',
		[clave, valor]
	);
}
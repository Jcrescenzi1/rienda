// src/lib/db/meta.ts
// Lectura/escritura de los timestamps de actividad (tabla meta).

import { query } from './client';

export type Metadatos = {
	ultima_importacion: string | null;
	ultima_edicion_finanzas: string | null;
	ultima_edicion_inversiones: string | null;
};

export async function leerMeta(): Promise<Metadatos> {
	const rows = (await query('SELECT clave, valor FROM meta')) as any[];
	const m: Record<string, string> = {};
	for (const r of rows) m[r.clave] = r.valor;
	return {
		ultima_importacion: m['ultima_importacion'] ?? null,
		ultima_edicion_finanzas: m['ultima_edicion_finanzas'] ?? null,
		ultima_edicion_inversiones: m['ultima_edicion_inversiones'] ?? null
	};
}

export async function setMeta(clave: string, valor: string): Promise<void> {
	await query(
		'INSERT INTO meta (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor',
		[clave, valor]
	);
}
// src/lib/db/autobackup.ts
// Copias automaticas rotativas en OPFS (mismo dispositivo). Red de seguridad
// ante operaciones que pisan datos (import-reemplaza, reset): se crea una copia
// ANTES de pisar y se guardan las ultimas 5 (FIFO).
//
// LIMITE EXPLICITO: estas copias viven en el mismo OPFS/dispositivo. NO protegen
// contra eviction del navegador, "limpiar datos de navegacion" ni perdida del
// equipo. Cubren solo el peor caso autoinfligido (pisar todo con import/reset).
// La durabilidad off-device es una decision de arquitectura aparte.

import { serializarBackup } from './backup';

const DIR = 'autobackups';
const MAX = 5;

async function carpeta(create = false): Promise<any> {
	const root: any = await (navigator as any).storage.getDirectory();
	return root.getDirectoryHandle(DIR, { create });
}

function sello(d = new Date()): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// 'rienda-autobackup-YYYYMMDD-HHmmss.json' -> 'YYYY-MM-DD HH:mm:ss'
function fechaLegible(nombre: string): string {
	const m = nombre.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
	if (!m) return nombre;
	const [, y, mo, d, h, mi, s] = m;
	return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

export type AutobackupItem = { nombre: string; fecha: string; size: number };

// Crea una copia y poda a las ultimas MAX. Best-effort: nunca tira la operacion.
export async function crearAutobackup(): Promise<void> {
	try {
		const { json } = await serializarBackup();
		const dir = await carpeta(true);
		const fh = await dir.getFileHandle(`rienda-autobackup-${sello()}.json`, { create: true });
		const w = await fh.createWritable();
		await w.write(json);
		await w.close();
		await podar(dir);
	} catch (e) {
		console.warn('[autobackup] no se pudo crear la copia automatica:', e);
	}
}

async function podar(dir: any): Promise<void> {
	const nombres: string[] = [];
	for await (const [nombre, h] of dir.entries()) {
		if (h.kind === 'file' && nombre.endsWith('.json')) nombres.push(nombre);
	}
	nombres.sort(); // ascendente por timestamp
	while (nombres.length > MAX) {
		const viejo = nombres.shift()!;
		try { await dir.removeEntry(viejo); } catch { /* ignore */ }
	}
}

export async function listarAutobackups(): Promise<AutobackupItem[]> {
	try {
		const dir = await carpeta(false);
		const items: AutobackupItem[] = [];
		for await (const [nombre, h] of dir.entries()) {
			if (h.kind !== 'file' || !nombre.endsWith('.json')) continue;
			const f = await h.getFile();
			items.push({ nombre, fecha: fechaLegible(nombre), size: f.size });
		}
		return items.sort((a, b) => b.nombre.localeCompare(a.nombre)); // mas nueva primero
	} catch {
		return [];
	}
}

export async function leerAutobackup(nombre: string): Promise<string> {
	const dir = await carpeta(false);
	const fh = await dir.getFileHandle(nombre);
	return (await fh.getFile()).text();
}

// src/lib/db/autobackup.ts
// Copias automaticas rotativas en OPFS (mismo dispositivo). Se crean ANTES de
// pisar datos (import-reemplaza, reset) y, desde Blindaje iOS (Brief 2), una
// vez por dia en el arranque si todavia no hay copia de hoy — se guardan las
// ultimas 7 (FIFO). Cada corrida registra su resultado en meta
// (autobackup_ultimo_ok / autobackup_ultimo_error, ver crearAutobackup()).
//
// LIMITE EXPLICITO: estas copias viven en el mismo OPFS/dispositivo. NO protegen
// contra eviction del navegador, "limpiar datos de navegacion" ni perdida del
// equipo. Cubren el peor caso autoinfligido (pisar todo con import/reset) y,
// con la copia diaria, la inactividad prolongada del usuario tipico. La
// durabilidad off-device es una decision de arquitectura aparte.

import { serializarBackup } from './backup';
import { leerMeta, setMeta } from './meta';
import { hoyISO } from '../format';

const DIR = 'autobackups';
// Blindaje iOS (Brief 2): 5→7. Con copias diarias sumadas a las previas a
// import/reset, 5 slots se llenaban en menos de una semana.
const MAX = 7;

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

// Crea una copia y poda a las ultimas MAX. Best-effort: nunca tira la operacion
// en curso. Registra el resultado en meta (Blindaje iOS, Brief 2): exito en
// autobackup_ultimo_ok, fallo en autobackup_ultimo_error (JSON con fecha y
// mensaje) — es la unica forma de enterarse si esto viene fallando en
// silencio, ya que antes solo quedaba un console.warn.
export async function crearAutobackup(): Promise<void> {
	try {
		const { json } = await serializarBackup();
		const dir = await carpeta(true);
		const fh = await dir.getFileHandle(`rienda-autobackup-${sello()}.json`, { create: true });
		const w = await fh.createWritable();
		await w.write(json);
		await w.close();
		await podar(dir);
		await setMeta('autobackup_ultimo_ok', new Date().toISOString());
	} catch (e) {
		console.warn('[autobackup] no se pudo crear la copia automatica:', e);
		try {
			await setMeta('autobackup_ultimo_error', JSON.stringify({
				fecha: new Date().toISOString(),
				mensaje: e instanceof Error ? e.message : String(e)
			}));
		} catch {
			/* setMeta tambien fallo (base inaccesible): no hay donde registrar el error */
		}
	}
}

// Copia diaria (Blindaje iOS, Brief 2): se llama en cada arranque con perfil
// cargado bien (ver +layout.svelte -> chequearPerfil()). Fire-and-forget, no
// bloquea la UI ni muestra nada. Compara solo la FECHA (YYYY-MM-DD) de
// autobackup_ultimo_ok contra hoy — la hora exacta no importa, alcanza con
// una copia por dia.
export async function autobackupDiarioSiHaceFalta(): Promise<void> {
	try {
		const meta = await leerMeta();
		if (meta.autobackup_ultimo_ok?.slice(0, 10) === hoyISO()) return; // ya hay copia de hoy
		await crearAutobackup();
	} catch (e) {
		console.warn('[autobackup] no se pudo chequear/crear la copia diaria:', e);
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

// src/lib/db/senales.ts
// Señales de diagnóstico de arranque (Blindaje iOS), leídas ANTES de abrir la
// base. Best-effort: cada función atrapa sus propios errores y nunca bloquea
// ni rompe el arranque si algo falla o no está soportado.

const CLAVE_MARCA = 'rienda_perfil_marca';
const POOL = 'rienda-pool';

export type SenalPool = { existe: boolean; archivos: number; bytes: number } | null;

// Lista el directorio del pool OPFS-SAHPool sin abrir la base. No busca
// 'rienda.sqlite3' por nombre: el pool usa nombres de archivo opacos.
export async function leerSenalPool(): Promise<SenalPool> {
	try {
		const root: any = await (navigator as any).storage.getDirectory();
		let dir: any;
		try {
			dir = await root.getDirectoryHandle(POOL, { create: false });
		} catch {
			return { existe: false, archivos: 0, bytes: 0 }; // el directorio no existe
		}
		let archivos = 0;
		let bytes = 0;
		for await (const [, h] of dir.entries()) {
			if (h.kind !== 'file') continue;
			archivos++;
			try {
				bytes += (await h.getFile()).size;
			} catch {
				/* un archivo puntual no se pudo leer: no aborta el conteo */
			}
		}
		return { existe: true, archivos, bytes };
	} catch (e) {
		console.warn('[senales] no se pudo leer el pool OPFS:', e);
		return null; // señal no concluyente (API no soportada, permiso denegado, etc.)
	}
}

export type MarcaPerfil = { creado_en: string; ultimo_arranque_ok: string };

export function leerMarcaPerfil(): MarcaPerfil | null {
	try {
		const raw = localStorage.getItem(CLAVE_MARCA);
		if (!raw) return null;
		const m = JSON.parse(raw);
		if (!m?.creado_en || !m?.ultimo_arranque_ok) return null;
		return m as MarcaPerfil;
	} catch {
		return null;
	}
}

// Se llama en crearPerfil() (fija creado_en) y en cada arranque con perfil
// presente (refresca ultimo_arranque_ok, preserva creado_en si ya existía).
// Para bases creadas antes de este cambio, la marca recién aparece en el
// primer arranque exitoso posterior.
export function escribirMarcaPerfil(): void {
	try {
		const previa = leerMarcaPerfil();
		const ahora = new Date().toISOString();
		const marca: MarcaPerfil = { creado_en: previa?.creado_en ?? ahora, ultimo_arranque_ok: ahora };
		localStorage.setItem(CLAVE_MARCA, JSON.stringify(marca));
	} catch (e) {
		console.warn('[senales] no se pudo escribir la marca de perfil:', e);
	}
}

export type EstadoStorage = { persistido: boolean | null; usage: number | null; quota: number | null };

// Formatea bytes a MB para mostrar (diagnóstico técnico y /datos). null = desconocido.
export function formatBytesMB(bytes: number | null): string {
	if (bytes === null) return 'desconocido';
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// persisted()/estimate(): modo de almacenamiento actual. null = no soportado.
export async function leerEstadoStorage(): Promise<EstadoStorage> {
	let persistido: boolean | null = null;
	let usage: number | null = null;
	let quota: number | null = null;
	try {
		persistido = (await (navigator as any).storage?.persisted?.()) ?? null;
	} catch {
		/* no soportado */
	}
	try {
		const est = await (navigator as any).storage?.estimate?.();
		usage = est?.usage ?? null;
		quota = est?.quota ?? null;
	} catch {
		/* no soportado */
	}
	return { persistido, usage, quota };
}

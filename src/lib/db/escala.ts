// src/lib/db/escala.ts
// Control de escala de precios (solo aviso). Un salto de más de 20x (o menos de
// 1/20) entre el precio que se está por escribir y el último conocido del activo
// casi siempre es un error de moneda/escala (ej. serie en pesos contra un activo
// en USD), no un movimiento real de mercado. Este módulo NO bloquea ni corrige
// nada: guarda igual y deja un aviso persistente que se muestra en el Centro de
// notificaciones hasta que el usuario lo descarta.
//
// Un único helper (controlarEscala) lo usan todos los caminos que escriben un
// precio: backfill (precios_historicos.ts), panel en vivo (precios.ts), edición
// manual en Tenencia en montos y carga de operación (ambas vía
// upsertPrecioHistorico). Los avisos viven en meta (JSON), tabla neutra: no
// marcan "cambios sin respaldar".

import { query } from './client';
import { setMeta } from './meta';

export const RATIO_ESCALA = 20;
const CLAVE_AVISOS = 'avisos_escala';
const CLAVE_DESCARTADOS = 'avisos_escala_descartados';
const MAX_DESCARTADOS = 300;

export type AvisoEscala = {
	clave: string; // `${activoId}|${fecha}`: un aviso por activo y fecha
	activoId: number;
	ticker: string;
	fecha: string;
	anterior: number;
	nuevo: number;
};

async function leerLista<T>(clave: string): Promise<T[]> {
	const r = (await query('SELECT valor FROM meta WHERE clave=?', [clave])) as any[];
	try {
		const v = JSON.parse(r[0]?.valor ?? '[]');
		return Array.isArray(v) ? v : [];
	} catch {
		return [];
	}
}

export async function leerAvisosEscala(): Promise<AvisoEscala[]> {
	return leerLista<AvisoEscala>(CLAVE_AVISOS);
}

export async function descartarAvisoEscala(clave: string): Promise<void> {
	const avisos = await leerLista<AvisoEscala>(CLAVE_AVISOS);
	await setMeta(CLAVE_AVISOS, JSON.stringify(avisos.filter((a) => a.clave !== clave)));
	// Se recuerda el descarte para que el refresco de 20 min no lo vuelva a levantar
	// el mismo día para el mismo activo.
	const desc = await leerLista<string>(CLAVE_DESCARTADOS);
	if (!desc.includes(clave)) {
		desc.push(clave);
		await setMeta(CLAVE_DESCARTADOS, JSON.stringify(desc.slice(-MAX_DESCARTADOS)));
	}
}

// Último precio conocido del activo, para comparar.
//  - con `antesDeFecha`: el último cierre guardado ANTERIOR a esa fecha; si no hay,
//    el precio_actual.
//  - sin fecha: precio_actual; si no hay, el último cierre guardado.
// null si no hay ninguna referencia.
export async function ultimoPrecioConocido(activoId: number, antesDeFecha?: string): Promise<number | null> {
	const ultimoHist = async (antes?: string): Promise<number | null> => {
		const r = (await query(
			antes
				? 'SELECT precio FROM precio_historico WHERE perfil_id=1 AND activo_id=? AND fecha<? ORDER BY fecha DESC LIMIT 1'
				: 'SELECT precio FROM precio_historico WHERE perfil_id=1 AND activo_id=? ORDER BY fecha DESC LIMIT 1',
			antes ? [activoId, antes] : [activoId]
		)) as any[];
		const p = Number(r[0]?.precio);
		return Number.isFinite(p) && p > 0 ? p : null;
	};
	const actual = async (): Promise<number | null> => {
		const r = (await query('SELECT precio_actual FROM activo WHERE id=? AND perfil_id=1', [activoId])) as any[];
		const p = Number(r[0]?.precio_actual);
		return Number.isFinite(p) && p > 0 ? p : null;
	};
	if (antesDeFecha) return (await ultimoHist(antesDeFecha)) ?? (await actual());
	return (await actual()) ?? (await ultimoHist());
}

// Compara `nuevo` contra el último precio conocido y, si la relación sale de
// [1/20, 20], registra el aviso. `previo` permite pasar la referencia ya resuelta
// (undefined = buscarla; null = no hay referencia, no se controla). Nunca lanza.
export async function controlarEscala(
	activoId: number,
	fecha: string,
	nuevo: number,
	previo?: number | null
): Promise<void> {
	try {
		if (!Number.isFinite(nuevo) || nuevo <= 0) return;
		const ref = previo !== undefined ? previo : await ultimoPrecioConocido(activoId, fecha);
		if (ref == null || !(ref > 0)) return;
		const ratio = nuevo / ref;
		if (ratio <= RATIO_ESCALA && ratio >= 1 / RATIO_ESCALA) return;

		const clave = `${activoId}|${fecha}`;
		const desc = await leerLista<string>(CLAVE_DESCARTADOS);
		if (desc.includes(clave)) return;

		const t = (await query('SELECT ticker FROM activo WHERE id=? AND perfil_id=1', [activoId])) as any[];
		const avisos = await leerLista<AvisoEscala>(CLAVE_AVISOS);
		const i = avisos.findIndex((a) => a.clave === clave);
		if (i >= 0) {
			// Mismo activo y fecha: se conserva el precio anterior original y se
			// actualiza el nuevo (el panel en vivo se refresca cada 20 min).
			if (avisos[i].nuevo === nuevo) return;
			avisos[i] = { ...avisos[i], nuevo };
		} else {
			avisos.push({ clave, activoId, ticker: t[0]?.ticker ?? String(activoId), fecha, anterior: ref, nuevo });
		}
		await setMeta(CLAVE_AVISOS, JSON.stringify(avisos));
	} catch (e) {
		console.warn('[escala] no se pudo registrar el aviso:', e);
	}
}

// Coherencia símbolo ↔ moneda (sufijo D = dólar MEP, C = CCL; ver especieDeTicker en
// precios.ts). Devuelve el texto del aviso o null si no hay nada que marcar. Solo
// informativo: hay tickers propios que terminan en D sin ser especie dólar.
export function avisoSimboloMoneda(simbolo: string | null | undefined, moneda: string): string | null {
	const s = (simbolo ?? '').trim().toUpperCase();
	if (!s) return null;
	const sufijoUSD = s.endsWith('D') || s.endsWith('C');
	if (moneda === 'USD' && !sufijoUSD)
		return `El símbolo ${s} no termina en D (dólar MEP) pero la moneda es USD: la cotización de data912 vendría en pesos.`;
	if (moneda !== 'USD' && s.endsWith('D'))
		return `El símbolo ${s} termina en D (especie dólar) pero la moneda es ARS. Si es un ticker propio (ej. AMD, YPFD), ignorá este aviso.`;
	return null;
}

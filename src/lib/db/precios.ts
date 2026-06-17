// src/lib/db/precios.ts
// Auto-actualización de precios de activos desde data912 (API pública y gratuita
// de mercado argentino). Para cada activo con `simbolo_cotizacion` configurado,
// busca su último precio y lo escribe en precio_actual. Best-effort: si la API
// falla o no hay internet, no rompe nada y se queda con los precios guardados.
//
// data912 expone paneles por tipo. Cada instrumento tiene 3 símbolos:
//   TICKER  -> precio en pesos        (ej. GD35)
//   TICKERD -> dólar MEP   (especie D, ej. GD35D)
//   TICKERC -> dólar CCL   (especie C, ej. GD35C)
// El campo de último precio es `c`. El sufijo del símbolo ya define la moneda,
// así que el usuario apunta cada activo al símbolo de la moneda que quiere.

import { query, queryBatch } from './client';
import { setMeta } from './meta';

// Si data912 bloqueara CORS, basta cambiar esta base por un proxy propio
// (p. ej. un Cloudflare Worker) sin tocar el resto.
const BASE = 'https://data912.com';
const PANELES = ['arg_bonds', 'arg_corp', 'arg_cedears', 'arg_stocks', 'arg_notes'];

// Bonos y ONs cotizan por cada 100 nominales; el resto por unidad. Esta función
// pasa el precio crudo a "precio por unidad" comparable con lo que registra la app.
export function ajustarEscala(px: number, tipo: string): number {
	return tipo === 'Bono' || tipo === 'ON' ? px / 100 : px;
}

// Baja todos los paneles y arma un mapa SÍMBOLO(upper) -> último precio (c > 0).
// fechaPrecio sale del header Last-Modified (la fecha del dato en la fuente, no
// nuestro momento de fetch); nos quedamos con la más reciente entre los paneles.
async function bajarMapaPrecios(): Promise<{ mapa: Record<string, number>; panelesOk: number; fechaPrecio: string | null }> {
	const mapa: Record<string, number> = {};
	const resultados = await Promise.allSettled(
		PANELES.map((p) =>
			fetch(`${BASE}/live/${p}`).then(async (r) => {
				if (!r.ok) throw new Error('HTTP ' + r.status);
				const lm = r.headers.get('last-modified');
				const data = await r.json();
				return { data, lm };
			})
		)
	);
	let panelesOk = 0;
	let fechaPrecio: string | null = null;
	for (const r of resultados) {
		if (r.status !== 'fulfilled' || !Array.isArray(r.value.data)) continue;
		panelesOk++;
		if (r.value.lm) {
			const d = new Date(r.value.lm);
			if (!isNaN(d.getTime())) {
				const iso = d.toISOString();
				if (!fechaPrecio || iso > fechaPrecio) fechaPrecio = iso;
			}
		}
		for (const fila of r.value.data) {
			const sym = String(fila?.symbol ?? '').trim().toUpperCase();
			const px = Number(fila?.c);
			if (sym && Number.isFinite(px) && px > 0) mapa[sym] = px;
		}
	}
	return { mapa, panelesOk, fechaPrecio };
}

// Actualiza los precios de los activos con símbolo configurado. Devuelve un
// resumen legible. Lanza error solo si no se pudo conectar con ningún panel.
export async function actualizarPrecios(): Promise<string> {
	const activos = (await query(
		"SELECT id, simbolo_cotizacion, tipo FROM activo WHERE perfil_id=1 AND simbolo_cotizacion IS NOT NULL AND TRIM(simbolo_cotizacion) <> ''"
	)) as any[];
	if (activos.length === 0) {
		throw new Error('No hay activos con símbolo configurado. Cargalos en "Configurar tickers".');
	}

	const { mapa, panelesOk, fechaPrecio } = await bajarMapaPrecios();
	if (panelesOk === 0) {
		throw new Error('No se pudo conectar con data912 (¿sin internet o bloqueo CORS?).');
	}

	// Sello de tiempo = la fecha del dato en la fuente (Last-Modified) si la hay;
	// si no, nuestro momento de actualización como fallback.
	const sello = fechaPrecio ?? new Date().toISOString();
	const stmts: { sql: string; bind?: unknown[] }[] = [];
	const sinMatch: string[] = [];
	for (const a of activos) {
		const sym = String(a.simbolo_cotizacion).trim().toUpperCase();
		const px = mapa[sym];
		if (px == null) { sinMatch.push(a.simbolo_cotizacion); continue; }
		stmts.push({
			sql: 'UPDATE activo SET precio_actual=?, precio_actualizado_en=? WHERE id=? AND perfil_id=1',
			bind: [ajustarEscala(px, a.tipo), sello, a.id]
		});
	}
	if (stmts.length) await queryBatch(stmts);
	await setMeta('precios_actualizados_en', sello);

	let msg = `Precios actualizados ✅ ${stmts.length}/${activos.length} activos`;
	if (sinMatch.length) msg += ` · sin coincidencia: ${sinMatch.join(', ')}`;
	if (panelesOk < PANELES.length) msg += ` · (${panelesOk}/${PANELES.length} paneles ok)`;
	return msg;
}

// Trae los precios actuales de data912 SIN escribir nada (para previsualizar en
// la pantalla de configuración de tickers). Devuelve símbolo(upper) -> precio.
export async function previsualizarPrecios(): Promise<Record<string, number>> {
	const { mapa } = await bajarMapaPrecios();
	return mapa;
}

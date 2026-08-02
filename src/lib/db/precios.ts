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
import { hoyISO } from '../format';
import { BASE, ajustarEscala } from './data912';
import { sqlUpsertPrecioHistorico } from './precios_historicos';
import { calcularFoto, guardarSnapshot } from '../cartera';

const PANELES = ['arg_bonds', 'arg_corp', 'arg_cedears', 'arg_stocks', 'arg_notes'];

// Reexportada por compatibilidad: config-tickers y otros ya podrían importar
// ajustarEscala desde acá. La fuente real ahora es data912.ts.
export { ajustarEscala };

// Hora local (del navegador) a partir de la cual se considera "mercado
// abierto". Antes de esa hora, el panel en vivo de data912 todavía devuelve
// el cierre de la sesión anterior (no hay operado nuevo todavía).
const HORA_APERTURA = 11;

// día hábil anterior a una fecha 'yyyy-mm-dd' (salta sábado/domingo; no
// contempla feriados). Determinístico: opera sobre las partes de la fecha
// dada, no sobre "ahora".
function diaHabilAnterior(iso: string): string {
	const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
	let t = Date.UTC(y, m - 1, d) - 86400000;
	while ([0, 6].includes(new Date(t).getUTCDay())) t -= 86400000;
	const dt = new Date(t);
	return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
}

// Fecha a la que corresponde el precio que devuelve el panel en vivo AHORA MISMO:
// antes de la apertura, ese precio es todavía el cierre del día hábil anterior
// (Bloque 2 — ventana pre-apertura); de ahí en más, es el día de hoy. La usan
// tanto actualizarPrecios (para fechar precio_historico) como el auto-guardado
// de la foto (para que ambos queden fechados igual).
export function fechaCierreActual(): string {
	return new Date().getHours() < HORA_APERTURA ? diaHabilAnterior(hoyISO()) : hoyISO();
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

// Actualiza los precios de los activos con símbolo configurado (precio_actual,
// como siempre) y, además, deja el cierre del día en precio_historico (Bloque 1)
// — con recalc condicional: si el precio no cambió respecto al ya guardado para
// esa fecha, no se reescribe (evita marcar "cambios sin respaldar" cada 20 min
// solo porque el precio no se movió; mismo patrón que el auto-presupuesto).
// Devuelve un resumen legible. Lanza error solo si no se pudo conectar con
// ningún panel.
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
	// Fecha de "cierre" a la que corresponde este precio (hoy, o el día hábil
	// anterior si es antes de la apertura — ver fechaCierreActual).
	const fechaCierre = fechaCierreActual();

	const matches: { id: number; tipo: string; precio: number }[] = [];
	const sinMatch: string[] = [];
	for (const a of activos) {
		const sym = String(a.simbolo_cotizacion).trim().toUpperCase();
		const px = mapa[sym];
		if (px == null) { sinMatch.push(a.simbolo_cotizacion); continue; }
		matches.push({ id: a.id, tipo: a.tipo, precio: ajustarEscala(px, a.tipo) });
	}

	// Precios ya guardados en precio_historico para la fecha de cierre, para el
	// guard de recalc condicional (una sola consulta, no una por activo).
	const yaGuardados = new Map<number, number>();
	if (matches.length) {
		const ids = matches.map((m) => m.id);
		const filas = (await query(
			`SELECT activo_id, precio FROM precio_historico WHERE perfil_id=1 AND fecha=? AND activo_id IN (${ids.map(() => '?').join(',')})`,
			[fechaCierre, ...ids]
		)) as any[];
		for (const f of filas) yaGuardados.set(f.activo_id, f.precio);
	}

	const stmts: { sql: string; bind?: unknown[] }[] = [];
	for (const m of matches) {
		// precio_actual: como siempre, se actualiza sin condición (no dirtea el
		// flag de backup — worker.ts lo excluye explícitamente).
		stmts.push({
			sql: 'UPDATE activo SET precio_actual=?, precio_actualizado_en=? WHERE id=? AND perfil_id=1',
			bind: [m.precio, sello, m.id]
		});
		// precio_historico: solo si cambió respecto a lo ya guardado para ese día.
		const previo = yaGuardados.get(m.id);
		if (previo == null || Math.abs(previo - m.precio) > 1e-9) {
			stmts.push({ sql: sqlUpsertPrecioHistorico('panel_vivo'), bind: [m.id, fechaCierre, m.precio, 'panel_vivo'] });
		}
	}
	if (stmts.length) await queryBatch(stmts);
	await setMeta('precios_actualizados_en', sello);

	let msg = `Precios actualizados ✅ ${matches.length}/${activos.length} activos`;
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

// Mapea cada panel de data912 a un `tipo` del schema de Rienda. Letras (arg_notes)
// y deuda corporativa (arg_corp) no tienen tipo propio en el enum de `activo`:
// se tratan como Bono y ON respectivamente (misma naturaleza de renta fija).
const PANEL_TIPO: Record<string, string> = {
	arg_bonds: 'Bono',
	arg_notes: 'Bono',
	arg_corp: 'ON',
	arg_cedears: 'CEDEAR',
	arg_stocks: 'Accion'
};

export type CatalogoItem = { simbolo: string; tipo: string; precio: number };

// Catálogo completo de instrumentos que devuelven los paneles en vivo de
// data912 (Bloque 7 — "Mercado"), con el tipo ya inferido por panel de origen,
// para que el usuario los busque y cargue sin tipear el ticker a mano. El
// nombre real NO viene en los paneles: el usuario lo sigue completando al
// cargar. Si un símbolo aparece en más de un panel, se queda con la primera
// aparición (orden de PANELES).
export async function listarCatalogoData912(): Promise<CatalogoItem[]> {
	const out: CatalogoItem[] = [];
	const vistos = new Set<string>();
	const resultados = await Promise.allSettled(
		PANELES.map((p) =>
			fetch(`${BASE}/live/${p}`).then((r) => {
				if (!r.ok) throw new Error('HTTP ' + r.status);
				return r.json();
			})
		)
	);
	PANELES.forEach((p, i) => {
		const r = resultados[i];
		if (r.status !== 'fulfilled' || !Array.isArray(r.value)) return;
		const tipo = PANEL_TIPO[p];
		for (const fila of r.value) {
			const sym = String(fila?.symbol ?? '').trim().toUpperCase();
			const px = Number(fila?.c);
			if (!sym || vistos.has(sym) || !Number.isFinite(px) || px <= 0) continue;
			vistos.add(sym);
			out.push({ simbolo: sym, tipo, precio: ajustarEscala(px, tipo) });
		}
	});
	return out.sort((a, b) => a.simbolo.localeCompare(b.simbolo));
}

// Bloque 2: la foto de cartera deja de ser una acción del usuario y pasa a ser
// consecuencia automática de actualizar precios. Se llama desde el auto-refresh
// (layout) y desde los botones manuales "Actualizar precios" (Tenencia Actual y
// Configurar tickers) — cualquier refresco exitoso, manual o automático, deja
// hecha la foto del día. Si actualizarPrecios falla (sin conexión), no se toca
// la foto. Recalc condicional también acá: si el valor calculado es igual al ya
// guardado para esa fecha, no se reescribe snapshot (mismo motivo que arriba —
// si no, la foto se "editaría" cada 20 min aunque no haya cambiado nada).
export async function actualizarPreciosYFoto(): Promise<string> {
	const mensaje = await actualizarPrecios();
	try {
		const fecha = fechaCierreActual();
		const foto = await calcularFoto();
		const existente = (await query(
			'SELECT valor_usd, flujo_usd, dolar, valor_ars FROM snapshot WHERE perfil_id=1 AND fecha=?',
			[fecha]
		)) as any[];
		const e = existente[0];
		const igual =
			e &&
			Math.abs(e.valor_usd - foto.valorUSD) < 0.005 &&
			Math.abs(e.flujo_usd - foto.flujo) < 0.005 &&
			Math.abs((e.dolar ?? 0) - foto.dolar) < 0.005 &&
			Math.abs((e.valor_ars ?? 0) - foto.valorARS) < 0.5;
		if (!igual) await guardarSnapshot(fecha, foto.valorUSD, foto.flujo, foto.dolar, foto.valorARS);
	} catch (e) {
		// No bloquea el resultado de actualizarPrecios (que sí funcionó): la foto
		// automática es un efecto secundario, no la operación principal.
		console.error('[precios] no se pudo guardar la foto automática de cartera:', e);
	}
	return mensaje;
}

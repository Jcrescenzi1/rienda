// src/lib/db/cotizaciones.ts
// Trae cotizaciones del dólar e índices de inflación desde ArgentinaDatos
// y los guarda en las tablas locales (reemplazando el histórico).

import { queryBatch } from './client';

const URL_DOLARES = 'https://api.argentinadatos.com/v1/cotizaciones/dolares';
const URL_INFLACION = 'https://api.argentinadatos.com/v1/finanzas/indices/inflacion';

// Casas que nos interesan. 'bolsa' es el MEP (referencia real); 'oficial' para el spread.
const CASAS = ['bolsa', 'oficial'];

export async function actualizarCotizaciones(): Promise<string> {
	// ===== 1) DÓLAR =====
	let datos: any[];
	try {
		const resp = await fetch(URL_DOLARES);
		if (!resp.ok) throw new Error('HTTP ' + resp.status);
		datos = await resp.json();
	} catch (e: any) {
		throw new Error('No se pudo conectar con la API de dólar: ' + (e?.message ?? e));
	}
	if (!Array.isArray(datos) || datos.length === 0) {
		throw new Error('La API de dólar no devolvió datos.');
	}

	const casasDisponibles = [...new Set(datos.map((d) => d.casa))].sort();
	console.log('[cotizaciones] Casas disponibles en la API:', casasDisponibles);

	const filtrados = datos.filter((d) => CASAS.includes(d.casa) && d.fecha && d.venta > 0);
	if (filtrados.length === 0) {
		throw new Error(
			'No se encontraron datos para las casas ' + CASAS.join(', ') +
			'. Casas disponibles: ' + casasDisponibles.join(', ')
		);
	}

	// ===== 2) INFLACIÓN =====
	let inflacion: any[];
	try {
		const resp = await fetch(URL_INFLACION);
		if (!resp.ok) throw new Error('HTTP ' + resp.status);
		inflacion = await resp.json();
	} catch (e: any) {
		throw new Error('No se pudo conectar con la API de inflación: ' + (e?.message ?? e));
	}
	// La API da fecha fin de mes (2025-09-30) y valor en % (2.1). Convertimos a
	// periodo 'YYYY-MM' y a decimal (2.1 -> 0.021) para respetar la convención local.
	const inflFiltrada = (Array.isArray(inflacion) ? inflacion : [])
		.filter((x) => x.fecha && typeof x.valor === 'number')
		.map((x) => ({ periodo: x.fecha.slice(0, 7), valor: x.valor / 100 }));

	// ===== 3) GUARDAR (reemplazo limpio, un solo lote atómico al worker) =====
	const stmts: { sql: string; bind?: unknown[] }[] = [];
	for (const casa of CASAS) {
		stmts.push({ sql: 'DELETE FROM cotizacion_dolar WHERE perfil_id=1 AND casa=?', bind: [casa] });
	}
	for (const d of filtrados) {
		stmts.push({
			sql: 'INSERT OR IGNORE INTO cotizacion_dolar (perfil_id, casa, fecha, valor) VALUES (1, ?, ?, ?)',
			bind: [d.casa, d.fecha, d.venta]
		});
	}
	stmts.push({ sql: 'DELETE FROM inflacion WHERE perfil_id=1' });
	for (const i of inflFiltrada) {
		stmts.push({
			sql: 'INSERT OR IGNORE INTO inflacion (perfil_id, periodo, valor) VALUES (1, ?, ?)',
			bind: [i.periodo, i.valor]
		});
	}
	try {
		await queryBatch(stmts);
	} catch (e: any) {
		throw new Error('Falló al guardar, no se modificó nada: ' + (e?.message ?? e));
	}

	const porCasa = CASAS.map((c) => `${c}: ${filtrados.filter((d) => d.casa === c).length}`).join(' · ');
	return `Actualizado ✅ Dólar (${porCasa}) · Inflación: ${inflFiltrada.length} meses`;
}
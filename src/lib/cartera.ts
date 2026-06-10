// src/lib/cartera.ts
// Cálculos compartidos entre Inversiones y Evolución: FIFO de lotes,
// ganancia realizada, liquidez y foto de cartera.
// UNA sola implementación para que las dos pantallas siempre den los mismos números.

import { query } from './db/client';

export type Lote = { u: number; pNat: number; pUSD: number };

// Convierte un monto a USD usando el valor dólar de la operación.
export const aUSD = (monto: number, moneda: string, valorDolar: number | null): number =>
	moneda === 'USD' ? monto : valorDolar ? monto / valorDolar : 0;

// Último dólar bolsa conocido.
export async function dolarActual(): Promise<number> {
	const r = (await query(
		"SELECT valor FROM cotizacion_dolar WHERE perfil_id=1 AND casa='bolsa' ORDER BY fecha DESC LIMIT 1"
	)) as any[];
	return r[0]?.valor ?? 1;
}

// Recorre todas las transacciones con método FIFO y devuelve:
//   lotes:      lo que queda en tenencia por activo (unidades + precio de compra)
//   realPorMes: ganancia realizada por mes (USD), calculada al vender
//   aMap:       mapa id -> activo (nombre, tipo, renta, moneda, precio_actual)
export async function calcularFIFO(): Promise<{
	lotes: Record<number, Lote[]>;
	realPorMes: Record<string, number>;
	aMap: Record<number, any>;
}> {
	const activos = (await query(
		'SELECT id, nombre, tipo, renta, moneda, precio_actual FROM activo WHERE perfil_id=1'
	)) as any[];
	const aMap: Record<number, any> = {};
	for (const a of activos) aMap[a.id] = a;

	const txs = (await query(
		'SELECT activo_id, operacion, unidades, precio, fecha, valor_dolar FROM transaccion WHERE perfil_id=1 ORDER BY activo_id, fecha, id'
	)) as any[];

	const lotes: Record<number, Lote[]> = {};
	const realPorMes: Record<string, number> = {};
	for (const t of txs) {
		const a = aMap[t.activo_id];
		lotes[t.activo_id] ??= [];
		if (t.operacion === 'Compra') {
			lotes[t.activo_id].push({ u: t.unidades, pNat: t.precio, pUSD: aUSD(t.precio, a.moneda, t.valor_dolar) });
		} else {
			let rem = t.unidades;
			const pvUSD = aUSD(t.precio, a.moneda, t.valor_dolar);
			const mes = t.fecha.slice(0, 7);
			const q = lotes[t.activo_id];
			while (rem > 1e-9 && q.length) {
				const lote = q[0];
				const take = Math.min(rem, lote.u);
				realPorMes[mes] = (realPorMes[mes] ?? 0) + take * (pvUSD - lote.pUSD);
				lote.u -= take;
				rem -= take;
				if (lote.u < 1e-9) q.shift();
			}
		}
	}
	return { lotes, realPorMes, aMap };
}

// Saldos líquidos por moneda: ancla manual (tabla liquidez) + movimientos de
// caja + efecto caja de compras/ventas (monto_pago de transaccion).
export async function calcularLiquidez(): Promise<Record<string, number>> {
	const anchor = (await query('SELECT moneda, saldo FROM liquidez WHERE perfil_id=1')) as any[];
	const movc = (await query(
		'SELECT moneda, COALESCE(SUM(monto),0) s FROM mov_caja WHERE perfil_id=1 GROUP BY moneda'
	)) as any[];
	const tcash = (await query(
		"SELECT moneda_pago m, COALESCE(SUM(CASE WHEN operacion='Venta' THEN monto_pago ELSE -monto_pago END),0) s FROM transaccion WHERE perfil_id=1 AND monto_pago IS NOT NULL GROUP BY moneda_pago"
	)) as any[];
	const bal: Record<string, number> = { ARS: 0, USD: 0 };
	for (const a of anchor) bal[a.moneda] = (bal[a.moneda] ?? 0) + a.saldo;
	for (const r of movc) bal[r.moneda] = (bal[r.moneda] ?? 0) + r.s;
	for (const r of tcash) if (r.m) bal[r.m] = (bal[r.m] ?? 0) + r.s;
	return bal;
}

// Valor total de la cartera en USD (tenencias a precio actual + liquidez) y
// flujo neto de Ingresos/Retiros desde la última foto. Base de "Guardar foto".
// Si un activo no tiene precio_actual, usa su PPC (precio promedio de compra).
export async function calcularFoto(): Promise<{
	dolar: number;
	valorUSD: number;
	valorARS: number;
	flujo: number;
}> {
	const dolar = await dolarActual();
	const { lotes, aMap } = await calcularFIFO();

	let valorUSD = 0;
	for (const [aid, q] of Object.entries(lotes)) {
		const u = q.reduce((s, l) => s + l.u, 0);
		if (u < 1e-6) continue;
		const a = aMap[Number(aid)];
		const costo = q.reduce((s, l) => s + l.u * l.pNat, 0);
		const pa = a.precio_actual ?? costo / u;
		const mercado = u * pa;
		valorUSD += a.moneda === 'USD' ? mercado : mercado / dolar;
	}

	const liq = await calcularLiquidez();
	valorUSD += (liq.USD ?? 0) + (liq.ARS ?? 0) / dolar;

	const ult = (await query('SELECT fecha FROM snapshot WHERE perfil_id=1 ORDER BY fecha DESC LIMIT 1')) as any[];
	const ultFecha = ult[0]?.fecha ?? '2000-01-01';
	const fl = (await query(
		"SELECT COALESCE(SUM(CASE WHEN moneda='USD' THEN monto ELSE monto/? END),0) AS f FROM mov_caja WHERE perfil_id=1 AND accion IN ('Ingreso','Retiro') AND fecha > ?",
		[dolar, ultFecha]
	)) as any[];
	const flujo = Math.round((fl[0]?.f ?? 0) * 100) / 100;

	return { dolar, valorUSD, valorARS: valorUSD * dolar, flujo };
}

// Inserta/actualiza la foto del día en snapshot (upsert por fecha).
export async function guardarSnapshot(
	fecha: string,
	valorUSD: number,
	flujo: number,
	dolar: number,
	valorARS: number
): Promise<void> {
	await query(
		'INSERT INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,?,?,?,?,?) ON CONFLICT(perfil_id,fecha) DO UPDATE SET valor_usd=excluded.valor_usd, flujo_usd=excluded.flujo_usd, dolar=excluded.dolar, valor_ars=excluded.valor_ars',
		[fecha, valorUSD, flujo, dolar, valorARS]
	);
}

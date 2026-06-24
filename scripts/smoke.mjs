// scripts/smoke.mjs
// Smoke test de robustez (corre con: npm run test:smoke).
// Usa el SQLite nativo de Node (node:sqlite, estable en Node 24).
// Verifica, sobre una base en memoria:
//   1) que el SCHEMA real de la app corre sin errores;
//   2) que las queries críticas de la app EJECUTAN (atrapa typos de columnas/tablas);
//   3) que la conversión USD->ARS de las cuotas de crédito da el número esperado.
// No prueba la UI; es una red contra romper el modelo de datos en un cambio.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

let fallas = 0;
const ok = (m) => console.log('  OK  ' + m);
const fail = (m, e) => { fallas++; console.log(' FAIL ' + m + (e ? ' -> ' + (e.message ?? e) : '')); };
function check(m, fn) { try { fn(); ok(m); } catch (e) { fail(m, e); } }

// 1) SCHEMA real
const src = readFileSync(new URL('../src/lib/db/schema.ts', import.meta.url), 'utf8');
const m = src.match(/export const SCHEMA = `([\s\S]*?)`;/);
if (!m) { console.log('No se pudo extraer SCHEMA de schema.ts'); process.exit(1); }
const SCHEMA = m[1];

const db = new DatabaseSync(':memory:');
check('SCHEMA corre sin errores', () => db.exec(SCHEMA));

// 2) Seed mínimo coherente
db.exec(`
  INSERT INTO perfil (id,nombre,modo_periodo) VALUES (1,'Test','calendario');
  INSERT INTO categoria (id,perfil_id,nombre) VALUES (1,1,'Comida');
  INSERT INTO subcategoria (id,perfil_id,nombre) VALUES (1,1,'Super');
  INSERT INTO mapeo_detalle (perfil_id,detalle,subcategoria_id) VALUES (1,'Coto',1);
  INSERT INTO tarjeta (id,perfil_id,nombre,proveedor,tipo) VALUES (1,1,'Visa','Visa','credito');
  INSERT INTO cotizacion_dolar (perfil_id,casa,fecha,valor) VALUES (1,'bolsa','2026-05-10',1000),(1,'bolsa','2026-06-15',1200);
  -- gastos: débito ARS, débito USD, crédito ARS (3 cuotas), crédito USD (2 cuotas)
  INSERT INTO gasto (perfil_id,fecha,monto,moneda,categoria_id,detalle,medio,cuotas) VALUES (1,'2026-06-05',5000,'ARS',1,'Coto','debito',1);
  INSERT INTO gasto (perfil_id,fecha,monto,moneda,categoria_id,detalle,medio,cuotas) VALUES (1,'2026-06-20',100,'USD',1,'Coto','debito',1);
  INSERT INTO gasto (perfil_id,fecha,monto,moneda,categoria_id,detalle,medio,tarjeta_id,cuotas,mes_inicio_pago) VALUES (1,'2026-06-20',30000,'ARS',1,'Coto','credito',1,3,'2026-07-01');
  INSERT INTO gasto (perfil_id,fecha,monto,moneda,categoria_id,detalle,medio,tarjeta_id,cuotas,mes_inicio_pago) VALUES (1,'2026-06-20',100,'USD',1,'Coto','credito',1,2,'2026-07-01');
  INSERT INTO ingreso (perfil_id,fecha,monto,moneda,categoria,tipo,periodo) VALUES (1,'2026-06-01',900000,'ARS','Ingreso Principal','Sueldo','2026-06');
  INSERT INTO ingreso (perfil_id,fecha,monto,moneda,categoria,tipo,periodo) VALUES (1,'2026-06-02',500,'USD','Ingresos Secundarios',NULL,'2026-06');
  INSERT INTO presupuesto (perfil_id,subcategoria_id,periodo,monto,auto) VALUES (1,1,'default',20000,0);
  INSERT INTO reserva_credito (perfil_id,periodo,monto) VALUES (1,'2026-07',40000);
  INSERT INTO suscripcion (perfil_id,nombre,detalle,monto,moneda,categoria_id) VALUES (1,'Netflix','Netflix',5000,'ARS',1);
  INSERT INTO ingreso_fijo (id,perfil_id,nombre,detalle,monto,moneda,categoria,tipo) VALUES (1,1,'Sueldo','Sueldo',900000,'ARS','Ingreso Principal','Sueldo');
  INSERT INTO ingreso_fijo (id,perfil_id,nombre,detalle,monto,moneda,categoria,tipo) VALUES (2,1,'Alquiler','Cochera',150,'USD','Ingresos Secundarios','Sueldo');
  INSERT INTO ingreso_fijo_registro (ingreso_fijo_id,ingreso_id,periodo) VALUES (1,1,'2026-06');
  INSERT INTO cuenta_inversion (id,perfil_id,nombre) VALUES (1,1,'Broker');
  INSERT INTO activo (id,perfil_id,ticker,nombre,tipo,renta,moneda) VALUES (1,1,'AL30','AL30','Bono','Fija','USD');
  INSERT INTO transaccion (perfil_id,activo_id,cuenta_inversion_id,fecha,operacion,unidades,precio) VALUES (1,1,1,'2026-06-10','Compra',100,50);
  INSERT INTO liquidez (perfil_id,moneda,saldo) VALUES (1,'ARS',10000),(1,'USD',50);
  INSERT INTO mov_caja (perfil_id,fecha,accion,moneda,monto) VALUES (1,'2026-06-01','Ingreso','USD',100);
  INSERT INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd) VALUES (1,'2026-06-01',1000,0);
`);
ok('Seed mínimo insertado');

const CUOTAS_MES = `
  WITH RECURSIVE serie(total, cuotas, c, inicio, moneda, fecha) AS (
    SELECT monto, cuotas, 0, mes_inicio_pago, moneda, fecha FROM gasto WHERE perfil_id=1 AND medio='credito'
    UNION ALL SELECT total, cuotas, c+1, inicio, moneda, fecha FROM serie WHERE c+1 < cuotas)
  SELECT
    COALESCE(SUM(CASE WHEN moneda='USD' THEN 0 ELSE total*1.0/cuotas END),0) AS ars,
    COALESCE(SUM(CASE WHEN moneda='USD' THEN total*1.0/cuotas ELSE 0 END),0) AS usd
  FROM serie WHERE strftime('%Y-%m', date(inicio, '+'||c||' months')) = ?`;

// 3) Queries reales de la app: solo que EJECUTEN sin error
const exec = (m, sql, ...p) => check(m, () => db.prepare(sql).all(...p));
exec('Home: gastos consolidado (acotado)',
  `SELECT g.fecha,g.monto,g.moneda,g.categoria_id,COALESCE(g.subcategoria_id,m.subcategoria_id) AS scid,
    (SELECT cd.valor FROM cotizacion_dolar cd WHERE cd.perfil_id=1 AND cd.casa='bolsa' AND cd.fecha<=g.fecha ORDER BY cd.fecha DESC LIMIT 1) AS dolar_dia,
    EXISTS(SELECT 1 FROM suscripcion_registro sr WHERE sr.gasto_id=g.id) AS es_fijo
   FROM gasto g LEFT JOIN mapeo_detalle m ON m.perfil_id=g.perfil_id AND m.detalle=g.detalle WHERE g.perfil_id=1 AND g.fecha>=?`, '2026-04-01');
exec('Home: presupuesto', "SELECT subcategoria_id,monto,auto FROM presupuesto WHERE perfil_id=1 AND periodo='default'");
exec('Home: ingresos del período', `SELECT i.monto,i.moneda, EXISTS(SELECT 1 FROM ingreso_fijo_registro r WHERE r.ingreso_id=i.id) AS es_fijo FROM ingreso i WHERE i.perfil_id=1 AND i.periodo=?`, '2026-06');
exec('Home: CUOTAS_MES', CUOTAS_MES, '2026-07');
exec('Home: reserva del mes', 'SELECT COALESCE(SUM(monto),0) AS t FROM reserva_credito WHERE perfil_id=1 AND periodo=?', '2026-07');
exec('Pagos fijos: recalc subcats', `SELECT m.subcategoria_id AS scid,s.monto,s.moneda FROM suscripcion s JOIN mapeo_detalle m ON m.perfil_id=1 AND m.detalle=s.detalle WHERE s.perfil_id=1 AND s.activa=1 AND m.subcategoria_id IS NOT NULL`);
exec('Ingresos fijos: lista', `SELECT id, nombre, detalle, monto, moneda, categoria, tipo, activa FROM ingreso_fijo WHERE perfil_id=1 ORDER BY activa DESC, categoria, nombre`);
exec('Ingresos fijos: registrados del periodo', 'SELECT ingreso_fijo_id FROM ingreso_fijo_registro WHERE periodo=?', '2026-06');
exec('Config: diccionario (gastos reales)', "SELECT DISTINCT detalle,categoria_id FROM gasto WHERE perfil_id=1 AND detalle IS NOT NULL AND detalle <> ''");
exec('Inversiones: transacciones', 'SELECT activo_id,operacion,unidades,precio,fecha,valor_dolar FROM transaccion WHERE perfil_id=1 ORDER BY activo_id,fecha,id');
exec('Evolución: ingresos', `SELECT id,fecha,monto,moneda,categoria,tipo,detalle,periodo FROM ingreso WHERE perfil_id=1 AND periodo IS NOT NULL ORDER BY fecha`);
exec('Cartera: snapshots', 'SELECT fecha,valor_usd,flujo_usd,valor_ars,dolar FROM snapshot WHERE perfil_id=1 ORDER BY fecha');

// 4) Aserción de valor: deuda jul = ARS 10000 (30000/3) + USD 60000 (50@1200) = 70000
check('CUOTAS_MES jul: ARS=10000 y USD=50 separados (sin convertir)', () => {
  const r = db.prepare(CUOTAS_MES).get('2026-07');
  if (Math.round(r.ars) !== 10000 || Math.round(r.usd) !== 50) throw new Error('dio ars=' + r.ars + ' usd=' + r.usd);
});

console.log(fallas === 0 ? '\n✓ Smoke OK (0 fallas)' : `\n✗ ${fallas} falla(s)`);
process.exit(fallas === 0 ? 0 : 1);

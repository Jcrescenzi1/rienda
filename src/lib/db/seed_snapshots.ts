// Snapshots mensuales de valuacion de cartera (historico). Valor y flujo en USD.
export const SEED_SNAPSHOTS = `
BEGIN;
INSERT OR IGNORE INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,'2024-08-31',1000.0,1000.0,950.5,950500.0);
INSERT OR IGNORE INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,'2024-09-30',2181.95,1041.82,968.5,2113221.14);
INSERT OR IGNORE INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,'2024-10-31',2427.4,58.53,990.0,2403127.4);
INSERT OR IGNORE INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,'2024-11-30',10135.23,6992.69,1010.0,10236582.7);
INSERT OR IGNORE INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,'2024-12-31',12109.01,679.61,1030.0,12472278.81);
INSERT OR IGNORE INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,'2025-01-31',11305.77,-447.95,1051.0,11882360.85);
INSERT OR IGNORE INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,'2025-02-28',11329.81,1217.74,1063.75,12052081.5);
INSERT OR IGNORE INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,'2025-03-31',13319.33,774.15,1073.125,14293301.46);
INSERT OR IGNORE INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,'2025-04-30',10097.61,-485.28,1172.75,11841972.39);
INSERT OR IGNORE INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,'2025-05-31',10288.51,-205.77,1189.0,12233036.22);
INSERT OR IGNORE INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,'2025-06-30',10852.82,650.86,1204.5,13072219.41);
INSERT OR IGNORE INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,'2025-07-31',11820.49,1036.82,1371.5,16211797.08);
INSERT OR IGNORE INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,'2025-08-31',11959.88,170.75,1347.0,16109955.98);
INSERT OR IGNORE INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,'2025-09-30',11657.43,0,1379.75,16084345.29);
INSERT OR IGNORE INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,'2025-10-31',12981.37,164.26,1446.25,18774307.15);
INSERT OR IGNORE INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,'2025-11-30',13580.29,170.98,1403.6812,19062399.93);
INSERT OR IGNORE INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,'2025-12-31',13558.15,238.67,1450.0,19659314.95);
INSERT OR IGNORE INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,'2026-01-31',13526.75,-61.6,1470.0,19884326.95);
INSERT OR IGNORE INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,'2026-02-28',12097.4,-1688.95,1400.0,16936364.4);
INSERT OR IGNORE INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,'2026-03-31',10928.34,-1108.49,1430.0,15627521.22);
INSERT OR IGNORE INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,'2026-04-30',11193.87,0,1413.0,15816939.46);
INSERT OR IGNORE INTO snapshot (perfil_id,fecha,valor_usd,flujo_usd,dolar,valor_ars) VALUES (1,'2026-05-31',11307.89,-29.4,1425.0,16113747.86);
COMMIT;
`;
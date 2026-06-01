// Liquidez inicial = valor real de tus fondos money-market al cierre de may-2026
export const SEED_LIQUIDEZ = `
BEGIN;
INSERT OR IGNORE INTO liquidez (perfil_id,moneda,saldo,actualizado_en) VALUES (1,'ARS',954611.31,'2026-05-31');
INSERT OR IGNORE INTO liquidez (perfil_id,moneda,saldo,actualizado_en) VALUES (1,'USD',1981.29,'2026-05-31');
COMMIT;
`;
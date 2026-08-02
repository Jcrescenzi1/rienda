// Define las 14 tablas de Rienda. Se ejecuta una sola vez al iniciar.
// "IF NOT EXISTS" hace que sea seguro correrlo muchas veces sin romper nada.

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS perfil (
  id            INTEGER PRIMARY KEY,
  nombre        TEXT NOT NULL,
  modo_periodo  TEXT NOT NULL DEFAULT 'sueldo',
  creado_en     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categoria (
  id          INTEGER PRIMARY KEY,
  perfil_id   INTEGER NOT NULL REFERENCES perfil(id),
  nombre      TEXT NOT NULL,
  activa      INTEGER NOT NULL DEFAULT 1,
  es_ahorro   INTEGER NOT NULL DEFAULT 0 CHECK (es_ahorro IN (0,1)),
  UNIQUE (perfil_id, nombre)
);

CREATE TABLE IF NOT EXISTS subcategoria (
  id          INTEGER PRIMARY KEY,
  perfil_id   INTEGER NOT NULL REFERENCES perfil(id),
  nombre      TEXT NOT NULL,
  activa      INTEGER NOT NULL DEFAULT 1,
  UNIQUE (perfil_id, nombre)
);

CREATE TABLE IF NOT EXISTS mapeo_detalle (
  id              INTEGER PRIMARY KEY,
  perfil_id       INTEGER NOT NULL REFERENCES perfil(id),
  detalle         TEXT NOT NULL,
  subcategoria_id INTEGER NOT NULL REFERENCES subcategoria(id),
  UNIQUE (perfil_id, detalle)
);

CREATE TABLE IF NOT EXISTS tarjeta (
  id          INTEGER PRIMARY KEY,
  perfil_id   INTEGER NOT NULL REFERENCES perfil(id),
  nombre      TEXT NOT NULL,
  proveedor   TEXT CHECK (proveedor IN ('Visa','Mastercard','Amex')),
  tipo        TEXT NOT NULL CHECK (tipo IN ('debito','credito')),
  activa      INTEGER NOT NULL DEFAULT 1,
  UNIQUE (perfil_id, nombre)
);

CREATE TABLE IF NOT EXISTS gasto (
  id                INTEGER PRIMARY KEY,
  perfil_id         INTEGER NOT NULL REFERENCES perfil(id),
  fecha             TEXT NOT NULL,
  monto             REAL NOT NULL CHECK (monto > 0),
  moneda            TEXT NOT NULL CHECK (moneda IN ('ARS','USD')),
  categoria_id      INTEGER NOT NULL REFERENCES categoria(id),
  detalle           TEXT NOT NULL,
  subcategoria_id   INTEGER REFERENCES subcategoria(id),
  medio             TEXT NOT NULL CHECK (medio IN ('debito','credito')),
  tarjeta_id        INTEGER REFERENCES tarjeta(id),
  cuotas            INTEGER NOT NULL DEFAULT 1 CHECK (cuotas >= 1),
  mes_inicio_pago   TEXT,
  CHECK (
    (medio = 'debito'  AND tarjeta_id IS NULL AND cuotas = 1 AND mes_inicio_pago IS NULL)
    OR
    (medio = 'credito' AND tarjeta_id IS NOT NULL AND mes_inicio_pago IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS ingreso (
  id          INTEGER PRIMARY KEY,
  perfil_id   INTEGER NOT NULL REFERENCES perfil(id),
  fecha       TEXT NOT NULL,
  monto       REAL NOT NULL CHECK (monto > 0),
  moneda      TEXT NOT NULL CHECK (moneda IN ('ARS','USD')),
  categoria   TEXT NOT NULL CHECK (categoria IN ('Ingreso Principal','Ingresos Secundarios','Otros','Desahorro')),
  tipo        TEXT CHECK (tipo IN ('Sueldo','Aciclico')),
  detalle     TEXT,
  periodo     TEXT
);

CREATE TABLE IF NOT EXISTS suscripcion (
  id              INTEGER PRIMARY KEY,
  perfil_id       INTEGER NOT NULL REFERENCES perfil(id),
  nombre          TEXT NOT NULL,
  detalle         TEXT,
  monto           REAL NOT NULL CHECK (monto > 0),
  moneda          TEXT NOT NULL CHECK (moneda IN ('ARS','USD')),
  categoria_id    INTEGER NOT NULL REFERENCES categoria(id),
  tarjeta_id      INTEGER REFERENCES tarjeta(id),
  activa          INTEGER NOT NULL DEFAULT 1,
  -- Día esperado de pago. Es el MISMO entero en los dos modos de período, solo
  -- cambia cómo se lee: en 'calendario' es el día del mes (1-31); en 'sueldo' es
  -- la posición dentro del período (1 = día de cobro, 2 = el siguiente, ...).
  -- NULL = sin especificar (ordena al final de la lista). No se convierte al
  -- cambiar de modo: los valores viejos quedan como están.
  dia_esperado    INTEGER CHECK (dia_esperado IS NULL OR dia_esperado BETWEEN 1 AND 31)
);

CREATE TABLE IF NOT EXISTS suscripcion_registro (
  id              INTEGER PRIMARY KEY,
  suscripcion_id  INTEGER NOT NULL REFERENCES suscripcion(id),
  gasto_id        INTEGER NOT NULL REFERENCES gasto(id),
  periodo         TEXT NOT NULL,
  UNIQUE (suscripcion_id, periodo)
);

-- Ingresos fijos: espejo de los gastos fijos (suscripcion) para el lado del
-- ingreso. Plantilla mensual; "Registrar Ingreso" crea un ingreso real del mes.
CREATE TABLE IF NOT EXISTS ingreso_fijo (
  id          INTEGER PRIMARY KEY,
  perfil_id   INTEGER NOT NULL REFERENCES perfil(id),
  nombre      TEXT NOT NULL,
  detalle     TEXT,
  monto       REAL NOT NULL CHECK (monto > 0),
  moneda      TEXT NOT NULL CHECK (moneda IN ('ARS','USD')),
  categoria   TEXT NOT NULL CHECK (categoria IN ('Ingreso Principal','Ingresos Secundarios','Otros')),
  tipo        TEXT NOT NULL DEFAULT 'Sueldo' CHECK (tipo IN ('Sueldo','Aciclico')),
  activa      INTEGER NOT NULL DEFAULT 1,
  -- Día esperado de cobro. Misma semántica que suscripcion.dia_esperado.
  dia_esperado INTEGER CHECK (dia_esperado IS NULL OR dia_esperado BETWEEN 1 AND 31)
);

-- Marca qué ingreso fijo ya se registró en qué período (evita duplicar el mes).
CREATE TABLE IF NOT EXISTS ingreso_fijo_registro (
  id               INTEGER PRIMARY KEY,
  ingreso_fijo_id  INTEGER NOT NULL REFERENCES ingreso_fijo(id),
  ingreso_id       INTEGER NOT NULL REFERENCES ingreso(id),
  periodo          TEXT NOT NULL,
  UNIQUE (ingreso_fijo_id, periodo)
);

CREATE TABLE IF NOT EXISTS cuenta_inversion (
  id          INTEGER PRIMARY KEY,
  perfil_id   INTEGER NOT NULL REFERENCES perfil(id),
  nombre      TEXT NOT NULL,
  tipo        TEXT,
  activa      INTEGER NOT NULL DEFAULT 1,
  UNIQUE (perfil_id, nombre)
);

CREATE TABLE IF NOT EXISTS activo (
  id                    INTEGER PRIMARY KEY,
  perfil_id             INTEGER NOT NULL REFERENCES perfil(id),
  ticker                TEXT NOT NULL,
  nombre                TEXT NOT NULL,
  tipo                  TEXT NOT NULL CHECK (tipo IN ('Bono','ON','FCI','Accion','CEDEAR','Indice')),
  renta                 TEXT NOT NULL CHECK (renta IN ('Fija','Mixta','Variable','Liquido')),
  moneda                TEXT NOT NULL CHECK (moneda IN ('ARS','USD')),
  precio_actual         REAL,
  precio_actualizado_en TEXT,
  activo                INTEGER NOT NULL DEFAULT 1,
  -- Exposición al tipo de cambio (a qué FX está atado el valor del activo), NO su
  -- moneda de cotización: un CEDEAR o una ON dollar-linked cotizan en ARS pero su
  -- exposición es 'Dolar'. Lo fija el usuario en Configurar tickers; default por regla.
  exposicion            TEXT CHECK (exposicion IS NULL OR exposicion IN ('Dolar','CER','Peso')),
  UNIQUE (perfil_id, ticker)
);

-- Precio de cierre de un activo en una fecha (una fila por activo por día).
-- Reemplaza el modelo de "precio_actual" que se pisa: con esto la historia no
-- se pierde y corregir un movimiento viejo puede recalcular hacia atrás.
-- origen: de dónde salió el dato, en orden de prioridad al completarlo
-- ('data912' = histórico de mercado, 'panel_vivo' = logueado del panel en vivo
-- ese día, 'transaccion' = precio de la propia operación del usuario, 'manual'
-- = corrección a mano en Tenencia en montos). Upsert por (perfil,activo,fecha):
-- si se vuelve a escribir el mismo día, gana el último valor grabado.
CREATE TABLE IF NOT EXISTS precio_historico (
  id          INTEGER PRIMARY KEY,
  perfil_id   INTEGER NOT NULL REFERENCES perfil(id),
  activo_id   INTEGER NOT NULL REFERENCES activo(id),
  fecha       TEXT NOT NULL,
  precio      REAL NOT NULL CHECK (precio > 0),
  origen      TEXT NOT NULL CHECK (origen IN ('data912','panel_vivo','transaccion','manual')),
  UNIQUE (perfil_id, activo_id, fecha)
);

CREATE TABLE IF NOT EXISTS transaccion (
  id                   INTEGER PRIMARY KEY,
  perfil_id            INTEGER NOT NULL REFERENCES perfil(id),
  activo_id            INTEGER NOT NULL REFERENCES activo(id),
  cuenta_inversion_id  INTEGER NOT NULL REFERENCES cuenta_inversion(id),
  fecha                TEXT NOT NULL,
  operacion            TEXT NOT NULL CHECK (operacion IN ('Compra','Venta')),
  unidades             REAL NOT NULL CHECK (unidades > 0),
  precio               REAL NOT NULL CHECK (precio > 0),
  valor_dolar          REAL
);

-- Renta (cupón) y amortización (devolución de capital) cobradas por un activo.
-- NO entra a transaccion (no mueve unidades ni FIFO): tabla aparte, atada al
-- activo. Sus montos se suman al numerador del PPV de la posición abierta y su
-- cash entra a liquidez. valor_dolar = TC congelado del movimiento (patrón de
-- transaccion), para la conversión a la lente USD.
CREATE TABLE IF NOT EXISTS renta_activo (
  id           INTEGER PRIMARY KEY,
  perfil_id    INTEGER NOT NULL REFERENCES perfil(id),
  activo_id    INTEGER NOT NULL REFERENCES activo(id),
  fecha        TEXT NOT NULL,
  moneda       TEXT NOT NULL CHECK (moneda IN ('ARS','USD')),
  monto_renta  REAL NOT NULL DEFAULT 0 CHECK (monto_renta >= 0),
  monto_amort  REAL NOT NULL DEFAULT 0 CHECK (monto_amort >= 0),
  valor_dolar  REAL
);

CREATE TABLE IF NOT EXISTS inflacion (
  id          INTEGER PRIMARY KEY,
  perfil_id   INTEGER NOT NULL REFERENCES perfil(id),
  periodo     TEXT NOT NULL,
  valor       REAL NOT NULL,
  UNIQUE (perfil_id, periodo)
);

CREATE TABLE IF NOT EXISTS cotizacion_dolar (
  id          INTEGER PRIMARY KEY,
  perfil_id   INTEGER NOT NULL REFERENCES perfil(id),
  casa        TEXT NOT NULL DEFAULT 'bolsa',
  fecha       TEXT NOT NULL,
  valor       REAL NOT NULL CHECK (valor > 0),
  UNIQUE (perfil_id, casa, fecha)
);

CREATE TABLE IF NOT EXISTS presupuesto (
  id              INTEGER PRIMARY KEY,
  perfil_id       INTEGER NOT NULL REFERENCES perfil(id),
  subcategoria_id INTEGER NOT NULL REFERENCES subcategoria(id),
  periodo         TEXT NOT NULL DEFAULT 'default',
  monto           REAL NOT NULL CHECK (monto >= 0),
  auto            INTEGER NOT NULL DEFAULT 0,
  UNIQUE (perfil_id, subcategoria_id, periodo)
);

-- Reserva de crédito: plata que el usuario aparta en un mes para pagar el
-- vencimiento de tarjetas de ESE mes. Netea el "Ingreso disponible para gasto".
-- Una fila por (perfil, período). Vacío = 0.
CREATE TABLE IF NOT EXISTS reserva_credito (
  id              INTEGER PRIMARY KEY,
  perfil_id       INTEGER NOT NULL REFERENCES perfil(id),
  periodo         TEXT NOT NULL,
  monto           REAL NOT NULL DEFAULT 0 CHECK (monto >= 0),
  UNIQUE (perfil_id, periodo)
);

CREATE TABLE IF NOT EXISTS snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  perfil_id INTEGER NOT NULL REFERENCES perfil(id),
  fecha TEXT NOT NULL,
  valor_usd REAL NOT NULL,
  flujo_usd REAL NOT NULL DEFAULT 0,
  dolar REAL,
  valor_ars REAL,
  UNIQUE(perfil_id, fecha)
);

CREATE TABLE IF NOT EXISTS liquidez (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  perfil_id INTEGER NOT NULL REFERENCES perfil(id),
  moneda TEXT NOT NULL CHECK(moneda IN ('ARS','USD')),
  saldo REAL NOT NULL DEFAULT 0,
  actualizado_en TEXT,
  UNIQUE(perfil_id, moneda)
);

CREATE TABLE IF NOT EXISTS mov_caja (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  perfil_id INTEGER NOT NULL REFERENCES perfil(id),
  fecha TEXT NOT NULL,
  accion TEXT NOT NULL,
  moneda TEXT NOT NULL CHECK(moneda IN ('ARS','USD')),
  monto REAL NOT NULL,
  grupo TEXT,
  nota TEXT
);

CREATE TABLE IF NOT EXISTS meta (
  clave TEXT PRIMARY KEY,
  valor TEXT
);

-- Recurrentes por vencer que el usuario YA vio en el centro de notificaciones, por
-- (recurrente, período). Marca "avisá una vez": prenden el badge hasta que se entra
-- al centro; ahí se marcan vistos y se apagan del badge (siguen en la lista). tipo:
-- 'pago' = suscripcion, 'cobro' = ingreso_fijo; ref_id = id de ese recurrente.
CREATE TABLE IF NOT EXISTS notif_visto (
  id          INTEGER PRIMARY KEY,
  perfil_id   INTEGER NOT NULL REFERENCES perfil(id),
  tipo        TEXT NOT NULL CHECK (tipo IN ('pago','cobro')),
  ref_id      INTEGER NOT NULL,
  periodo     TEXT NOT NULL,
  UNIQUE (perfil_id, tipo, ref_id, periodo)
);

-- Índices para que las consultas frecuentes no recorran tablas enteras
-- cuando haya años de datos. IF NOT EXISTS: seguro para bases existentes.
CREATE INDEX IF NOT EXISTS idx_gasto_fecha       ON gasto(perfil_id, fecha);
CREATE INDEX IF NOT EXISTS idx_gasto_detalle     ON gasto(perfil_id, detalle);
CREATE INDEX IF NOT EXISTS idx_tx_activo         ON transaccion(perfil_id, activo_id, fecha);
CREATE INDEX IF NOT EXISTS idx_renta_activo      ON renta_activo(perfil_id, activo_id);
CREATE INDEX IF NOT EXISTS idx_preciohist_activo ON precio_historico(perfil_id, activo_id, fecha);
CREATE INDEX IF NOT EXISTS idx_ingreso_periodo   ON ingreso(perfil_id, periodo);
CREATE INDEX IF NOT EXISTS idx_screg_periodo     ON suscripcion_registro(periodo);
-- Por gasto_id / ingreso_id: soportan los EXISTS por fila de la Home (recurrente
-- vs puntual) y los DELETE atómicos de registros de fijos (gastos/ingresos).
CREATE INDEX IF NOT EXISTS idx_screg_gasto       ON suscripcion_registro(gasto_id);
CREATE INDEX IF NOT EXISTS idx_ifreg_ingreso     ON ingreso_fijo_registro(ingreso_id);
`;
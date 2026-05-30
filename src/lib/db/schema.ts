// Define las 14 tablas de Rienda. Se ejecuta una sola vez al iniciar.
// "IF NOT EXISTS" hace que sea seguro correrlo muchas veces sin romper nada.

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS perfil (
  id          INTEGER PRIMARY KEY,
  nombre      TEXT NOT NULL,
  creado_en   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categoria (
  id          INTEGER PRIMARY KEY,
  perfil_id   INTEGER NOT NULL REFERENCES perfil(id),
  nombre      TEXT NOT NULL,
  activa      INTEGER NOT NULL DEFAULT 1,
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
  categoria   TEXT NOT NULL CHECK (categoria IN ('Salario','Otros')),
  tipo        TEXT CHECK (tipo IN ('Sueldo','Aciclico')),
  detalle     TEXT,
  periodo     TEXT,
  CHECK (
    (categoria = 'Salario' AND tipo IS NOT NULL)
    OR
    (categoria = 'Otros' AND tipo IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS suscripcion (
  id              INTEGER PRIMARY KEY,
  perfil_id       INTEGER NOT NULL REFERENCES perfil(id),
  nombre          TEXT NOT NULL,
  monto           REAL NOT NULL CHECK (monto > 0),
  moneda          TEXT NOT NULL CHECK (moneda IN ('ARS','USD')),
  categoria_id    INTEGER NOT NULL REFERENCES categoria(id),
  tarjeta_id      INTEGER REFERENCES tarjeta(id),
  activa          INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS suscripcion_registro (
  id              INTEGER PRIMARY KEY,
  suscripcion_id  INTEGER NOT NULL REFERENCES suscripcion(id),
  gasto_id        INTEGER NOT NULL REFERENCES gasto(id),
  periodo         TEXT NOT NULL,
  UNIQUE (suscripcion_id, periodo)
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
  UNIQUE (perfil_id, ticker)
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
  fecha       TEXT NOT NULL,
  valor       REAL NOT NULL CHECK (valor > 0),
  UNIQUE (perfil_id, fecha)
);

CREATE TABLE IF NOT EXISTS presupuesto (
  id              INTEGER PRIMARY KEY,
  perfil_id       INTEGER NOT NULL REFERENCES perfil(id),
  subcategoria_id INTEGER NOT NULL REFERENCES subcategoria(id),
  periodo         TEXT NOT NULL DEFAULT 'default',
  monto           REAL NOT NULL CHECK (monto >= 0),
  UNIQUE (perfil_id, subcategoria_id, periodo)
);

`;
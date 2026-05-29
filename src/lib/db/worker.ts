// Este archivo corre en un "hilo aparte" (Web Worker).
// Acá vive el motor SQLite y el archivo de la base de datos.
// La pantalla le manda consultas por mensajes y él responde.

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { SCHEMA } from './schema';

let db: any = null;

async function init() {
  const sqlite3 = await sqlite3InitModule();
  // SAHPool: guarda la base en OPFS (archivo privado del navegador), sin headers especiales.
  const poolUtil = await sqlite3.installOpfsSAHPoolVfs({ name: 'rienda-pool' });
  db = new poolUtil.OpfsSAHPoolDb('/rienda.sqlite3');
  // Crea las 14 tablas si no existen todavía.
  db.exec(SCHEMA);
}

// Inicializa apenas arranca el worker y avisa cuando está listo.
const ready = init();

// Escucha los mensajes que llegan desde la pantalla.
self.onmessage = async (e: MessageEvent) => {
  const { id, sql, bind } = e.data;
  try {
    await ready;
    const rows = db.exec({
      sql,
      bind,
      rowMode: 'object',
      returnValue: 'resultRows'
    });
    self.postMessage({ id, rows });
  } catch (err: any) {
    self.postMessage({ id, error: err?.message ?? String(err) });
  }
};
// Este archivo es el "puente" entre tu pantalla y el worker.
// Le pedís consultas con query(...) y te devuelve los resultados.

let worker: Worker | null = null;
let nextId = 0;
const pendientes = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const { id, rows, error } = e.data;
      const p = pendientes.get(id);
      if (!p) return;
      pendientes.delete(id);
      if (error) p.reject(new Error(error));
      else p.resolve(rows);
    };
  }
  return worker;
}

// Ejecuta una consulta SQL y devuelve las filas como objetos.
export function query(sql: string, bind: unknown[] = []): Promise<any[]> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pendientes.set(id, { resolve, reject });
    getWorker().postMessage({ id, sql, bind });
  });
}
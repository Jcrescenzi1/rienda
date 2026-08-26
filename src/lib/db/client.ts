// Este archivo es el "puente" entre tu pantalla y el worker.
// Le pedís consultas con query(...) y te devuelve los resultados.

let worker: Worker | null = null;
let nextId = 0;
const pendientes = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();

// Si el worker no contesta en este tiempo, asumimos que quedó colgado (encolado
// detrás de un `await ready` que nunca resuelve, por ejemplo) y lo descartamos
// en vez de dejar la pantalla esperando para siempre sin error ni aviso.
const TIMEOUT_MS = 15000;

// Rechaza TODAS las consultas pendientes (no solo la que venció el timeout: si
// el worker quedó colgado, cualquier otra query encolada detrás de la misma
// nunca va a recibir respuesta tampoco) y descarta el worker roto. La próxima
// query dispara uno nuevo desde cero.
function romperWorker(motivo: string) {
  const err = new Error(motivo);
  for (const p of pendientes.values()) p.reject(err);
  pendientes.clear();
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

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

// Liberación proactiva del worker en background sostenido. El VFS OPFS-SAHPool
// que usa worker.ts exige lock exclusivo (una sola instancia puede tenerlo
// abierto a la vez): si el sistema operativo congela o mata la pestaña
// mientras el worker sigue "vivo" con el lock tomado, la próxima apertura se
// cuelga esperando ese lock — es la causa de fondo del banner de error
// global. Soltarlo nosotros mismos antes de que eso pase reduce la ventana en
// la que puede ocurrir. Se usa `visibilitychange` (confiable en mobile) y NO
// `pagehide` (no dispara en el escenario real de background + kill, según
// MDN). Con debounce: no actúa en cambios de pantalla cortos (chequear otra
// app, notificación) — solo en background sostenido de 5s+, que es donde el
// SO puede llegar a evaluar descartar la pestaña. Si hay una query en vuelo
// en ese momento se la deja terminar tranquila (no se fuerza el corte): es un
// caso raro y cortarla a la fuerza generaría un error visible falso apenas se
// vuelva a foreground; en el peor caso, si el SO igual mata la pestaña con
// esa query en curso, el timeout de 15s y el banner ya cubren esa red.
if (typeof document !== 'undefined') {
  let backgroundTimer: ReturnType<typeof setTimeout> | null = null;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      backgroundTimer = setTimeout(() => {
        if (worker && pendientes.size === 0) {
          worker.terminate();
          worker = null;
        }
      }, 5000);
    } else if (backgroundTimer) {
      clearTimeout(backgroundTimer);
      backgroundTimer = null;
    }
  });
}

// Registra una promesa pendiente con watchdog: si nadie la resuelve/rechaza
// dentro de TIMEOUT_MS, se corta el worker y se avisa con un error claro.
function encolarConTimeout(
  id: number,
  resolve: (v: any) => void,
  reject: (e: any) => void
) {
  const timer = setTimeout(() => {
    romperWorker('La base no respondió a tiempo. Cerrá la app por completo y volvé a abrirla.');
  }, TIMEOUT_MS);
  pendientes.set(id, {
    resolve: (v: any) => { clearTimeout(timer); resolve(v); },
    reject: (e: any) => { clearTimeout(timer); reject(e); }
  });
}

// Ejecuta una consulta SQL y devuelve las filas como objetos.
export function query(sql: string, bind: unknown[] = []): Promise<any[]> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    encolarConTimeout(id, resolve, reject);
    getWorker().postMessage({ id, sql, bind });
  });
}

// Ejecuta MUCHAS sentencias en un solo viaje al worker, dentro de una
// transacción atómica (o entra todo o nada). Para operaciones masivas:
// importar backup, resetear base, actualizar cotizaciones.
export function queryBatch(stmts: { sql: string; bind?: unknown[] }[]): Promise<void> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    encolarConTimeout(id, resolve, reject);
    getWorker().postMessage({ id, batch: stmts });
  });
}

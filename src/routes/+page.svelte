<script lang="ts">
    import { onMount } from 'svelte';
    import { query } from '$lib/db/client';
    import { addMonths, cargarModo, cargarCortes, crearAsignador, type ModoPeriodo } from '$lib/periodo';
    import { mesActual, parseNum, formatNum, soloNum } from '$lib/format';
    import { dolarActual } from '$lib/cartera';
    import { leerMeta, setMeta } from '$lib/db/meta';
    import Guia from '$lib/Guia.svelte';

    let periodo = $state(mesActual());
    let grupos = $state<any[]>([]);
    let consolidado = $state<any[]>([]);
    let totales = $state<any>({ n2: 0, n1: 0, presup: 0, real: 0 });
    // Reserva para tarjetas: suma de cuotas de crédito que vencen en el mes
    // visible. Solo suma al total de PRESUPUESTO (los gastos en crédito ya
    // fueron contados como gasto real el día que se cargaron).
    let creditoMes = $state(0);
    // Ingresos principales del período visible (USD convertido al dólar actual)
    let ingresosPpalMes = $state(0);
    // Aviso de backup: null = no mostrar; -1 = nunca exportó; >0 = días sin exportar
    let avisoBackup = $state<number | null>(null);
    // Checklist de primeros pasos (null = oculto o completo)
    let pasos = $state<{ categorias: boolean; tarjeta: boolean; gasto: boolean; ingreso: boolean } | null>(null);
    let rango = $state('');
    let modo = $state<ModoPeriodo>('sueldo');
    let cargando = $state(true);

    // Etiquetas de mes para los encabezados (derivadas del período visible)
    let labN = $state(''); let labN1 = $state(''); let labN2 = $state('');

    const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    // '2026-06' -> "jun '26". Parsea el string directo (sin new Date(), evita corrimiento UTC-3).
    function labelMes(periodo: string): string {
        const [y, m] = periodo.split('-').map(Number);
        return `${MESES[m - 1]} '${String(y).slice(2)}`;
    }

    function desvio(real: number, presup: number): string {
        if (!presup) return '—';
        if (real <= presup) return 'En margen';
        if (real <= presup * 1.25) return 'Superado';
        return 'Muy superado';
    }

    async function cargar() {
        cargando = true;

        modo = await cargarModo();
        const cortes = modo === 'sueldo' ? await cargarCortes() : [];
        const asignar = crearAsignador(modo, cortes);

        const n = periodo;
        const n1 = addMonths(periodo, -1);
        const n2 = addMonths(periodo, -2);
        const objetivo = new Set([n, n1, n2]);

        // Etiquetas de los encabezados
        labN = labelMes(n);
        labN1 = labelMes(n1);
        labN2 = labelMes(n2);

        // Rango de fechas del período visible
        if (modo === 'calendario') {
            rango = `mes calendario ${n}`;
        } else {
            const idx = cortes.findIndex((c) => c.periodo === n);
            if (idx >= 0) {
                const ini = cortes[idx].fecha;
                const fin = idx + 1 < cortes.length ? cortes[idx + 1].fecha : 'hoy';
                rango = `${ini} al ${fin === 'hoy' ? 'hoy' : fin}`;
            } else rango = '(sin sueldo cargado para este período)';
        }

        // Traigo TODOS los gastos con subcategoria efectiva y los asigno a período en JS
        const gastos = (await query(
            `SELECT g.fecha, g.monto, g.categoria_id,
                    COALESCE(g.subcategoria_id, m.subcategoria_id) AS scid
             FROM gasto g
             LEFT JOIN mapeo_detalle m ON m.perfil_id = g.perfil_id AND m.detalle = g.detalle
             WHERE g.perfil_id = 1`
        )) as any[];

        // categoría habitual por subcategoría
        const hab = (await query(
            `SELECT scid, categoria_id, COUNT(*) AS c FROM (
               SELECT COALESCE(g.subcategoria_id, m.subcategoria_id) AS scid, g.categoria_id
               FROM gasto g LEFT JOIN mapeo_detalle m ON m.perfil_id=g.perfil_id AND m.detalle=g.detalle
               WHERE g.perfil_id=1
             ) GROUP BY scid, categoria_id`
        )) as any[];

        const homeCat: Record<string, number | null> = {};
        const bestC: Record<string, number> = {};
        for (const h of hab) {
            const k = h.scid == null ? 'null' : String(h.scid);
            if (bestC[k] === undefined || h.c > bestC[k]) { bestC[k] = h.c; homeCat[k] = h.categoria_id; }
        }

        const subs = (await query('SELECT id, nombre FROM subcategoria WHERE perfil_id=1 AND activa=1')) as any[];
        const nombreSub: Record<number, string> = {};
        for (const s of subs) nombreSub[s.id] = s.nombre;
        const cats = (await query('SELECT id, nombre FROM categoria WHERE perfil_id=1')) as any[];
        const nombreCat: Record<number, string> = {};
        for (const c of cats) nombreCat[c.id] = c.nombre;
        const presup = (await query("SELECT subcategoria_id, monto FROM presupuesto WHERE perfil_id=1 AND periodo='default'")) as any[];
        const presupMap: Record<number, number> = {};
        for (const p of presup) presupMap[p.subcategoria_id] = p.monto;

        // Acumular por subcategoría, solo para los 3 períodos objetivo
        const key = (id: any) => (id == null ? 'null' : String(id));
        const acc: Record<string, any> = {};

        for (const g of gastos) {
            const per = asignar(g.fecha);
            if (!per || !objetivo.has(per)) continue;
            const k = key(g.scid);
            acc[k] ??= { scid: g.scid, n2: 0, n1: 0, real: 0 };
            if (per === n2) acc[k].n2 += g.monto;
            else if (per === n1) acc[k].n1 += g.monto;
            else if (per === n) acc[k].real += g.monto;
        }

        for (const p of presup) {
            const k = key(p.subcategoria_id);
            acc[k] ??= { scid: p.subcategoria_id, n2: 0, n1: 0, real: 0 };
        }

        const filas = Object.values(acc).map((a: any) => {
            const presupVal = a.scid != null ? presupMap[a.scid] ?? 0 : 0;
            const catId = homeCat[key(a.scid)];
            return {
                scid: a.scid,
                nombre: a.scid == null ? '(sin subcategoría)' : nombreSub[a.scid] ?? '?',
                catNombre: catId != null ? nombreCat[catId] ?? '(sin categoría)' : '(sin categoría)',
                n2: a.n2, n1: a.n1, presup: presupVal, real: a.real,
                estado: desvio(a.real, presupVal)
            };
        });

        const map: Record<string, any[]> = {};
        for (const f of filas) (map[f.catNombre] ??= []).push(f);
        const gr = Object.keys(map).sort((a, b) => a.localeCompare(b, 'es')).map((cat) => {
            const rows = map[cat].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
            const sub = rows.reduce((t, r) => ({ n2: t.n2 + r.n2, n1: t.n1 + r.n1, presup: t.presup + r.presup, real: t.real + r.real }), { n2: 0, n1: 0, presup: 0, real: 0 });
            return { cat, rows, sub };
        });

        // Cuotas de tarjetas que vencen en el mes visible (misma serie que Vista de crédito)
        const cred = (await query(
            `WITH RECURSIVE serie(total, cuotas, n, inicio) AS (
                SELECT monto, cuotas, 0, mes_inicio_pago
                FROM gasto WHERE perfil_id=1 AND medio='credito'
                UNION ALL
                SELECT total, cuotas, n+1, inicio FROM serie WHERE n+1 < cuotas
            )
            SELECT COALESCE(SUM(total*1.0/cuotas),0) AS t
            FROM serie WHERE strftime('%Y-%m', date(inicio, '+'||n||' months')) = ?`,
            [n]
        )) as any[];
        creditoMes = cred[0]?.t ?? 0;

        // Bloque virtual "Crédito", intercalado alfabéticamente entre las categorías
        if (creditoMes > 0) {
            gr.push({ cat: 'Crédito', esCredito: true, rows: [], sub: { n2: 0, n1: 0, presup: creditoMes, real: 0 } } as any);
            gr.sort((a, b) => a.cat.localeCompare(b.cat, 'es'));
        }

        grupos = gr;
        consolidado = gr.map((g: any) => ({ cat: g.cat, esCredito: g.esCredito ?? false, ...g.sub, estado: g.esCredito ? '' : desvio(g.sub.real, g.sub.presup) }));
        totales = filas.reduce((t, r) => ({ n2: t.n2 + r.n2, n1: t.n1 + r.n1, presup: t.presup + r.presup, real: t.real + r.real }), { n2: 0, n1: 0, presup: 0, real: 0 });
        totales.presup += creditoMes; // la reserva de crédito solo engrosa el presupuesto

        // Tarjeta "Ingresos principales" del período visible, en ARS.
        // Los ingresos en USD se convierten al dólar del día de cobro (la última
        // cotización conocida hasta esa fecha); si no hay ninguna, al más reciente.
        const dolarUltimo = await dolarActual();
        const ing = (await query(
            `SELECT i.monto, i.moneda,
                    (SELECT c.valor FROM cotizacion_dolar c
                     WHERE c.perfil_id=1 AND c.casa='bolsa' AND c.fecha <= i.fecha
                     ORDER BY c.fecha DESC LIMIT 1) AS dolar_dia
             FROM ingreso i
             WHERE i.perfil_id=1 AND i.categoria='Ingreso Principal' AND i.periodo=?`,
            [n]
        )) as any[];
        ingresosPpalMes = ing.reduce(
            (s, r) => s + (r.moneda === 'USD' ? r.monto * (r.dolar_dia ?? dolarUltimo) : r.monto),
            0
        );

        cargando = false;
    }

    async function guardarPresup(scid: number, valor: string) {
        // Campo vacío = presupuesto 0 (comportamiento histórico de "borrar" el valor)
        const monto = valor.trim() === '' ? 0 : parseNum(valor);
        if (scid == null || !Number.isFinite(monto) || monto < 0) return;
        await query("INSERT INTO presupuesto (perfil_id, subcategoria_id, periodo, monto) VALUES (1, ?, 'default', ?) ON CONFLICT(perfil_id, subcategoria_id, periodo) DO UPDATE SET monto = excluded.monto", [scid, monto]);
        await cargar();
    }

    // ===== Aviso de backup (>30 días sin exportar, con ediciones pendientes) =====
    async function chequearBackup() {
        const m = await leerMeta();
        const ahora = new Date().toISOString();
        if (m.backup_aviso_hasta && m.backup_aviso_hasta > ahora) return; // silenciado
        const ultEdicion = [m.ultima_edicion_finanzas, m.ultima_edicion_inversiones]
            .filter(Boolean).sort().pop() ?? null;
        if (!ultEdicion) return; // sin datos cargados, nada que respaldar
        if (!m.ultima_exportacion) {
            // "Nunca exportaste" recién aparece tras la primera semana de uso:
            // un perfil recién creado no necesita que lo apuren con backups.
            const r = (await query('SELECT creado_en FROM perfil WHERE id=1')) as any[];
            const creado = r[0]?.creado_en ? new Date(r[0].creado_en.replace(' ', 'T') + 'Z').getTime() : Date.now();
            if (Date.now() - creado > 7 * 86400000) avisoBackup = -1;
            return;
        }
        if (m.ultima_exportacion >= ultEdicion) return; // todo respaldado
        const dias = Math.floor((Date.now() - new Date(m.ultima_exportacion).getTime()) / 86400000);
        if (dias > 30) avisoBackup = dias;
    }

    async function exportarAhora() {
        const { exportarDatos } = await import('$lib/db/backup');
        await exportarDatos();
        avisoBackup = null;
    }

    async function backupMasTarde() {
        // Silencia el aviso por 7 días
        await setMeta('backup_aviso_hasta', new Date(Date.now() + 7 * 86400000).toISOString());
        avisoBackup = null;
    }

    // ===== Checklist de primeros pasos =====
    async function cargarPasos() {
        const oculto = (await query("SELECT valor FROM meta WHERE clave='primeros_pasos_oculto'")) as any[];
        if (oculto.length) return;
        const catVisto = (await query("SELECT valor FROM meta WHERE clave='paso_categorias'")) as any[];
        const ng = (await query('SELECT COUNT(*) AS n FROM gasto WHERE perfil_id=1')) as any[];
        const ni = (await query('SELECT COUNT(*) AS n FROM ingreso WHERE perfil_id=1')) as any[];
        const nt = (await query('SELECT COUNT(*) AS n FROM tarjeta WHERE perfil_id=1')) as any[];
        const p = { categorias: catVisto.length > 0, tarjeta: nt[0].n > 0, gasto: ng[0].n > 0, ingreso: ni[0].n > 0 };
        if (p.categorias && p.tarjeta && p.gasto && p.ingreso) return; // todo hecho: no molestar
        pasos = p;
    }

    async function ocultarPasos() {
        await setMeta('primeros_pasos_oculto', '1');
        pasos = null;
    }

    onMount(() => { cargar(); chequearBackup(); cargarPasos(); });
    const peso = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-AR');
    const claseEstado = (e: string) => e === 'En margen' ? 'ok' : e === 'Superado' ? 'warn' : e === 'Muy superado' ? 'bad' : 'none';
</script>

<div class="titulo-guia">
    <h1>Gastos y Presupuesto</h1>
    <Guia clave="home" texto="Tu día a día: cuánto gastaste este período, en qué, y cómo venís contra tu presupuesto. Las dos primeras columnas muestran los meses anteriores para comparar. Tocá el casillero de Presupuesto de cualquier subcategoría para fijar un monto." />
</div>

{#if pasos}
    <div class="pasos">
        <div class="pasos-top">
            <strong>Cómo aprovechar la app al máximo</strong>
            <button class="pasos-cerrar" onclick={ocultarPasos} title="Ocultar" aria-label="Ocultar">✕</button>
        </div>
        <a href="/configuracion" class:hecho={pasos.categorias} onclick={() => setMeta('paso_categorias', '1')}>{pasos.categorias ? '✓' : '①'} Revisá y ajustá tus categorías</a>
        <a href="/configuracion" class:hecho={pasos.tarjeta}>{pasos.tarjeta ? '✓' : '②'} Si usás crédito, cargá tus tarjetas</a>
        <a href="/gastos" class:hecho={pasos.gasto}>{pasos.gasto ? '✓' : '③'} Cargá tu primer gasto</a>
        <a href="/carga-ingresos" class:hecho={pasos.ingreso}>{pasos.ingreso ? '✓' : '④'} Cargá tu primer ingreso</a>
    </div>
{/if}

{#if avisoBackup !== null}
    <div class="aviso-backup">
        <span>{avisoBackup === -1 ? 'Nunca creaste una copia de seguridad de tus datos.' : `Hace ${avisoBackup} días que no creás una copia de seguridad.`} Tus datos viven solo en este dispositivo.</span>
        <span class="aviso-acc">
            <button onclick={exportarAhora}>Crear copia ahora</button>
            <button class="sec" onclick={backupMasTarde}>Más tarde</button>
        </span>
    </div>
{/if}

<div class="accesos">
    <a href="/gastos" class="btn-carga">➕ Cargar gasto</a>
    <a href="/gastos-evolucion" class="btn-carga sec">📈 Evolución de Gastos</a>
    <a href="/credito" class="btn-carga sec">Gastos en Crédito</a>
    <a href="/suscripciones" class="btn-carga sec">Ver Suscripciones</a>
</div>

<label class="sel">{modo === 'calendario' ? 'Mes' : 'Período de sueldo'}: <input type="month" bind:value={periodo} onchange={cargar} /></label>
<p class="rango">
    {#if modo === 'calendario'}
        Gastos del <strong>{rango}</strong> (mes calendario, del 1 al último día).
    {:else}
        Gastos del <strong>{rango}</strong> (el período lo abre la fecha real de tu sueldo).
    {/if}
</p>

{#if cargando}
    <p>Cargando…</p>
{:else}
    <div class="resumen">
        <div class="card"><span>Ingresos principales</span><strong>{peso(ingresosPpalMes)}</strong></div>
        <!-- Semáforo: el presupuesto se compara contra los ingresos principales del período -->
        <div class="card" class:ok={ingresosPpalMes > 0 && totales.presup <= ingresosPpalMes} class:bad={ingresosPpalMes > 0 && totales.presup > ingresosPpalMes}
            title={ingresosPpalMes > 0 ? (totales.presup <= ingresosPpalMes ? 'Tu presupuesto entra en tus ingresos principales' : 'Tu presupuesto supera tus ingresos principales') : 'Sin ingresos principales cargados este período'}>
            <span>Presupuesto</span><strong>{peso(totales.presup)}</strong>
        </div>
        <div class="card" class:ok={totales.real <= totales.presup} class:bad={totales.real > totales.presup}>
            <span>Gasto total</span><strong>{peso(totales.real)}</strong>
        </div>
    </div>

    <h2>Consolidado por categoría</h2>
    <table>
        <thead><tr><th>Categoría</th><th>{labN2}</th><th>{labN1}</th><th>Presup.</th><th>{labN}</th></tr></thead>
        <tbody>
            {#each consolidado as c (c.cat)}
                {#if c.esCredito}
                    <tr>
                        <td title="Se calcula automáticamente con tus gastos cargados en crédito"><strong>Crédito</strong> <span class="auto">· automático</span></td>
                        <td class="num">—</td><td class="num">—</td>
                        <td class="num">{peso(c.presup)}</td>
                        <td class="num" title="Se calcula automáticamente con tus gastos cargados en crédito">—</td>
                    </tr>
                {:else}
                    <tr>
                        <td><strong>{c.cat}</strong></td>
                        <td class="num">{peso(c.n2)}</td><td class="num">{peso(c.n1)}</td>
                        <td class="num">{peso(c.presup)}</td>
                        <td class="num real {claseEstado(c.estado)}" title={c.estado}>{peso(c.real)}</td>
                    </tr>
                {/if}
            {/each}
        </tbody>
        <tfoot>
            <tr><td><strong>Total general</strong></td>
                <td class="num">{peso(totales.n2)}</td><td class="num">{peso(totales.n1)}</td>
                <td class="num">{peso(totales.presup)}</td><td class="num">{peso(totales.real)}</td></tr>
        </tfoot>
    </table>

    <h2>Detalle por subcategoría</h2>
    <table>
        <thead><tr><th>Subcategoría</th><th>{labN2}</th><th>{labN1}</th><th>Presup.</th><th>{labN}</th></tr></thead>
        <tbody>
            {#each grupos as g (g.cat)}
                <tr class="cat"><td colspan="5">{g.cat}{#if g.esCredito} <span class="auto">· se calcula automáticamente</span>{/if}</td></tr>
                {#if g.esCredito}
                    <tr>
                        <td class="ind" title="Suma de cuotas de tarjetas que vencen este mes (ver Gastos en Crédito)">Cuotas del mes</td>
                        <td class="num">—</td>
                        <td class="num">—</td>
                        <td class="num">{peso(creditoMes)}</td>
                        <td class="num">—</td>
                    </tr>
                {/if}
                {#each g.rows as f (f.scid ?? 'null')}
                    <tr>
                        <td class="ind">{f.nombre}</td>
                        <td class="num">{peso(f.n2)}</td>
                        <td class="num">{peso(f.n1)}</td>
                        <td class="num">
                            {#if f.scid != null}
                                <input class="presup" type="text" inputmode="decimal" use:soloNum value={f.presup ? formatNum(f.presup, 0) : ''} placeholder="—"
                                    onchange={(e) => guardarPresup(f.scid, e.currentTarget.value)} />
                            {:else}—{/if}
                        </td>
                        <td class="num real {claseEstado(f.estado)}" title={f.estado}>{peso(f.real)}</td>
                    </tr>
                {/each}
            {/each}
        </tbody>
        <tfoot>
            <tr><td><strong>Total general</strong></td>
                <td class="num">{peso(totales.n2)}</td><td class="num">{peso(totales.n1)}</td>
                <td class="num">{peso(totales.presup)}</td><td class="num">{peso(totales.real)}</td></tr>
        </tfoot>
    </table>
    {#if creditoMes > 0}
        <p class="nota"><strong>Crédito</strong> se calcula automáticamente: suma las cuotas de tus gastos cargados en crédito que vencen este mes (la plata a separar para pagar las tarjetas). Solo engrosa el Presupuesto; el gasto real ya se contó el día que cargaste cada compra.</p>
    {/if}
{/if}

<style>
    :global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
    .sel { font-size: 0.9rem; display: inline-flex; gap: 8px; align-items: center; margin-bottom: 4px; }
    .rango { font-size: 0.82rem; color: var(--text-dim); margin: 0 0 12px; }
    .nota { font-size: 0.8rem; color: var(--text-dim); margin: 4px 0 12px; line-height: 1.4; }
    .nota strong { color: var(--text); }
    .auto { font-size: 0.75rem; font-weight: 400; color: var(--text-dim); white-space: nowrap; }

    /* Tarjetas de resumen del período */
    .resumen { display: flex; gap: 10px; flex-wrap: wrap; margin: 0 0 14px; }
    .card { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 8px 14px; display: flex; flex-direction: column; flex: 1; min-width: 140px; }
    .card span { font-size: 0.72rem; color: var(--text-dim); }
    .card strong { font-size: 1.1rem; }
    .card.ok { background: rgba(74, 222, 128, 0.10); border-color: rgba(74, 222, 128, 0.35); }
    .card.bad { background: rgba(248, 113, 113, 0.10); border-color: rgba(248, 113, 113, 0.35); }

    /* Checklist de primeros pasos */
    .pasos {
        border: 1px solid var(--border); background: var(--surface); border-radius: 8px;
        padding: 12px 14px; margin: 0 0 12px; display: flex; flex-direction: column; gap: 7px;
    }
    .pasos-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .pasos-top strong { font-size: 0.92rem; }
    .pasos-cerrar { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 0.95rem; padding: 0 4px; }
    .pasos-cerrar:hover { color: var(--text); }
    .pasos a { color: var(--accent); text-decoration: none; font-size: 0.88rem; }
    .pasos a:hover { text-decoration: underline; }
    .pasos a.hecho { color: var(--pos); text-decoration: line-through; opacity: 0.75; pointer-events: none; }

    /* Aviso de backup */
    .aviso-backup {
        display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
        font-size: 0.82rem; color: var(--warn); background: rgba(251, 191, 36, 0.08);
        border: 1px dashed var(--warn); border-radius: 8px; padding: 8px 12px; margin: 0 0 12px;
    }
    .aviso-acc { display: flex; gap: 6px; flex-shrink: 0; }
    .aviso-acc button { background: var(--warn); color: #1f1500; border: none; border-radius: 6px; padding: 5px 10px; cursor: pointer; font-size: 0.8rem; font-weight: 600; }
    .aviso-acc button.sec { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); font-weight: 400; }
    h2 { font-size: 1.05rem; margin-top: 20px; }
    table { border-collapse: collapse; width: 100%; font-size: 0.85rem; margin-bottom: 8px; table-layout: fixed; }
    th, td { padding: 5px 6px; text-align: left; overflow: hidden; }
    /* Columna de nombre: corta con … si no entra */
    table th:first-child, table td:first-child {
        width: 24%;
        white-space: nowrap; text-overflow: ellipsis;
    }
    /* Columnas de valores: número completo, alineado a la derecha */
    table th:not(:first-child), table td:not(:first-child) {
        width: 19%;
        text-align: right; white-space: nowrap;
    }
    td.ind { padding-left: 20px; }
    tr.cat td { background: var(--surface-2); font-weight: 700; color: var(--text); white-space: normal; overflow: visible; }
    input.presup { width: 100%; max-width: 90px; text-align: right; padding: 3px 4px; box-sizing: border-box; }
    td.real { font-weight: 600; }
    td.real.ok { color: var(--pos); }
    td.real.warn { color: var(--warn); }
    td.real.bad { color: var(--neg); }
    td.real.none { color: inherit; font-weight: 400; }
    tfoot td { border-top: 2px solid var(--border); font-weight: 600; }
    .accesos { display: flex; gap: 8px; flex-wrap: wrap; margin: 4px 0 14px; }
    .btn-carga { display: inline-block; background: var(--accent); color: #fff; text-decoration: none; padding: 7px 14px; border-radius: 6px; font-weight: 600; font-size: 0.9rem; }
    .btn-carga.sec { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); }
</style>
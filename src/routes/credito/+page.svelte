<script lang="ts">
    import { onMount } from 'svelte';
    import { query } from '$lib/db/client';
    import { parseNum, formatNum, soloNum, mesActual } from '$lib/format';
    import { periodoActivoCC } from '$lib/periodo';
    import Guia from '$lib/Guia.svelte';
    import Skeleton from '$lib/Skeleton.svelte';

    type Celda = { ars: number; usd: number };

    let meses = $state<string[]>([]);
    let tarjetas = $state<string[]>([]);
    let matriz = $state<Record<string, Record<string, Celda>>>({});
    let totalMes = $state<Record<string, Celda>>({});
    let detallePorMes = $state<Record<string, any[]>>({});
    let reservaMap = $state<Record<string, number>>({});
    // Conciliador: recurrentes con tarjeta por (período, tarjeta). NO entra al Ingreso
    // disponible (query separada de la del vencimiento).
    let recurrentes = $state<Record<string, Record<string, Celda>>>({});
    let cargando = $state(true);

    // Proyecta cada compra en crédito a sus meses de cuota. Lleva la moneda para
    // sumar ARS y USD por separado (no se mezclan: distintas unidades).
    const CTE = `
        WITH RECURSIVE serie(gasto_id, tarjeta_id, detalle, total, cuotas, n, inicio, moneda) AS (
            SELECT id, tarjeta_id, detalle, monto, cuotas, 0, mes_inicio_pago, moneda
            FROM gasto WHERE perfil_id=1 AND medio='credito'
            UNION ALL
            SELECT gasto_id, tarjeta_id, detalle, total, cuotas, n+1, inicio, moneda
            FROM serie WHERE n+1 < cuotas
        )
        SELECT strftime('%Y-%m', date(inicio, '+'||n||' months')) AS mes,
               t.nombre AS tarjeta, total*1.0/cuotas AS cuota, serie.moneda AS moneda,
               serie.detalle, n+1 AS nro, serie.cuotas, serie.gasto_id
        FROM serie JOIN tarjeta t ON t.id = serie.tarjeta_id
        ORDER BY mes, tarjeta`;

    onMount(async () => {
        const filas = (await query(CTE)) as any[];
        const mSet = new Set<string>();
        const tSet = new Set<string>();
        const mat: Record<string, Record<string, Celda>> = {};
        const tot: Record<string, Celda> = {};
        const det: Record<string, any[]> = {};
        for (const f of filas) {
            mSet.add(f.mes);
            tSet.add(f.tarjeta);
            mat[f.mes] ??= {};
            const cell = (mat[f.mes][f.tarjeta] ??= { ars: 0, usd: 0 });
            const tcell = (tot[f.mes] ??= { ars: 0, usd: 0 });
            if (f.moneda === 'USD') { cell.usd += f.cuota; tcell.usd += f.cuota; }
            else { cell.ars += f.cuota; tcell.ars += f.cuota; }
            (det[f.mes] ??= []).push(f);
        }
        // Recurrentes con tarjeta por (período, tarjeta). El disparo de un fijo crea el
        // gasto como medio='debito' SIN tarjeta_id, así que no está en la matriz (CTE de
        // cuotas usa medio='credito'); el vínculo a la tarjeta va por la suscripción.
        // Query SEPARADA: estos NUNCA alimentan el vencimiento del Ingreso disponible.
        const recFilas = (await query(
            `SELECT sr.periodo AS mes, t.nombre AS tarjeta, g.moneda, SUM(g.monto) AS monto
             FROM suscripcion_registro sr
             JOIN gasto g ON g.id = sr.gasto_id
             JOIN suscripcion s ON s.id = sr.suscripcion_id
             JOIN tarjeta t ON t.id = s.tarjeta_id
             WHERE s.perfil_id=1 AND s.tarjeta_id IS NOT NULL AND t.tipo='credito'
             GROUP BY sr.periodo, t.nombre, g.moneda`
        )) as any[];
        const rec: Record<string, Record<string, Celda>> = {};
        for (const f of recFilas) {
            mSet.add(f.mes); tSet.add(f.tarjeta);
            const cell = ((rec[f.mes] ??= {})[f.tarjeta] ??= { ars: 0, usd: 0 });
            if (f.moneda === 'USD') cell.usd += f.monto; else cell.ars += f.monto;
        }

        // Ancla: mismo helper que /suscripciones e /ingresos-fijos, mismo fallback.
        // Se muestran solo el período activo en adelante (sin tope superior); los
        // pasados dejan de ser alcanzables desde esta pantalla.
        const ancla = periodoActivoCC() ?? mesActual();
        meses = [...mSet].filter((m) => m >= ancla).sort();
        tarjetas = [...tSet].sort();
        matriz = mat;
        totalMes = tot;
        detallePorMes = det;
        recurrentes = rec;

        const res = (await query('SELECT periodo, monto FROM reserva_credito WHERE perfil_id=1')) as any[];
        const rm: Record<string, number> = {};
        for (const r of res) rm[r.periodo] = r.monto;
        reservaMap = rm;

        cargando = false;
    });

    // Guarda la reserva del mes (plata apartada para pagar ese vencimiento).
    // Netea el "Ingreso disponible para gasto" del mes correspondiente en Presupuesto.
    async function guardarReserva(mes: string, valor: string) {
        const monto = valor.trim() === '' ? 0 : parseNum(valor);
        if (!Number.isFinite(monto) || monto < 0) return;
        await query(
            "INSERT INTO reserva_credito (perfil_id, periodo, monto) VALUES (1, ?, ?) ON CONFLICT(perfil_id, periodo) DO UPDATE SET monto=excluded.monto",
            [mes, monto]
        );
        reservaMap = { ...reservaMap, [mes]: monto };
    }

    // Dos niveles de despliegue in-place: mes (nivel 1) y tarjeta dentro del mes
    // (nivel 2, clave `mes|tarjeta`). Al cambiar de mes se colapsa la tarjeta abierta.
    let mesAbierto = $state<string | null>(null);
    let tarjetaAbierta = $state<string | null>(null);
    const keyT = (m: string, t: string) => `${m}|${t}`;
    function toggleMes(m: string) {
        mesAbierto = mesAbierto === m ? null : m;
        tarjetaAbierta = null;
    }
    function toggleTarj(m: string, t: string) {
        const k = keyT(m, t);
        tarjetaAbierta = tarjetaAbierta === k ? null : k;
    }
    const n0 = (n: number) => Math.round(n || 0).toLocaleString('es-AR');
    const vacia = (c: Celda | undefined) => !c || (!c.ars && !c.usd);
    // Conciliador por tarjeta = cuotas del período + recurrentes de esa tarjeta.
    const conc = (m: string, t: string): Celda => ({
        ars: (matriz[m]?.[t]?.ars || 0) + (recurrentes[m]?.[t]?.ars || 0),
        usd: (matriz[m]?.[t]?.usd || 0) + (recurrentes[m]?.[t]?.usd || 0)
    });
</script>

<div class="titulo-guia">
    <h1>Crédito</h1>
    <Guia clave="credito" texto="Cuánto vas a pagar de tarjetas cada mes, con las cuotas de cada compra ya repartidas. Los montos en pesos y en dólares se muestran por separado (no se mezclan). En 'Reservado' anotás cuánta plata ya apartaste para pagar el vencimiento de ese mes: eso suma a tu ingreso disponible en Cuenta Corriente. Tocá un mes para ver el detalle." />
</div>
<a href="/" class="btn-volver">← Volver a Cuenta Corriente</a>

{#if cargando}
    <div class="sk-tabla">
        <Skeleton w="100%" h="1.7rem" />
        <Skeleton w="100%" h="1.7rem" />
        <Skeleton w="100%" h="1.7rem" />
        <Skeleton w="100%" h="1.7rem" />
        <Skeleton w="100%" h="1.7rem" />
        <Skeleton w="100%" h="1.7rem" />
    </div>
{:else}
    <div class="tabla-scroll">
    <table>
        <thead>
            <tr><th>Mes</th><th>Total</th><th>Reservado</th></tr>
        </thead>
        <tbody>
            {#each meses as m (m)}
                <tr class="mes" onclick={() => toggleMes(m)}>
                    <td>{mesAbierto === m ? '▾' : '▸'} {m}</td>
                    <td class="num total">
                        {#if vacia(totalMes[m])}—{:else}
                            {#if totalMes[m].ars}<div>${n0(totalMes[m].ars)}</div>{/if}
                            {#if totalMes[m].usd}<div class="usd">U$D {n0(totalMes[m].usd)}</div>{/if}
                        {/if}
                    </td>
                    <td class="num resv" onclick={(e) => e.stopPropagation()}>
                        <input class="reserva" type="text" inputmode="decimal" use:soloNum
                            value={reservaMap[m] ? formatNum(reservaMap[m], 0) : ''} placeholder="—"
                            onchange={(e) => guardarReserva(m, e.currentTarget.value)} />
                    </td>
                </tr>
                {#if mesAbierto === m}
                    <tr class="detalle">
                        <td class="detalle-cell" colspan="2">
                            {#each tarjetas as t}
                                {#if !vacia(matriz[m]?.[t]) || recurrentes[m]?.[t]}
                                    <button class="tarj" onclick={() => toggleTarj(m, t)}>
                                        <span class="tarj-nom">{tarjetaAbierta === keyT(m, t) ? '▾' : '▸'} {t}</span>
                                        <span class="tarj-monto">
                                            {#if matriz[m]?.[t]?.ars}<span>${n0(matriz[m][t].ars)}</span>{/if}
                                            {#if matriz[m]?.[t]?.usd}<span class="usd">U$D {n0(matriz[m][t].usd)}</span>{/if}
                                            {#if vacia(matriz[m]?.[t])}<span>—</span>{/if}
                                        </span>
                                    </button>
                                    {#if recurrentes[m]?.[t]}
                                        <div class="concil">
                                            <span class="concil-lbl">Total con recurrentes — como tu resumen</span>
                                            <span class="concil-monto">
                                                {#if conc(m, t).ars}<span>${n0(conc(m, t).ars)}</span>{/if}
                                                {#if conc(m, t).usd}<span class="usd">U$D {n0(conc(m, t).usd)}</span>{/if}
                                            </span>
                                        </div>
                                    {/if}
                                    {#if tarjetaAbierta === keyT(m, t)}
                                        <div class="gastos">
                                            {#each detallePorMes[m].filter((d) => d.tarjeta === t) as d (`${d.gasto_id}-${d.nro}`)}
                                                <div class="item">
                                                    <span>{d.detalle} ({d.nro}/{d.cuotas})</span>
                                                    <strong>{d.moneda === 'USD' ? 'U$D ' : '$'}{n0(d.cuota)}</strong>
                                                </div>
                                            {/each}
                                        </div>
                                    {/if}
                                {/if}
                            {/each}
                        </td>
                        <td></td>
                    </tr>
                {/if}
            {/each}
        </tbody>
    </table>
    </div>
    <p class="nota">Pesos y dólares se muestran por separado porque son unidades distintas. La <strong>reserva</strong> (en pesos) se descuenta del vencimiento al calcular tu <strong>Ingreso disponible</strong> en Cuenta Corriente: plata que ya separaste no te quita del disponible.</p>
{/if}

<style>
    .sk-tabla { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { padding: 8px; text-align: left; }
    td.num { text-align: right; }

    .mes { cursor: pointer; }

    .total { font-weight: bold; }
    .usd { color: var(--text-dim); font-size: 0.92em; }

    .resv { width: 110px; }
    input.reserva { width: 100%; max-width: 100px; text-align: right; padding: 3px 5px; box-sizing: border-box; }

    /* Nivel 1: tarjetas del mes como filas clickeables. La celda ocupa solo Mes+Total
       (colspan 2), así los montos quedan alineados con el Total del mes. */
    .detalle-cell { padding: 4px 8px 10px; }
    .tarj {
        display: flex; justify-content: space-between; align-items: baseline; gap: 12px; width: 100%;
        background: none; border: none; border-bottom: 1px solid var(--border);
        padding: 8px 0; font: inherit; color: inherit; cursor: pointer; text-align: left;
    }
    .tarj:last-child { border-bottom: none; }
    .tarj-nom { font-weight: 600; }
    .tarj-monto { text-align: right; white-space: nowrap; }
    .tarj-monto .usd { margin-left: 6px; }
    /* Línea conciliadora (solo lectura): cuotas + recurrentes de la tarjeta. */
    .concil { display: flex; justify-content: space-between; gap: 12px; font-size: 0.74rem; color: var(--text-dim); padding: 0 0 8px 18px; }
    .concil-monto { white-space: nowrap; }
    .concil-monto .usd { margin-left: 6px; }
    /* Nivel 2: gastos/cuotas de esa tarjeta en ese mes. */
    .gastos { padding: 2px 0 6px 18px; }
    .item {
        display: flex;
        justify-content: space-between;
        font-size: 0.85rem;
        padding: 2px 0;
    }

    .nota { font-size: 0.8rem; color: var(--text-dim); margin-top: 12px; line-height: 1.4; }
    .nota strong { color: var(--text); }
</style>

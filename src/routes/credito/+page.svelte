<script lang="ts">
    import { onMount } from 'svelte';
    import { query } from '$lib/db/client';
    import { parseNum, formatNum, soloNum } from '$lib/format';
    import Guia from '$lib/Guia.svelte';

    type Celda = { ars: number; usd: number };

    let meses = $state<string[]>([]);
    let tarjetas = $state<string[]>([]);
    let matriz = $state<Record<string, Record<string, Celda>>>({});
    let totalMes = $state<Record<string, Celda>>({});
    let detallePorMes = $state<Record<string, any[]>>({});
    let reservaMap = $state<Record<string, number>>({});
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
        meses = [...mSet].sort();
        tarjetas = [...tSet].sort();
        matriz = mat;
        totalMes = tot;
        detallePorMes = det;

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

    let mesAbierto = $state<string | null>(null);
    const n0 = (n: number) => Math.round(n || 0).toLocaleString('es-AR');
    const vacia = (c: Celda | undefined) => !c || (!c.ars && !c.usd);
</script>

<div class="titulo-guia">
    <h1>Crédito</h1>
    <Guia clave="credito" texto="Cuánto vas a pagar de tarjetas cada mes, con las cuotas de cada compra ya repartidas. Los montos en pesos y en dólares se muestran por separado (no se mezclan). En 'Reservado' anotás cuánta plata ya apartaste para pagar el vencimiento de ese mes: eso suma a tu ingreso disponible en Cuenta Corriente. Tocá un mes para ver el detalle." />
</div>
<a href="/" class="btn-volver">← Volver a Cuenta Corriente</a>

{#if cargando}
    <p>Cargando…</p>
{:else}
    <div class="tabla-scroll">
    <table>
        <thead>
            <tr><th>Mes</th>{#each tarjetas as t}<th>{t}</th>{/each}<th>Total</th><th>Reservado</th></tr>
        </thead>
        <tbody>
            {#each meses as m (m)}
                <tr class="mes" onclick={() => (mesAbierto = mesAbierto === m ? null : m)}>
                    <td>{mesAbierto === m ? '▾' : '▸'} {m}</td>
                    {#each tarjetas as t}
                        <td class="num">
                            {#if vacia(matriz[m]?.[t])}—{:else}
                                {#if matriz[m][t].ars}<div>${n0(matriz[m][t].ars)}</div>{/if}
                                {#if matriz[m][t].usd}<div class="usd">U$D {n0(matriz[m][t].usd)}</div>{/if}
                            {/if}
                        </td>
                    {/each}
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
                        <td></td>
                        {#each tarjetas as t}
                            <td>
                                {#each detallePorMes[m].filter(d => d.tarjeta === t) as d (`${d.gasto_id}-${d.nro}`)}
                                    <div class="item">
                                        <span>{d.detalle} ({d.nro}/{d.cuotas})</span>
                                        <strong>{d.moneda === 'USD' ? 'U$D ' : '$'}{n0(d.cuota)}</strong>
                                    </div>
                                {/each}
                            </td>
                        {/each}
                        <td></td>
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
    table { border-collapse: collapse; width: 100%; }
    th, td { padding: 8px; text-align: left; }
    td.num { text-align: right; }

    .mes { cursor: pointer; }

    .total { font-weight: bold; }
    .usd { color: var(--text-dim); font-size: 0.92em; }

    .resv { width: 110px; }
    input.reserva { width: 100%; max-width: 100px; text-align: right; padding: 3px 5px; box-sizing: border-box; }

    .item {
        display: flex;
        justify-content: space-between;
        font-size: 0.85rem;
        padding: 2px 0;
    }

    .nota { font-size: 0.8rem; color: var(--text-dim); margin-top: 12px; line-height: 1.4; }
    .nota strong { color: var(--text); }
</style>

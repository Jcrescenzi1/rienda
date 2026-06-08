<script lang="ts">
    import { onMount } from 'svelte';
    import { query } from '$lib/db/client';

    let meses = $state<string[]>([]);
    let tarjetas = $state<string[]>([]);
    let matriz = $state<Record<string, Record<string, number>>>({});
    let totalMes = $state<Record<string, number>>({});
    let detallePorMes = $state<Record<string, any[]>>({});
    let cargando = $state(true);

    const CTE = `
        WITH RECURSIVE serie(gasto_id, tarjeta_id, detalle, total, cuotas, n, inicio) AS (
            SELECT id, tarjeta_id, detalle, monto, cuotas, 0, mes_inicio_pago
            FROM gasto WHERE perfil_id=1 AND medio='credito'
            UNION ALL
            SELECT gasto_id, tarjeta_id, detalle, total, cuotas, n+1, inicio
            FROM serie WHERE n+1 < cuotas
        )
        SELECT strftime('%Y-%m', date(inicio, '+'||n||' months')) AS mes,
               t.nombre AS tarjeta, total*1.0/cuotas AS cuota,
               serie.detalle, n+1 AS nro, serie.cuotas, serie.gasto_id
        FROM serie JOIN tarjeta t ON t.id = serie.tarjeta_id
        ORDER BY mes, tarjeta`;

    onMount(async () => {
        const filas = (await query(CTE)) as any[];
        const mSet = new Set<string>();
        const tSet = new Set<string>();
        const mat: Record<string, Record<string, number>> = {};
        const tot: Record<string, number> = {};
        const det: Record<string, any[]> = {};
        for (const f of filas) {
            mSet.add(f.mes);
            tSet.add(f.tarjeta);
            mat[f.mes] ??= {};
            mat[f.mes][f.tarjeta] = (mat[f.mes][f.tarjeta] ?? 0) + f.cuota;
            tot[f.mes] = (tot[f.mes] ?? 0) + f.cuota;
            (det[f.mes] ??= []).push(f);
        }
        meses = [...mSet].sort();
        tarjetas = [...tSet].sort();
        matriz = mat;
        totalMes = tot;
        detallePorMes = det;
        cargando = false;
    });

    let mesAbierto = $state<string | null>(null);
    const peso = (n: number | undefined) => (n ? '$' + Math.round(n).toLocaleString('es-AR') : '—');
</script>

<h1>Vista de crédito</h1>
<a href="/" class="btn-volver">← Volver a Gastos y Presupuesto</a>

{#if cargando}
    <p>Cargando…</p>
{:else}
    <table>
        <thead>
            <tr><th>Mes</th>{#each tarjetas as t}<th>{t}</th>{/each}<th>Total</th></tr>
        </thead>
        <tbody>
            {#each meses as m (m)}
                <tr class="mes" onclick={() => (mesAbierto = mesAbierto === m ? null : m)}>
                    <td>{mesAbierto === m ? '▾' : '▸'} {m}</td>
                    {#each tarjetas as t}<td class="num">{peso(matriz[m]?.[t])}</td>{/each}
                    <td class="num total">{peso(totalMes[m])}</td>
                </tr>
                {#if mesAbierto === m}
                    <tr class="detalle">
                        <td></td>
                        {#each tarjetas as t}
                            <td>
                                {#each detallePorMes[m].filter(d => d.tarjeta === t) as d (`${d.gasto_id}-${d.nro}`)}
                                    <div class="item">
                                        <span>{d.detalle} ({d.nro}/{d.cuotas})</span>
                                        <strong>{peso(d.cuota)}</strong>
                                    </div>
                                {/each}
                            </td>
                        {/each}
                        <td></td>
                    </tr>
                {/if}
            {/each}
        </tbody>
    </table>
{/if}

<style>
    /* Estructura base sin colores hardcodeados */
    table { border-collapse: collapse; width: 100%; }
    th, td { padding: 8px; text-align: left; }
    td.num { text-align: right; }
    
    .mes { cursor: pointer; }
    
    .total { font-weight: bold; }
    
    .item { 
        display: flex; 
        justify-content: space-between; 
        font-size: 0.85rem; 
        padding: 2px 0; 
    }
    
    .btn-volver { display: block; margin-bottom: 15px; }
</style>
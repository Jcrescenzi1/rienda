<script lang="ts">
    import { onMount } from 'svelte';
    import { query } from '$lib/db/client';
    import { addMonths, cargarModo, cargarCortes, crearAsignador, type ModoPeriodo } from '$lib/periodo';
    import { mesActual, parseNum, formatNum, soloNum } from '$lib/format';
    import { setMeta } from '$lib/db/meta';
    import { pwa, instalarApp } from '$lib/pwa.svelte';
    import Guia from '$lib/Guia.svelte';
    import CountUp from '$lib/CountUp.svelte';
    import Skeleton from '$lib/Skeleton.svelte';

    let periodo = $state(mesActual());
    let grupos = $state<any[]>([]);
    let consolidado = $state<any[]>([]);
    let totales = $state<any>({ n2: 0, n1: 0, presup: 0, real: 0 });
    // Split de "Gasto total del mes" (Ítem 1): consumo real vs. plata apartada en
    // la categoría de Ahorro. Ninguno de los dos resta de Ingreso disponible; son
    // solo una apertura informativa de totales.real (que no cambia) — mismo patrón
    // colapsado/expandido que "Ingreso disponible": el total se ve siempre, el
    // desglose (Gasto real / Ahorro) aparece al abrir.
    let gastoRealMes = $state(0);
    let ahorroMes = $state(0);
    let nombreAhorro = $state('Ahorro'); // nombre editable de la categoría de ahorro
    let gastoAbierto = $state(typeof localStorage !== 'undefined' && localStorage.getItem('gasto_detalle') === '1');
    $effect(() => { try { localStorage.setItem('gasto_detalle', gastoAbierto ? '1' : '0'); } catch { /* ignore */ } });
    // Reserva para tarjetas: suma de cuotas de crédito que vencen en el mes
    // visible. Solo suma al total de PRESUPUESTO (los gastos en crédito ya
    // fueron contados como gasto real el día que se cargaron).
    let creditoMes = $state(0);
    let creditoMesUsd = $state(0);
    let gastoUsdMes = $state(0);   // gastos puntuales USD del período (informativo, sin convertir)
    let ingresoUsdMes = $state(0); // ingresos puntuales USD del período (informativo, sin convertir)
    let nombre = $state('');       // nombre del perfil, para el saludo del header
    // Ingresos TOTALES del período visible (primario + secundarios + otros),
    // en ARS (los USD se convierten al dólar del día de cobro).
    let ingresosMes = $state(0);
    // Ingresos REGULARES del período (Brief 1): solo tipo='Sueldo' en
    // 'Ingreso Principal'/'Ingresos Secundarios', en ARS (USD recurrente al dólar
    // del día). Base del semáforo de la categoría de ahorro. NO incluye 'Otros',
    // Extraordinarios ni 'Desahorro'.
    let ingresosRegularesMes = $state(0);
    // Umbral de tasa de ahorro (A/R): sticky en tabla meta (clave 'umbral_ahorro'),
    // default 0.10 (10%). Fuente ÚNICA compartida con Capacidad de ahorro (Brief 2).
    let umbralAhorro = $state(0.10);
    // Reserva de crédito apartada para el mes visible (plata separada para pagar
    // tarjetas). Netea el "Ingreso disponible para gasto" del Ítem 1.
    let reservaMes = $state(0);
    // Item 2: deuda en cuotas que vence el MES SIGUIENTE vs lo reservado para ese mes.
    let deudaSig = $state(0);
    let deudaSigUsd = $state(0);
    let reservaSig = $state(0);
    let mesSigLabel = $state('');
    // Ingreso disponible = ingresos − (vencimiento de tarjeta del mes − reserva).
    // Concientización de caja: el gasto se cuenta una sola vez (devengado), esto
    // solo ajusta cuánto te queda libre después de separar para las tarjetas.
    let ingresoDisponible = $derived(ingresosMes - (creditoMes - reservaMes));
    let descubierto = $derived(deudaSig - reservaSig);
    // El valor del descubierto se pinta amarillo solo si supera el 10% del disponible.
    let deudaAlta = $derived(descubierto > 0 && (ingresoDisponible <= 0 || descubierto > ingresoDisponible * 0.10));
    // Detalle del Ingreso disponible: colapsable; recuerda la preferencia.
    let detalleAbierto = $state(typeof localStorage !== 'undefined' && localStorage.getItem('disp_detalle') === '1');
    $effect(() => { try { localStorage.setItem('disp_detalle', detalleAbierto ? '1' : '0'); } catch { /* ignore */ } });
    let deudaAbierto = $state(typeof localStorage !== 'undefined' && localStorage.getItem('deuda_detalle') === '1');
    $effect(() => { try { localStorage.setItem('deuda_detalle', deudaAbierto ? '1' : '0'); } catch { /* ignore */ } });
    // Checklist de primeros pasos (null = oculto o completo)
    let pasos = $state<{ ingreso: boolean; categorias: boolean; tarjeta: boolean; instalar: boolean; fijos: boolean; ingresosFijos: boolean } | null>(null);
    let pasosAbierto = $state(false); // desplegable del checklist (colapsado por defecto)
    let rango = $state('');
    let modo = $state<ModoPeriodo>('sueldo');
    let cargando = $state(true);
    // Navegación de período: límites y secuencia de cortes (fuente: cargarCortes).
    let primerPeriodo = $state('');   // límite inferior (primer corte / mes más viejo con datos)
    let ultimoPeriodo = $state('');   // límite superior (último corte abierto / mes actual en calendario)
    let cortePeriodos = $state<string[]>([]); // periodos de los cortes, en orden (modo sueldo)
    let mesInput: HTMLInputElement | undefined = $state(); // input month oculto que abre el picker nativo
    // Caches por montaje: datos que NO dependen del período visible. Evitan recargar
    // modo/cortes y recomputar la "categoría habitual" (GROUP BY sobre todo el
    // historial) en cada flecha/cambio de mes. Se recalculan al remontar la Home.
    let modoCache: ModoPeriodo | null = null;
    let cortesCache: { fecha: string; periodo: string }[] | null = null;
    let homeCatCache: Record<string, number | null> | null = null;

    // Etiquetas de mes para los encabezados (derivadas del período visible)
    let labN = $state(''); let labN1 = $state(''); let labN2 = $state('');

    const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    // '2026-06' -> "jun '26". Parsea el string directo (sin new Date(), evita corrimiento UTC-3).
    function labelMes(periodo: string): string {
        const [y, m] = periodo.split('-').map(Number);
        return `${MESES[m - 1]} '${String(y).slice(2)}`;
    }
    const MESES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    // '2026-06' -> "Junio 2026" para el texto central del selector.
    function labelPeriodo(periodo: string): string {
        const [y, m] = periodo.split('-').map(Number);
        return `${MESES_LARGO[m - 1]} ${y}`;
    }

    function desvio(real: number, presup: number): string {
        if (!presup) return '—';
        if (real <= presup) return 'En margen';
        if (real <= presup * 1.25) return 'Superado';
        return 'Muy superado';
    }

    async function cargar() {
        cargando = true;

        // Modo y cortes no cambian dentro de la Home -> se cachean (los setea el
        // init del selector; acá solo carga si faltara).
        if (modoCache === null) modoCache = await cargarModo();
        modo = modoCache;
        if (cortesCache === null) cortesCache = modo === 'sueldo' ? await cargarCortes() : [];
        const cortes = cortesCache;
        const asignar = crearAsignador(modo, cortes);

        const n = periodo;
        const n1 = addMonths(periodo, -1);
        const n2 = addMonths(periodo, -2);
        const objetivo = new Set([n, n1, n2]);
        const mesSig = addMonths(n, 1);
        mesSigLabel = labelMes(mesSig);
        // Robustez/escala: acotar la carga de gastos del consolidado al rango de
        // los 3 períodos visibles (no traer todo el historial). Límite inferior =
        // inicio del período más viejo; en modo sueldo, el corte real (puede caer
        // antes del día 1 si el sueldo se cobra anticipado).
        let desdeGastos = `${n2}-01`;
        if (modo === 'sueldo') {
            const fch = cortes.filter((c) => c.periodo === n2 || c.periodo === n1 || c.periodo === n).map((c) => c.fecha).sort();
            if (fch.length) desdeGastos = fch[0];
        }
        // Deuda de credito de un mes M: cuotas repartidas. ARS y USD se devuelven
        // POR SEPARADO (no se convierten: el costo real en pesos de pagar una
        // compra USD en tarjeta difiere del MEP por impuestos/percepciones).
        const CUOTAS_MES = `
            WITH RECURSIVE serie(total, cuotas, c, inicio, moneda, fecha) AS (
                SELECT monto, cuotas, 0, mes_inicio_pago, moneda, fecha
                FROM gasto WHERE perfil_id=1 AND medio='credito'
                UNION ALL
                SELECT total, cuotas, c+1, inicio, moneda, fecha FROM serie WHERE c+1 < cuotas
            )
            SELECT
                COALESCE(SUM(CASE WHEN moneda='USD' THEN 0 ELSE total*1.0/cuotas END),0) AS ars,
                COALESCE(SUM(CASE WHEN moneda='USD' THEN total*1.0/cuotas ELSE 0 END),0) AS usd
            FROM serie WHERE strftime('%Y-%m', date(inicio, '+'||c||' months')) = ?`;

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

        // Todas las lecturas independientes en paralelo: una sola tanda al worker
        // en vez de encadenarlas (más rápido, sobre todo en mobile).
        const [gastos, hab, subs, cats, presup, cred, ing, dolarBase, resv, deudaR, reservaR, umbralRow] = (await Promise.all([
            query(
                `SELECT g.fecha, g.monto, g.moneda,
                        g.categoria_id,
                        COALESCE(g.subcategoria_id, m.subcategoria_id) AS scid,
                        (SELECT cd.valor FROM cotizacion_dolar cd
                         WHERE cd.perfil_id=1 AND cd.casa='bolsa' AND cd.fecha <= g.fecha
                         ORDER BY cd.fecha DESC LIMIT 1) AS dolar_dia,
                        EXISTS(SELECT 1 FROM suscripcion_registro sr WHERE sr.gasto_id = g.id) AS es_fijo
                 FROM gasto g
                 LEFT JOIN mapeo_detalle m ON m.perfil_id = g.perfil_id AND m.detalle = g.detalle
                 WHERE g.perfil_id = 1 AND g.fecha >= ?`,
                [desdeGastos]
            ),
            homeCatCache === null
                ? query(
                    `SELECT scid, categoria_id, COUNT(*) AS c FROM (
                       SELECT COALESCE(g.subcategoria_id, m.subcategoria_id) AS scid, g.categoria_id
                       FROM gasto g LEFT JOIN mapeo_detalle m ON m.perfil_id=g.perfil_id AND m.detalle=g.detalle
                       WHERE g.perfil_id=1
                     ) GROUP BY scid, categoria_id`
                  )
                : Promise.resolve(null),
            query('SELECT id, nombre FROM subcategoria WHERE perfil_id=1 AND activa=1'),
            query('SELECT id, nombre, es_ahorro FROM categoria WHERE perfil_id=1'),
            query("SELECT subcategoria_id, monto, auto FROM presupuesto WHERE perfil_id=1 AND periodo='default'"),
            query(CUOTAS_MES, [n]),
            query(
                `SELECT i.monto, i.moneda, i.categoria, i.tipo,
                        (SELECT c.valor FROM cotizacion_dolar c
                         WHERE c.perfil_id=1 AND c.casa='bolsa' AND c.fecha <= i.fecha
                         ORDER BY c.fecha DESC LIMIT 1) AS dolar_dia,
                        EXISTS(SELECT 1 FROM ingreso_fijo_registro r WHERE r.ingreso_id = i.id) AS es_fijo
                 FROM ingreso i
                 WHERE i.perfil_id=1 AND i.periodo=?`,
                [n]
            ),
            query("SELECT valor FROM cotizacion_dolar WHERE perfil_id=1 AND casa='bolsa' ORDER BY fecha ASC LIMIT 1"),
            query('SELECT COALESCE(SUM(monto),0) AS t FROM reserva_credito WHERE perfil_id=1 AND periodo=?', [n]),
            query(CUOTAS_MES, [mesSig]),
            query('SELECT COALESCE(SUM(monto),0) AS t FROM reserva_credito WHERE perfil_id=1 AND periodo=?', [mesSig]),
            query("SELECT valor FROM meta WHERE clave='umbral_ahorro'")
        ])) as any[];
        // MEP base determinístico para ingresos USD sin cotización previa
        // (la más antigua conocida; no cambia con el auto-refresh).
        const dolarPrimero = dolarBase[0]?.valor ?? 1;

        // categoría habitual por subcategoría (no depende del período -> se cachea)
        if (homeCatCache === null) {
            const hc: Record<string, number | null> = {};
            const bestC: Record<string, number> = {};
            for (const h of hab) {
                const k = h.scid == null ? 'null' : String(h.scid);
                if (bestC[k] === undefined || h.c > bestC[k]) { bestC[k] = h.c; hc[k] = h.categoria_id; }
            }
            homeCatCache = hc;
        }
        const homeCat = homeCatCache;

        const nombreSub: Record<number, string> = {};
        for (const s of subs) nombreSub[s.id] = s.nombre;
        const nombreCat: Record<number, string> = {};
        const esAhorroCat: Record<number, boolean> = {};
        for (const c of cats) { nombreCat[c.id] = c.nombre; esAhorroCat[c.id] = !!c.es_ahorro; }
        const catAhorro = cats.find((c: any) => c.es_ahorro);
        if (catAhorro) nombreAhorro = catAhorro.nombre;
        const presupMap: Record<number, number> = {};
        const autoMap: Record<number, boolean> = {};
        for (const p of presup) { presupMap[p.subcategoria_id] = p.monto; autoMap[p.subcategoria_id] = !!p.auto; }

        // Acumular por subcategoría, solo para los 3 períodos objetivo
        const key = (id: any) => (id == null ? 'null' : String(id));
        const acc: Record<string, any> = {};

        let gastoUsdAcc = 0;
        for (const g of gastos) {
            const per = asignar(g.fecha);
            if (!per || !objetivo.has(per)) continue;
            // Puntual en USD (NO originado en un fijo): sale del stock de dólares,
            // se aísla del flujo ARS y se muestra informativo (período visible).
            if (g.moneda === 'USD' && !g.es_fijo) {
                if (per === n) gastoUsdAcc += g.monto;
                continue;
            }
            const k = key(g.scid);
            // ARS directo; USD recurrente (fijo) -> ARS al MEP de la fecha de compra.
            const monto = g.moneda === 'USD' ? g.monto * (g.dolar_dia ?? dolarPrimero) : g.monto;
            acc[k] ??= { scid: g.scid, n2: 0, n1: 0, real: 0 };
            if (per === n2) acc[k].n2 += monto;
            else if (per === n1) acc[k].n1 += monto;
            else if (per === n) acc[k].real += monto;
        }
        gastoUsdMes = gastoUsdAcc;

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
                autoPresup: a.scid != null ? (autoMap[a.scid] ?? false) : false,
                estado: desvio(a.real, presupVal),
                // Categoría "habitual" de la subcategoría marcada como Ahorro: separa
                // consumo real de plata apartada, sin tocar el resto de las métricas
                // (esta fila sigue sumando igual a totales.real/consolidado).
                esAhorro: catId != null && !!esAhorroCat[catId]
            };
        });

        // Split informativo para el panel "Ingreso disponible": Gasto real vs Ahorro.
        // No reemplaza a totales.real (que sigue siendo el total de todo, para el
        // consolidado de abajo) — es solo una apertura de esa misma plata.
        gastoRealMes = filas.filter((f) => !f.esAhorro).reduce((s, f) => s + f.real, 0);
        ahorroMes = filas.filter((f) => f.esAhorro).reduce((s, f) => s + f.real, 0);

        const map: Record<string, any[]> = {};
        for (const f of filas) (map[f.catNombre] ??= []).push(f);
        const gr = Object.keys(map).sort((a, b) => a.localeCompare(b, 'es')).map((cat) => {
            const rows = map[cat].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
            const sub = rows.reduce((t, r) => ({ n2: t.n2 + r.n2, n1: t.n1 + r.n1, presup: t.presup + r.presup, real: t.real + r.real }), { n2: 0, n1: 0, presup: 0, real: 0 });
            return { cat, rows, sub, esAhorro: rows.some((r: any) => r.esAhorro) };
        });

        creditoMes = cred[0]?.ars ?? 0;
        creditoMesUsd = cred[0]?.usd ?? 0;

        grupos = gr;
        consolidado = gr.map((g: any) => ({ cat: g.cat, ...g.sub, esAhorro: g.esAhorro, estado: desvio(g.sub.real, g.sub.presup) }));
        totales = filas.reduce((t, r) => ({ n2: t.n2 + r.n2, n1: t.n1 + r.n1, presup: t.presup + r.presup, real: t.real + r.real }), { n2: 0, n1: 0, presup: 0, real: 0 });

        // Ingresos del período en ARS (USD recurrente al MEP del día de cobro,
        // fallback al último). El USD PUNTUAL se aísla (sale del stock de dólares).
        ingresosMes = ing.reduce(
            (s: number, r: any) => (r.moneda === 'USD' && !r.es_fijo) ? s : s + (r.moneda === 'USD' ? r.monto * (r.dolar_dia ?? dolarPrimero) : r.monto),
            0
        );
        ingresoUsdMes = ing.reduce((s: number, r: any) => (r.moneda === 'USD' && !r.es_fijo) ? s + r.monto : s, 0);

        // R = ingresos regulares (Brief 1): tipo 'Sueldo' en Principal/Secundarios,
        // en ARS (USD recurrente al MEP del día; USD puntual excluido, igual que
        // ingresosMes). Excluye 'Otros', Extraordinarios ('Aciclico') y 'Desahorro'.
        ingresosRegularesMes = ing.reduce((s: number, r: any) => {
            if (r.tipo !== 'Sueldo') return s;
            if (r.categoria !== 'Ingreso Principal' && r.categoria !== 'Ingresos Secundarios') return s;
            if (r.moneda === 'USD' && !r.es_fijo) return s; // USD puntual: fuera del flujo ARS
            return s + (r.moneda === 'USD' ? r.monto * (r.dolar_dia ?? dolarPrimero) : r.monto);
        }, 0);

        // Umbral de ahorro sticky (meta). Sin valor guardado → default 0.10.
        umbralAhorro = umbralRow?.[0]?.valor != null ? (parseFloat(umbralRow[0].valor) || 0.10) : 0.10;

        // Reserva de crédito apartada para el mes visible (vacío = 0)
        reservaMes = resv[0]?.t ?? 0;
        deudaSig = deudaR[0]?.ars ?? 0;
        deudaSigUsd = deudaR[0]?.usd ?? 0;
        reservaSig = reservaR[0]?.t ?? 0;

        cargando = false;
    }

    async function guardarPresup(scid: number, valor: string) {
        // Campo vacío = presupuesto 0 (comportamiento histórico de "borrar" el valor)
        const monto = valor.trim() === '' ? 0 : parseNum(valor);
        if (scid == null || !Number.isFinite(monto) || monto < 0) return;
        await query("INSERT INTO presupuesto (perfil_id, subcategoria_id, periodo, monto) VALUES (1, ?, 'default', ?) ON CONFLICT(perfil_id, subcategoria_id, periodo) DO UPDATE SET monto = excluded.monto", [scid, monto]);
        await cargar();
    }

    // ===== Checklist de primeros pasos =====
    async function cargarPasos() {
        const oculto = (await query("SELECT valor FROM meta WHERE clave='primeros_pasos_oculto'")) as any[];
        if (oculto.length) return;
        // Categorías y tarjeta son recomendaciones de "revisar/editar": se marcan
        // al tocarlas (flag en meta), no por presencia de datos. La tarjeta ya viene
        // sembrada (Genérica), así que contar tarjetas siempre daría "hecho".
        const catVisto = (await query("SELECT valor FROM meta WHERE clave='paso_categorias'")) as any[];
        const tarjVisto = (await query("SELECT valor FROM meta WHERE clave='paso_tarjeta'")) as any[];
        const ni = (await query('SELECT COUNT(*) AS n FROM ingreso WHERE perfil_id=1')) as any[];
        const nf = (await query('SELECT COUNT(*) AS n FROM suscripcion WHERE perfil_id=1')) as any[];
        const nif = (await query('SELECT COUNT(*) AS n FROM ingreso_fijo WHERE perfil_id=1')) as any[];
        // 'instalar' se autocompleta si la app ya corre instalada (standalone).
        // 'ingreso' ya no se muestra como paso: solo alimenta el halo de "Cargar ingreso".
        const p = { ingreso: ni[0].n > 0, categorias: catVisto.length > 0, tarjeta: tarjVisto.length > 0, instalar: pwa.standalone, fijos: nf[0].n > 0, ingresosFijos: nif[0].n > 0 };
        if (p.categorias && p.instalar && p.fijos && p.ingresosFijos && p.tarjeta) return; // setup completo: no molestar
        pasos = p;
    }

    // Disparador del paso "instalá" del checklist (Android prompt). En iOS/sin
    // evento, el lugar para instalar es la slide del onboarding o /datos.
    async function instalarDesdeChecklist() {
        await instalarApp();
    }

    async function ocultarPasos() {
        await setMeta('primeros_pasos_oculto', '1');
        pasos = null;
    }

    async function cargarNombre() {
        const r = (await query('SELECT nombre FROM perfil WHERE id=1')) as any[];
        nombre = r[0]?.nombre ?? '';
    }
    // ===== Selector de período: sticky de sesión + límites de navegación =====
    // sessionStorage (NO localStorage): al reabrir la app en una sesión nueva,
    // arranca en el último período abierto a propósito. Guardamos también el
    // "último corte" conocido como baseline, para detectar un corte NUEVO.
    const SS_PERIODO = 'cc_periodo';
    function guardarSel() {
        try { sessionStorage.setItem(SS_PERIODO, JSON.stringify({ periodo, ultimoCorte: ultimoPeriodo })); } catch { /* ignore */ }
    }

    // Resuelve límites + período inicial. Reusa cargarCortes (no reimplementa la
    // secuencia). Corre una vez al montar, antes del primer cargar().
    async function resolverPeriodoInicial() {
        modoCache = await cargarModo();
        modo = modoCache;
        cortesCache = modoCache === 'sueldo' ? await cargarCortes() : [];
        const cortes = cortesCache;
        cortePeriodos = modo === 'sueldo' ? [...new Set(cortes.map((c) => c.periodo))] : [];
        // Límite superior: último corte abierto (sueldo) o mes actual (calendario):
        // no tiene sentido navegar a futuros sin corte.
        ultimoPeriodo = modo === 'sueldo' ? (cortePeriodos[cortePeriodos.length - 1] ?? mesActual()) : mesActual();
        // Límite inferior: primer corte (sueldo) o mes más viejo con datos (calendario).
        if (modo === 'sueldo') {
            primerPeriodo = cortePeriodos[0] ?? ultimoPeriodo;
        } else {
            const r = (await query(
                "SELECT MIN(f) AS m FROM (SELECT MIN(fecha) AS f FROM gasto WHERE perfil_id=1 UNION ALL SELECT MIN(fecha) AS f FROM ingreso WHERE perfil_id=1)"
            )) as any[];
            primerPeriodo = r[0]?.m ? String(r[0].m).slice(0, 7) : ultimoPeriodo;
        }
        // Sticky: default al último corte; si hay guardado, respetarlo SALVO que
        // haya aparecido un corte nuevo (último corte posterior al baseline) -> saltar.
        let guardado: { periodo?: string; ultimoCorte?: string } | null = null;
        try { guardado = JSON.parse(sessionStorage.getItem(SS_PERIODO) ?? 'null'); } catch { /* ignore */ }
        if (guardado?.periodo) {
            periodo = ultimoPeriodo > (guardado.ultimoCorte ?? '') ? ultimoPeriodo : guardado.periodo;
        } else {
            periodo = ultimoPeriodo;
        }
        guardarSel();
    }

    // Cambia el período (flecha o dropdown), clampeado a los límites, persiste y recarga.
    function seleccionar(p: string) {
        if (primerPeriodo && p < primerPeriodo) p = primerPeriodo;
        if (ultimoPeriodo && p > ultimoPeriodo) p = ultimoPeriodo;
        periodo = p;
        guardarSel();
        cargar();
    }
    // Vecino anterior/siguiente: en sueldo recorre la secuencia de cortes; en
    // calendario, mes a mes. Los límites ya están cubiertos por seleccionar().
    function vecino(dir: -1 | 1) {
        if (modo === 'sueldo' && cortePeriodos.length) {
            const i = cortePeriodos.indexOf(periodo);
            if (i >= 0) {
                const j = i + dir;
                if (j >= 0 && j < cortePeriodos.length) seleccionar(cortePeriodos[j]);
                return;
            }
        }
        seleccionar(addMonths(periodo, dir));
    }
    // Abre el dropdown nativo (saltos largos). El input month está como overlay
    // transparente sobre el texto, así que el click suele bastar; showPicker es el
    // camino explícito donde está soportado.
    function abrirDropdown() {
        try { (mesInput as any)?.showPicker(); } catch { mesInput?.focus(); }
    }

    onMount(async () => { await resolverPeriodoInicial(); cargar(); cargarPasos(); cargarNombre(); });
    const peso = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-AR');
    // Consolidado por categoría: montos en miles (÷1000, redondeado). Solo presentación
    // de esa vista agregada; el dato guardado y las cuentas siguen en pesos enteros.
    const pesoMil = (n: number) => '$' + Math.round((n || 0) / 1000).toLocaleString('es-AR');
    const usd = (n: number) => 'U$D ' + Math.round(n || 0).toLocaleString('es-AR');
    // Semáforo completo de Presupuesto/Gasto: verde si entra en el ingreso
    // disponible, amarillo entre disponible e ingreso total, rojo si supera el total.
    function semColor(v: number): string {
        if (ingresosMes <= 0 && ingresoDisponible <= 0) return '';
        if (v <= ingresoDisponible) return 'ok';
        if (v <= ingresosMes) return 'warn';
        return 'bad';
    }
    // Gasto: con presupuesto, verde/rojo vs presupuesto; sin presupuesto, semáforo
    // completo contra el ingreso (igual que Presupuesto).
    function gastoColor(): string {
        if (totales.presup > 0) return totales.real <= totales.presup ? 'ok' : 'bad';
        return semColor(totales.real);
    }
    const claseEstado = (e: string) => e === 'En margen' ? 'ok' : e === 'Superado' ? 'warn' : e === 'Muy superado' ? 'bad' : 'none';

    // Presupuesto de ahorro DERIVADO de la meta (fuente única = objetivo % editable en
    // Capacidad de ahorro, tabla meta `umbral_ahorro`): monto = umbral% × ingreso
    // regular del período. Es el "target" de la categoría de ahorro; se muestra como
    // Presup. en su fila y el semáforo compara contra él. R=0 → sin target (neutro).
    let metaAhorroMonto = $derived(ingresosRegularesMes > 0 ? umbralAhorro * ingresosRegularesMes : 0);
    // Semáforo de la categoría de ahorro: polaridad INVERTIDA vs una categoría de
    // gasto — verde si el ahorro real ALCANZA el target derivado, rojo si no llega,
    // neutro si no hay ingreso regular (no hay target y no se pinta rojo).
    function claseAhorro(real: number): string {
        if (ingresosRegularesMes <= 0) return 'none';
        return real >= metaAhorroMonto ? 'ok' : 'bad';
    }
    function tituloAhorro(real: number): string {
        if (ingresosRegularesMes <= 0) return 'Sin ingreso regular cargado — objetivo se edita en Capacidad de ahorro';
        const tasa = real / ingresosRegularesMes;
        return `Ahorrás ${(tasa * 100).toFixed(1)}% del ingreso regular · objetivo ${(umbralAhorro * 100).toFixed(0)}%`;
    }
</script>

<div class="titulo-guia">
    <h1>Cuenta Corriente</h1>
    <Guia clave="home" texto="Tu día a día: cuánto gastaste este período y cómo venís contra tu presupuesto; las flechas cambian de período. En modo sueldo un gasto puede caer en 'otro mes': el período lo abre el día que cobrás, no el calendario. Los dólares de tus gastos/ingresos recurrentes y de cuotas entran a tus pesos; los sueltos quedan aparte, solo informativos. Tocá el casillero de Presupuesto de una subcategoría para fijar un monto." verMas />
</div>
{#if nombre}<p class="saludo">Hola, {nombre}!{#if pasos}<button class="saludo-link" onclick={() => (pasosAbierto = !pasosAbierto)} aria-expanded={pasosAbierto}>{pasosAbierto ? '▾' : '▸'} Aprendé a aprovechar la app al máximo</button>{/if}</p>{/if}

{#if pasos && pasosAbierto}
    <div class="pasos">
        <div class="pasos-top">
            <strong>Checklist de configuración</strong>
            <button class="pasos-cerrar" onclick={ocultarPasos} title="No mostrar más" aria-label="No mostrar más">✕</button>
        </div>
        <a href="/configuracion" class:hecho={pasos.categorias} onclick={() => setMeta('paso_categorias', '1')}>{pasos.categorias ? '✓' : '①'} Revisá y ajustá tus categorías</a>
        {#if pasos.instalar}
            <span class="paso-done">✓ Instalá la app</span>
        {:else}
            <button class="paso-btn" onclick={instalarDesdeChecklist}>② Instalá la app en tu teléfono</button>
        {/if}
        <a href="/suscripciones" class:hecho={pasos.fijos}>{pasos.fijos ? '✓' : '③'} Cargá tus gastos recurrentes</a>
        <a href="/ingresos-fijos" class:hecho={pasos.ingresosFijos}>{pasos.ingresosFijos ? '✓' : '④'} Cargá tus ingresos recurrentes</a>
        <a href="/configuracion" class:hecho={pasos.tarjeta} onclick={() => setMeta('paso_tarjeta', '1')}>{pasos.tarjeta ? '✓' : '⑤'} Renombrá o elegí tu tarjeta (o agregá las tuyas)</a>
    </div>
{/if}

<div class="accesos">
    <a href="/gastos" class="btn btn-primary">Gastos</a>
    <a href="/carga-ingresos" class="btn btn-primary" class:pulsa={pasos !== null && !pasos.ingreso}>Ingresos</a>
    <a href="/credito" class="btn btn-secondary">Crédito</a>
</div>

<div class="sel">
    <span class="sel-label">{modo === 'calendario' ? 'Mes' : 'Período de sueldo'}:</span>
    <div class="periodo-nav">
        <button class="nav-flecha" onclick={() => vecino(-1)} disabled={!primerPeriodo || periodo <= primerPeriodo} aria-label="Período anterior" title="Período anterior">‹</button>
        <span class="periodo-medio">
            <button class="periodo-texto" onclick={abrirDropdown} title="Tocar para elegir otro período">{labelPeriodo(periodo)}</button>
            <input type="month" bind:this={mesInput} bind:value={periodo} onchange={() => seleccionar(periodo)} class="periodo-overlay" aria-label="Elegir período" />
        </span>
        <button class="nav-flecha" onclick={() => vecino(1)} disabled={!ultimoPeriodo || periodo >= ultimoPeriodo} aria-label="Período siguiente" title="Período siguiente">›</button>
    </div>
</div>
<p class="rango">
    {#if modo === 'calendario'}
        Gastos del <strong>{rango}</strong> (mes calendario, del 1 al último día).
    {:else}
        Gastos del <strong>{rango}</strong> (el período lo abre la fecha real de tu sueldo).
    {/if}
</p>

{#if cargando}
    <div class="disponible sk-panel">
        <div class="sk-row"><Skeleton w="150px" h="1rem" /><Skeleton w="130px" h="1.35rem" /></div>
    </div>
    <div class="deuda-panel sk-panel">
        <div class="sk-row"><Skeleton w="210px" h="1rem" /><Skeleton w="120px" h="1.35rem" /></div>
    </div>
    <div class="sk-accesos">
        <Skeleton w="50%" h="46px" radius="10px" />
        <Skeleton w="50%" h="46px" radius="10px" />
    </div>
{:else}

    <!-- ===== Ingreso disponible (Ítem 1) ===== -->
    <div class="disponible">
        <button class="disp-toggle" onclick={() => (detalleAbierto = !detalleAbierto)} aria-expanded={detalleAbierto} title="Ver/ocultar cómo se calcula">
            <span class="flecha">{detalleAbierto ? '▾' : '▸'}</span>
            <span class="disp-titulo">Ingreso disponible</span>
            <span class="disp-valor"><CountUp value={ingresoDisponible} format={peso} /></span>
        </button>
        {#if detalleAbierto}
            <table class="disp-tabla disp-detalle">
                <tbody>
                    <tr><td>Ingresos totales del mes</td><td class="num">{peso(ingresosMes)}</td></tr>
                    {#if ingresoUsdMes > 0}<tr class="disp-usd"><td>Ingreso del mes (USD)</td><td class="num">{usd(ingresoUsdMes)}</td></tr>{/if}
                    <tr><td>− Pago de Tarjetas del Mes Corriente</td><td class="num">{creditoMes ? '−' + peso(creditoMes) : peso(0)}</td></tr>
                    <tr><td>+ Reservado para el Mes Corriente</td><td class="num">{reservaMes ? '+' + peso(reservaMes) : peso(0)}</td></tr>
                    {#if creditoMesUsd > 0}<tr class="disp-usd"><td>Cuotas en dólares (se pagan aparte)</td><td class="num">{usd(creditoMesUsd)}</td></tr>{/if}
                </tbody>
            </table>
            <p class="disp-nota">La reserva se edita por mes en <a href="/credito">Crédito</a>.</p>
        {/if}
        <div class="disp-pie">
            {#if totales.presup > 0}
                <div class="disp-linea {semColor(totales.presup)}"
                    title="Verde: entra en tu ingreso disponible · Amarillo: entre el disponible y tu ingreso total · Rojo: supera tu ingreso total">
                    <span>Presupuesto</span><strong><CountUp value={totales.presup} format={peso} /></strong>
                </div>
            {/if}
            <button class="disp-linea disp-linea-btn {gastoColor()}" onclick={() => (gastoAbierto = !gastoAbierto)} aria-expanded={gastoAbierto}
                title={totales.presup > 0 ? 'Gasto vs presupuesto (tocá para ver el desglose)' : 'Sin presupuesto: verde si entra en tu ingreso disponible · amarillo entre el disponible y el total · rojo si supera tu ingreso total (tocá para ver el desglose)'}>
                <span><span class="flecha-mini">{gastoAbierto ? '▾' : '▸'}</span> Gasto del mes (ARS)</span><strong><CountUp value={totales.real} format={peso} /></strong>
            </button>
            {#if gastoAbierto}
                <table class="disp-tabla disp-detalle">
                    <tbody>
                        <tr><td>Gasto real</td><td class="num">{peso(gastoRealMes)}</td></tr>
                        <tr><td>{nombreAhorro}</td><td class="num">{peso(ahorroMes)}</td></tr>
                    </tbody>
                </table>
            {/if}
            {#if gastoUsdMes > 0}
                <div class="disp-linea disp-usdrow"><span>Gasto del mes (USD)</span><strong>{usd(gastoUsdMes)}</strong></div>
            {/if}
            {#if creditoMesUsd > 0}
                <div class="disp-linea disp-usdrow"><span>Cuotas en dólares (aparte)</span><strong>{usd(creditoMesUsd)}</strong></div>
            {/if}
        </div>
    </div>

    <!-- ===== Crédito del mes que viene (Ítem 2, lectura pura) ===== -->
    <div class="deuda-panel" class:ok={descubierto <= 0} class:warn={descubierto > 0}>
        <button class="disp-toggle" onclick={() => (deudaAbierto = !deudaAbierto)} aria-expanded={deudaAbierto} title="Ver/ocultar el detalle">
            <span class="flecha">{deudaAbierto ? '▾' : '▸'}</span>
            <span class="disp-titulo">Crédito Neto del Mes Siguiente</span>
            <span class="disp-valor" class:alta={deudaAlta}><span class="dv-ars"><CountUp value={descubierto} format={peso} /></span>{#if deudaSigUsd > 0}<span class="dv-usd">{usd(deudaSigUsd)}</span>{/if}</span>
        </button>
        {#if deudaAbierto}
            <table class="disp-tabla disp-detalle">
                <tbody>
                    <tr><td>Cuotas a pagar ({mesSigLabel})</td><td class="num">{peso(deudaSig)}{#if deudaSigUsd > 0}<div class="usd">{usd(deudaSigUsd)}</div>{/if}</td></tr>
                    <tr><td>− Reservado para mes siguiente</td><td class="num">{reservaSig ? '−' + peso(reservaSig) : peso(0)}</td></tr>
                    {#if deudaSigUsd > 0}<tr class="disp-usd"><td>Cuotas en dólares (se pagan aparte)</td><td class="num">{usd(deudaSigUsd)}</td></tr>{/if}
                </tbody>
            </table>
            <p class="disp-nota">Reservá plata para el pago de próximos vencimientos desde <a href="/credito">Crédito</a>.</p>
        {/if}
    </div>


    <div class="consol-head">
        <h2>Consolidado por categoría · en miles</h2>
    </div>
    <div class="tabla-scroll">
    <table class="consol">
        <thead><tr><th>Categoría</th><th>{labN2}</th><th>{labN1}</th><th>Presup.</th><th>{labN}</th></tr></thead>
        <tbody>
            {#each consolidado as c (c.cat)}
                <tr>
                    {#if c.esAhorro}
                        <td><strong>{c.cat}</strong>{#if metaAhorroMonto > 0}<span class="presubar {claseAhorro(c.real)}" aria-hidden="true"><i style="width:{Math.min(c.real / metaAhorroMonto, 1) * 100}%"></i></span>{/if}</td>
                        <td class="num">{pesoMil(c.n2)}</td><td class="num">{pesoMil(c.n1)}</td>
                        <td class="num">{metaAhorroMonto > 0 ? pesoMil(metaAhorroMonto) : '—'}</td>
                        <td class="num real {claseAhorro(c.real)}" title={tituloAhorro(c.real)}>{pesoMil(c.real)}</td>
                    {:else}
                        <td><strong>{c.cat}</strong>{#if c.presup > 0}<span class="presubar {claseEstado(c.estado)}" aria-hidden="true"><i style="width:{Math.min(c.real / c.presup, 1) * 100}%"></i></span>{/if}</td>
                        <td class="num">{pesoMil(c.n2)}</td><td class="num">{pesoMil(c.n1)}</td>
                        <td class="num">{pesoMil(c.presup)}</td>
                        <td class="num real {claseEstado(c.estado)}" title={c.estado}>{pesoMil(c.real)}</td>
                    {/if}
                </tr>
            {/each}
        </tbody>
        <tfoot>
            <tr><td><strong>Total general</strong></td>
                <td class="num">{pesoMil(totales.n2)}</td><td class="num">{pesoMil(totales.n1)}</td>
                <td class="num">{pesoMil(totales.presup)}</td><td class="num">{pesoMil(totales.real)}</td></tr>
        </tfoot>
    </table>
    </div>

    <h2>Detalle por subcategoría</h2>
    <div class="tabla-scroll">
    <table>
        <thead><tr><th>Subcategoría</th><th>{labN2}</th><th>{labN1}</th><th>Presup.</th><th>{labN}</th></tr></thead>
        <tbody>
            {#each grupos as g (g.cat)}
                <tr class="cat"><td colspan="5">{g.cat}</td></tr>
                {#each g.rows as f (f.scid ?? 'null')}
                    <tr>
                        <td class="ind">{f.nombre}</td>
                        <td class="num">{peso(f.n2)}</td>
                        <td class="num">{peso(f.n1)}</td>
                        <td class="num">
                            {#if f.scid == null}
                                —
                            {:else if f.autoPresup}
                                <span class="auto-presup" title="Definido por tus gastos recurrentes. Se edita en Gastos, tab Recurrente, no acá.">{formatNum(f.presup, 0)} <em>recurrente</em></span>
                            {:else}
                                <input class="presup" type="text" inputmode="decimal" use:soloNum value={f.presup ? formatNum(f.presup, 0) : ''} placeholder="—"
                                    onchange={(e) => guardarPresup(f.scid, e.currentTarget.value)} />
                            {/if}
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
    </div>
{/if}

<style>
    :global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
    .sel { font-size: 0.9rem; display: flex; gap: 8px; align-items: center; margin-bottom: 4px; flex-wrap: wrap; }
    .sel-label { color: var(--text-dim); }
    .periodo-nav { display: inline-flex; align-items: stretch; gap: 4px; }
    .nav-flecha { font-size: 1.2rem; line-height: 1; padding: 4px 12px; border: 1px solid var(--border); background: var(--surface); border-radius: 8px; cursor: pointer; color: var(--text); }
    .nav-flecha:disabled { opacity: 0.3; cursor: default; }
    .periodo-medio { position: relative; display: inline-flex; }
    .periodo-texto { font-size: 0.95rem; font-weight: 600; padding: 4px 12px; border: 1px solid var(--border); background: var(--surface); border-radius: 8px; cursor: pointer; color: var(--text); min-width: 120px; text-align: center; }
    /* El input month va encima del texto, transparente: el tap abre el picker
       nativo (dropdown), pero el usuario ve el texto formateado de abajo. */
    .periodo-overlay { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: 0; padding: 0; margin: 0; }
    .rango { font-size: 0.82rem; color: var(--text-dim); margin: 0 0 12px; }
    .saludo { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; font-family: var(--font-display); font-size: 1.15rem; color: var(--text); font-weight: 600; margin: 2px 0 14px; }
    .saludo-link { background: none; border: none; padding: 0; color: var(--accent); font-size: 0.84rem; font-weight: 600; cursor: pointer; font-family: system-ui, sans-serif; }
    .saludo-link:hover { text-decoration: underline; }
    .auto { font-size: 0.75rem; font-weight: 400; color: var(--text-dim); white-space: nowrap; }

    /* Tarjetas de resumen del período */

    /* Skeletons de carga (Home) */
    .sk-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .sk-accesos { display: flex; gap: 10px; margin-top: 8px; }
    /* Panel Ingreso disponible (borrador, pendiente de revisión) */
    .disponible {
        border: 1px solid transparent; border-left: 3px solid var(--accent);
        background: var(--surface); border-radius: 0 8px 8px 0; padding: 12px 14px; margin: 0 0 16px;
    }
    .disp-toggle { width: 100%; display: flex; align-items: baseline; gap: 8px; background: none; border: none; padding: 0 0 6px; cursor: pointer; color: var(--text); text-align: left; }
    .disp-toggle .flecha { color: var(--text-dim); font-size: 0.8rem; width: 12px; display: inline-block; }
    .disp-toggle .disp-titulo { font-family: var(--font-display); font-size: 0.74rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim); }
    .disp-toggle .disp-valor { margin-left: auto; font-family: var(--font-num); font-size: 1.35rem; font-weight: 300; color: var(--text); white-space: nowrap; }
    .disp-tabla { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
    .disp-tabla td { border: none !important; padding: 4px 2px; color: var(--text-dim); }
    .disp-tabla td.num { text-align: right; white-space: nowrap; }
    .disp-pie { display: flex; flex-direction: column; border-top: 1px solid var(--border); margin-top: 8px; }
    .disp-linea { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 7px 0 7px 20px; border-bottom: 1px solid var(--border); }
    .disp-linea:last-child { border-bottom: none; }
    .disp-linea span { font-family: var(--font-display); font-size: 0.74rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim); }
    .disp-linea strong { font-family: var(--font-num); font-size: 1.35rem; font-weight: 300; white-space: nowrap; }
    .disp-linea.ok strong { color: var(--pos); }
    .disp-linea.warn strong { color: var(--warn); }
    .disp-linea.bad strong { color: var(--neg); }
    .disp-nota { font-size: 0.76rem; color: var(--text-dim); margin: 8px 0 0; }
    .disp-nota a { color: var(--accent); }
    .deuda-panel { border: 1px solid transparent; border-left: 3px solid var(--text-dim); background: var(--surface); border-radius: 0 8px 8px 0; padding: 12px 14px; margin: 0 0 16px; }
    .deuda-panel.ok { border-left-color: var(--pos); }
    .deuda-panel.warn { border-left-color: var(--warn); }
    .deuda-panel.ok .disp-valor { color: var(--pos); }
    .deuda-panel .disp-valor.alta { color: var(--warn); }
    /* Credito neto: ARS y USD en lineas separadas, alineadas a la derecha */
    .deuda-panel .disp-valor { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.15; }

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
    .pasos .paso-btn { background: none; border: none; color: var(--accent); text-align: left; font-size: 0.88rem; padding: 0; cursor: pointer; font-family: inherit; }
    .pasos .paso-btn:hover { text-decoration: underline; }
    .pasos .paso-done { color: var(--pos); text-decoration: line-through; opacity: 0.75; font-size: 0.88rem; }

    h2 { font-size: 1.02rem; margin-top: 26px; border-left: 3px solid var(--accent); padding-left: 12px; }
    /* Título del consolidado + input de meta de ahorro en una sola fila. El
       "· en miles" ahora va dentro del h2 (mismo tamaño), no como label chico. */
    .consol-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .consol-head h2 { margin-top: 26px; }
    table { border-collapse: collapse; width: 100%; font-size: 0.85rem; margin-bottom: 8px; table-layout: fixed; }
    /* Brief 1: consolidado con tipografía más grande que el resto de las tablas,
       para legibilidad general de todas sus filas (no solo la de ahorro). */
    table.consol { font-size: 0.98rem; }
    table.consol th, table.consol td { padding: 7px 6px; }
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
    tr.cat td { background: none; font-family: var(--font-display); font-weight: 600; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim); padding-top: 14px; white-space: normal; overflow: visible; }
    /* Mini-barra de presupuesto por categoria (solo visual: real / presupuesto) */
    .presubar { display: block; height: 3px; background: var(--surface-2); border-radius: 2px; margin-top: 5px; max-width: 140px; }
    .presubar i { display: block; height: 100%; border-radius: 2px; background: var(--text-dim); }
    .presubar.ok i { background: var(--pos); }
    .presubar.warn i { background: var(--warn); }
    .presubar.bad i { background: var(--neg); }
    input.presup { width: 100%; max-width: 90px; text-align: right; padding: 3px 4px; box-sizing: border-box; }
    .auto-presup { font-size: 0.82rem; color: var(--text-dim); white-space: nowrap; }
    .auto-presup em { font-style: normal; font-size: 0.65rem; color: var(--accent); border: 1px solid var(--accent); border-radius: 4px; padding: 0 4px; margin-left: 3px; }
    td.real { font-weight: 600; }
    td.real.ok { color: var(--pos); }
    td.real.warn { color: var(--warn); }
    td.real.bad { color: var(--neg); }
    td.real.none { color: inherit; font-weight: 400; }
    tfoot td { border-top: 2px solid var(--border); font-weight: 600; }
    .accesos { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin: 4px 0 14px; }
    /* Halo que respira sobre "Cargar ingreso" hasta el primer ingreso (se apaga
       solo al cargarlo o al cerrar el checklist de primeros pasos). Solo visual. */
    .accesos a.pulsa { animation: halo-ingreso 2s ease-in-out infinite; }
    @keyframes halo-ingreso {
        0%, 100% { box-shadow: 0 0 0 0 rgba(91, 157, 255, 0); }
        50% { box-shadow: 0 0 14px 2px rgba(91, 157, 255, 0.55); }
    }
    @media (prefers-reduced-motion: reduce) { .accesos a.pulsa { animation: none; } }
    .usd { color: var(--text-dim); font-size: 0.85em; }
    .disp-usd td { color: var(--text-dim); }
    .disp-usdrow span, .disp-usdrow strong { color: var(--text-dim); font-weight: 600; }
    .disp-usdrow strong { font-size: 0.9rem; font-weight: 400; }
    /* "Gasto total del mes" como toggle: mismo look de .disp-linea, pero clickeable
       (reset de estilos de <button>) y con flechita, igual patrón que "Ingreso
       disponible" de arriba. El detalle (Gasto real / Ahorro) sale en .disp-tabla,
       sin semáforo por fila — igual criterio visual que el detalle de Ingreso disponible. */
    .disp-linea-btn { width: 100%; background: none; border: none; padding: 7px 0; font: inherit; color: inherit; cursor: pointer; text-align: left; }
    .disp-linea.disp-linea-btn { padding-left: 0; }
    .flecha-mini { color: var(--text-dim); font-size: 0.75rem; width: 12px; display: inline-block; margin-right: 8px; letter-spacing: 0; }
</style>
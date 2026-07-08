<script lang="ts">
    import { onMount } from 'svelte';
    import { query } from '$lib/db/client';
    import { fmtFecha, hoyISO, mesActual, parseNum, formatNum, soloNum } from '$lib/format';
    import Guia from '$lib/Guia.svelte';

    let categorias = $state<any[]>([]);
    let subcategorias = $state<any[]>([]);
    let tarjetasCredito = $state<any[]>([]);
    let detallesExistentes = $state<string[]>([]);
    let ultimos = $state<any[]>([]);
    let filtroCategoria = $state<number | null>(null);
    let filtroDesde = $state('');
    let filtroHasta = $state('');
    let filtroTexto = $state('');

    let fecha = $state(hoyISO());
    let monto = $state('');
    let moneda = $state('ARS');
    let categoriaId = $state<number | null>(null);
    let detalle = $state('');
    let medio = $state<'debito' | 'credito'>('debito');
    let tarjetaId = $state<number | null>(null);
    let cuotas = $state(1);
    let mesInicio = $state(mesActual());

    let subcatDerivada = $state<string | null>(null);
    let detalleNuevo = $state(false);
    let modoSubcat = $state<'existente' | 'nueva'>('existente');
    let subcatSelId = $state<number | null>(null);
    let subcatNuevaNombre = $state('');

    let editandoId = $state<number | null>(null);
    let mensaje = $state('');

    async function cargarBase() {
        categorias = await query('SELECT id, nombre FROM categoria WHERE perfil_id=1 AND activa=1 ORDER BY nombre');
        subcategorias = await query('SELECT id, nombre FROM subcategoria WHERE perfil_id=1 AND activa=1 ORDER BY nombre');
        tarjetasCredito = await query("SELECT id, nombre FROM tarjeta WHERE perfil_id=1 AND tipo='credito' AND activa=1 ORDER BY nombre");
        const d = await query('SELECT DISTINCT detalle FROM mapeo_detalle WHERE perfil_id=1 ORDER BY detalle');
        detallesExistentes = d.map((x: any) => x.detalle);
        // La lista de últimos gastos la carga el $effect de filtros (corre al montar).
    }

    async function cargarUltimos() {
        let sql = `
            SELECT g.id, g.fecha, g.monto, g.moneda, g.categoria_id, c.nombre AS categoria, g.detalle, g.medio,
                   g.subcategoria_id, COALESCE(s.nombre, sm.nombre) AS subcategoria,
                   g.tarjeta_id, t.nombre AS tarjeta, g.cuotas, g.mes_inicio_pago
            FROM gasto g
            JOIN categoria c ON c.id = g.categoria_id
            LEFT JOIN subcategoria s ON s.id = g.subcategoria_id
            LEFT JOIN mapeo_detalle md ON md.perfil_id = g.perfil_id AND md.detalle = g.detalle
            LEFT JOIN subcategoria sm ON sm.id = md.subcategoria_id
            LEFT JOIN tarjeta t ON t.id = g.tarjeta_id
            WHERE g.perfil_id = 1
        `;

        let params: any[] = [];

        if (filtroCategoria) {
            sql += " AND g.categoria_id = ?";
            params.push(filtroCategoria);
        }
        if (filtroDesde) {
            sql += " AND g.fecha >= ?";
            params.push(filtroDesde);
        }
        if (filtroHasta) {
            sql += " AND g.fecha <= ?";
            params.push(filtroHasta);
        }
        if (filtroTexto.trim()) {
            sql += " AND g.detalle LIKE ?";
            params.push('%' + filtroTexto.trim() + '%');
        }

        sql += " ORDER BY g.fecha DESC, g.id DESC";
        // Sin filtro de fechas, limito a los últimos 40 para no listar toda la base.
        // Con filtro de fechas activo, muestro el rango completo (el filtro ya acota).
        if (!filtroDesde && !filtroHasta) {
            sql += " LIMIT 40";
        }

        ultimos = await query(sql, params);
    }

    onMount(cargarBase);

    // Mes de pago por defecto = mes SIGUIENTE al de la fecha del gasto. Solo en
    // alta (al editar respeta lo cargado). Se reajusta si cambiás la fecha.
    function mesSiguiente(f: string): string {
        const [y, m] = f.slice(0, 7).split('-').map(Number);
        const d = new Date(y, m, 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    $effect(() => {
        if (editandoId === null) mesInicio = mesSiguiente(fecha);
    });

    // Reactividad: al cambiar cualquier filtro, se recarga la lista con un
    // debounce corto (clave para el buscador de texto: 1 consulta al dejar de
    // tipear, no 1 por tecla). También corre al montar: hace la carga inicial.
    $effect(() => {
        // dependencias explícitas
        filtroCategoria; filtroDesde; filtroHasta; filtroTexto;
        const timer = setTimeout(cargarUltimos, 250);
        return () => clearTimeout(timer);
    });

    // Busca la subcategoría del detalle con debounce: espera 300ms a que dejes
    // de tipear (1 consulta en vez de 1 por tecla) y descarta respuestas viejas.
    $effect(() => {
        const d = detalle.trim();
        if (!d) { subcatDerivada = null; detalleNuevo = false; return; }
        const timer = setTimeout(async () => {
            const r = (await query('SELECT s.nombre FROM mapeo_detalle m JOIN subcategoria s ON s.id=m.subcategoria_id WHERE m.perfil_id=1 AND m.detalle=?', [d])) as any[];
            if (d !== detalle.trim()) return; // el usuario siguió tipeando: respuesta vieja
            if (r.length) { subcatDerivada = r[0].nombre; detalleNuevo = false; }
            else { subcatDerivada = null; detalleNuevo = true; }
        }, 300);
        return () => clearTimeout(timer);
    });

    // Al elegir "Crear nueva", sugiere el detalle como nombre de subcategoría.
    // Solo prellena si el campo está vacío, para no pisar lo que el usuario edite.
    function elegirCrearNueva() {
        modoSubcat = 'nueva';
        if (!subcatNuevaNombre.trim()) {
            subcatNuevaNombre = detalle.trim();
        }
    }

    function limpiarFiltros() {
        filtroCategoria = null;
        filtroDesde = '';
        filtroHasta = '';
        filtroTexto = '';
    }

    function resetForm() {
        editandoId = null;
        monto = ''; detalle = ''; subcatSelId = null; subcatNuevaNombre = ''; modoSubcat = 'existente';
        medio = 'debito'; tarjetaId = null; cuotas = 1;
        // La fecha NO se resetea: si cargaste o editaste un gasto, la próxima
        // carga arranca con esa misma fecha. Al abrir la página, arranca en hoy.
        mesInicio = mesSiguiente(fecha);
        moneda = 'ARS'; categoriaId = null;
    }

    function editar(g: any) {
        editandoId = g.id;
        fecha = g.fecha;
        monto = formatNum(g.monto);
        moneda = g.moneda;
        categoriaId = g.categoria_id;
        detalle = g.detalle;
        medio = g.medio;
        tarjetaId = g.tarjeta_id;
        cuotas = g.cuotas ?? 1;
        mesInicio = g.mes_inicio_pago ? g.mes_inicio_pago.slice(0, 7) : mesActual();
        mensaje = '';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function eliminar(id: number) {
        if (!confirm('¿Eliminar este gasto? No se puede deshacer.')) return;
        // Si el gasto nació de una suscripción disparada, borro primero esa
        // anotación: la suscripción vuelve a figurar como pendiente ese mes.
        await query('DELETE FROM suscripcion_registro WHERE gasto_id=?', [id]);
        await query('DELETE FROM gasto WHERE id=? AND perfil_id=1', [id]);
        if (editandoId === id) resetForm();
        await cargarUltimos();
    }

    async function guardar() {
        mensaje = '';
        const m = parseNum(monto);
        if (!fecha) return (mensaje = 'Falta la fecha');
        if (!Number.isFinite(m) || m <= 0) return (mensaje = 'El monto debe ser mayor a 0');
        if (!categoriaId) return (mensaje = 'Elegí una categoría');
        if (!detalle.trim()) return (mensaje = 'Falta el detalle');
        if (medio === 'credito') {
            if (!tarjetaId) return (mensaje = 'Elegí la tarjeta');
            if (!cuotas || cuotas < 1) return (mensaje = 'Cuotas inválidas');
            if (!mesInicio) return (mensaje = 'Falta el mes de inicio de pago');
        }
        const dTrim = detalle.trim();
        try {
            if (detalleNuevo) {
                let subId: number | null = null;
                if (modoSubcat === 'nueva' && subcatNuevaNombre.trim()) {
                    const nom = subcatNuevaNombre.trim();
                    await query('INSERT OR IGNORE INTO subcategoria (perfil_id, nombre) VALUES (1, ?)', [nom]);
                    const r = await query('SELECT id FROM subcategoria WHERE perfil_id=1 AND nombre=?', [nom]);
                    subId = r[0].id;
                } else if (modoSubcat === 'existente' && subcatSelId) {
                    subId = subcatSelId;
                }
                if (subId) await query('INSERT OR IGNORE INTO mapeo_detalle (perfil_id, detalle, subcategoria_id) VALUES (1, ?, ?)', [dTrim, subId]);
            }

            if (editandoId) {
                if (medio === 'debito') {
                    await query('UPDATE gasto SET fecha=?, monto=?, moneda=?, categoria_id=?, detalle=?, medio=?, tarjeta_id=NULL, cuotas=1, mes_inicio_pago=NULL WHERE id=? AND perfil_id=1',
                        [fecha, m, moneda, categoriaId, dTrim, 'debito', editandoId]);
                } else {
                    await query('UPDATE gasto SET fecha=?, monto=?, moneda=?, categoria_id=?, detalle=?, medio=?, tarjeta_id=?, cuotas=?, mes_inicio_pago=? WHERE id=? AND perfil_id=1',
                        [fecha, m, moneda, categoriaId, dTrim, 'credito', tarjetaId, cuotas, mesInicio + '-01', editandoId]);
                }
                mensaje = 'Gasto actualizado ✅';
            } else {
                if (medio === 'debito') {
                    await query('INSERT INTO gasto (perfil_id,fecha,monto,moneda,categoria_id,detalle,medio,cuotas) VALUES (1,?,?,?,?,?,?,1)',
                        [fecha, m, moneda, categoriaId, dTrim, 'debito']);
                } else {
                    await query('INSERT INTO gasto (perfil_id,fecha,monto,moneda,categoria_id,detalle,medio,tarjeta_id,cuotas,mes_inicio_pago) VALUES (1,?,?,?,?,?,?,?,?,?)',
                        [fecha, m, moneda, categoriaId, dTrim, 'credito', tarjetaId, cuotas, mesInicio + '-01']);
                }
                mensaje = 'Gasto guardado ✅';
            }
            resetForm();
            await cargarBase();
            await cargarUltimos();
        } catch (e: any) {
            mensaje = 'Error: ' + (e?.message ?? String(e));
        }
    }

    const fmt = (n: number, mon: string) => (mon === 'USD' ? 'U$D ' : '$') + Number(n).toLocaleString('es-AR');

    // Texto del rango activo para mostrar arriba de la lista
    const rangoTexto = $derived(
        !filtroDesde && !filtroHasta ? 'Últimos 40 gastos'
        : filtroDesde && filtroHasta ? `Del ${fmtFecha(filtroDesde)} al ${fmtFecha(filtroHasta)}`
        : filtroDesde ? `Desde ${fmtFecha(filtroDesde)} hasta hoy`
        : `Desde el inicio hasta ${fmtFecha(filtroHasta)}`
    );

    const hayFiltro = $derived(!!filtroCategoria || !!filtroDesde || !!filtroHasta || !!filtroTexto.trim());
</script>

<div class="titulo-guia">
    <h1>{editandoId ? 'Editar gasto' : 'Cargar gasto'}</h1>
    <Guia clave="gastos" texto="Elegí categoría y escribí un detalle ('Pizza', 'Super'); la primera vez le asignás subcategoría y después se clasifica solo. El gasto se cuenta entero el día que lo hacés —también el crédito—; si pagaste en cuotas, indicá tarjeta y cuotas y la app reparte el vencimiento mes a mes." verMas />
</div>
<a href="/" class="btn-volver">← Volver a Cuenta Corriente</a>

<div class="form">
    {#if editandoId}<p class="editando">✏ Editando gasto #{editandoId} · <button class="link" onclick={resetForm}>cancelar</button></p>{/if}
    <label>Fecha<input type="date" bind:value={fecha} /></label>
    <label>Monto<input type="text" inputmode="decimal" use:soloNum bind:value={monto} placeholder="0,00" /></label>
    <label>Moneda
        <select bind:value={moneda}><option value="ARS">ARS</option><option value="USD">USD</option></select>
    </label>
    <label>Categoría
        <select bind:value={categoriaId}>
            <option value={null} disabled>Elegir…</option>
            {#each categorias as c (c.id)}<option value={c.id}>{c.nombre}</option>{/each}
        </select>
    </label>
    <label>Detalle
        <input list="detalles" bind:value={detalle} placeholder="Ej: Pizza, Auto, Kiosco…" />
        <datalist id="detalles">{#each detallesExistentes as d (d)}<option value={d}></option>{/each}</datalist>
    </label>

    {#if detalle.trim()}
        {#if !detalleNuevo}
            <p class="hint">Subcategoría: <strong>{subcatDerivada}</strong></p>
        {:else}
            <div class="nuevo">
                <p class="hint">Detalle nuevo. Asignale una subcategoría:</p>
                <div class="medio">
                    <button type="button" class:activo={modoSubcat === 'existente'} onclick={() => (modoSubcat = 'existente')}>Usar existente</button>
                    <button type="button" class:activo={modoSubcat === 'nueva'} onclick={elegirCrearNueva}>Crear nueva</button>
                </div>
                {#if modoSubcat === 'existente'}
                    <select bind:value={subcatSelId}>
                        <option value={null} disabled>Elegir subcategoría…</option>
                        {#each subcategorias as s (s.id)}<option value={s.id}>{s.nombre}</option>{/each}
                    </select>
                {:else}
                    <input bind:value={subcatNuevaNombre} placeholder="Nombre de la nueva subcategoría" />
                {/if}
            </div>
        {/if}
    {/if}

    <div class="medio">
        <button type="button" class:activo={medio === 'debito'} onclick={() => (medio = 'debito')}>Débito</button>
        <button type="button" class:activo={medio === 'credito'} onclick={() => (medio = 'credito')}>Crédito</button>
    </div>

    {#if medio === 'credito'}
        {#if tarjetasCredito.length === 0}
            <p class="aviso-tarjeta">Para ingresar un gasto en tarjeta de crédito debe cargar primero una desde la sección Configuración.</p>
        {:else}
            <label>Tarjeta
                <select bind:value={tarjetaId}>
                    <option value={null} disabled>Elegir…</option>
                    {#each tarjetasCredito as t (t.id)}<option value={t.id}>{t.nombre}</option>{/each}
                </select>
            </label>
            <label>Cuotas<input type="number" min="1" bind:value={cuotas} /></label>
            <label>Mes inicio de pago<input type="month" bind:value={mesInicio} /></label>
        {/if}
    {/if}

    <button class="btn btn-primary" onclick={guardar}>{editandoId ? 'Actualizar gasto' : 'Guardar gasto'}</button>
    {#if mensaje}<p class="msg">{mensaje}</p>{/if}
</div>

<h2>Últimos gastos</h2>
<div class="filtros">
    <label>Desde<input type="date" bind:value={filtroDesde} /></label>
    <label>Hasta<input type="date" bind:value={filtroHasta} /></label>
    <label>Categoría
        <select bind:value={filtroCategoria}>
            <option value={null}>Todas</option>
            {#each categorias as c (c.id)}<option value={c.id}>{c.nombre}</option>{/each}
        </select>
    </label>
    <label>Buscar
        <input type="search" bind:value={filtroTexto} placeholder="Ej: super, farmacia…" />
    </label>
    {#if hayFiltro}<button class="btn btn-secondary" onclick={limpiarFiltros}>Limpiar</button>{/if}
</div>
<p class="rango">{rangoTexto}</p>

<div class="fichas">
    {#each ultimos as g (g.id)}
        <div class="ficha" class:editrow={editandoId === g.id}>
            <div class="ficha-top">
                <span class="ficha-detalle">{g.detalle}</span>
                <span class="ficha-monto">{fmt(g.monto, g.moneda)}</span>
            </div>
            <div class="ficha-bot">
                <span class="ficha-meta">{fmtFecha(g.fecha)} · {g.categoria} · {g.medio}{g.medio === 'credito' && g.cuotas > 1 ? ` ${g.cuotas}c` : ''}{g.tarjeta ? ` · ${g.tarjeta}` : ''}</span>
                <span class="ficha-acc">
                    <button aria-label="Editar" class="lapiz" onclick={() => editar(g)} title="Editar">✏</button>
                    <button aria-label="Eliminar" class="del" onclick={() => eliminar(g.id)} title="Eliminar">✕</button>
                </span>
            </div>
        </div>
    {/each}
    {#if ultimos.length === 0}<p class="vacio">No hay gastos para los filtros seleccionados.</p>{/if}
</div>

<style>
    :global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
    label { display: flex; flex-direction: column; font-size: 0.85rem; color: var(--text-dim); gap: 3px; }
    input, select { padding: 7px; font-size: 1rem; }
    .medio { display: flex; gap: 8px; }
    .nuevo { border: 1px dashed var(--warn); background: rgba(251, 191, 36, 0.08); padding: 10px; border-radius: 6px; display: flex; flex-direction: column; gap: 8px; }
    .aviso-tarjeta { font-size: 0.85rem; color: var(--warn); background: rgba(251, 191, 36, 0.1); border: 1px dashed var(--warn); padding: 10px; border-radius: 6px; margin: 0; line-height: 1.4; }
    .hint { font-size: 0.85rem; color: var(--text-dim); margin: 0; }
    .msg { font-weight: 600; color: var(--text); }
    .editando { font-size: 0.85rem; color: var(--warn); background: rgba(251, 191, 36, 0.1); padding: 6px 10px; border-radius: 6px; margin: 0; }

    /* Filtros de la lista */
    .filtros { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end; margin: 8px 0; }
    .filtros label { flex: 1 1 140px; min-width: 0; }
    /* El input ocupa el 100% de su columna: los campos de fecha tienen ancho
       mínimo propio y sin esto desbordan y se superponen en el celular. */
    .filtros input, .filtros select { width: 100%; min-width: 0; box-sizing: border-box; }
    .rango { font-size: 0.8rem; color: var(--text-dim); margin: 0 0 8px; font-weight: 600; }

    /* Fichas de últimos gastos */
    .fichas { display: flex; flex-direction: column; gap: 8px; }
    .ficha { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 10px 12px; }
    .ficha.editrow { border-color: var(--accent); background: rgba(91, 157, 255, 0.08); }
    .ficha-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
    .ficha-detalle { font-weight: 600; font-size: 0.95rem; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ficha-monto { font-weight: 700; white-space: nowrap; flex-shrink: 0; }
    .ficha-bot { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 4px; }
    .ficha-meta { font-size: 0.78rem; color: var(--text-dim); line-height: 1.35; }
    .ficha-acc { white-space: nowrap; flex-shrink: 0; }
    .vacio { color: var(--text-dim); font-style: italic; }
</style>
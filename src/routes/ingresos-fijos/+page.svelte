<script lang="ts">
	import { onMount } from 'svelte';
	import { query, queryBatch } from '$lib/db/client';
	import { mesActual, hoyISO, parseNum, formatNum, soloNum, fechaCobroDefault, pesos as peso, montoAGuardar, mesCorto } from '$lib/format';
	import { periodoRegla, periodoActivoCC, cargarModo, diaCobroActivo, ordenDia, addMonths, type ModoPeriodo } from '$lib/periodo';
	import Guia from '$lib/Guia.svelte';
	import TabsCorrRec from '$lib/TabsCorrRec.svelte';
	import { Toast } from '$lib/toast.svelte';

	// Arranca en el período activo de Cuenta Corriente (si venís de la Home); si no,
	// en el mes actual. Solo default inicial; el cambio acá no vuelve a la Home.
	let periodo = $state(periodoActivoCC() ?? mesActual());
	// Selector de período alineado al patrón de la Home: flechas + dropdown nativo
	// superpuesto (Brief H / B6 — antes era un <input type="month"> suelto).
	let mesInput: HTMLInputElement | undefined = $state();
	function vecino(dir: -1 | 1) { periodo = addMonths(periodo, dir); cargar(); }
	function abrirDropdown() { try { (mesInput as any)?.showPicker(); } catch { mesInput?.focus(); } }

	let fijos = $state<any[]>([]);
	let modo = $state<ModoPeriodo>('sueldo');
	// Día de cobro que ancla la rotación de la lista (solo modo sueldo con ingreso
	// principal cargado). null = orden crudo 1→31. El día guardado es día calendario
	// real (1-31) en ambos modos.
	let cobroDia = $state<number | null>(null);
	const OPCIONES_DIA = Array.from({ length: 31 }, (_, i) => i + 1);
	let registradas = $state<Record<number, boolean>>({});
	let fijoMesARS = $state(0);   // total de ingresos fijos activos del mes, en ARS (USD al MEP)
	let dolar = $state(0);

	let registrando = $state<number | null>(null);
	let dMonto = $state('');
	// Monto del fijo tal cual (precisión completa) al abrir el registro del mes —
	// ver montoAGuardar (Brief H / B1): el prefill ahora se redondea a 0 decimales.
	let dMontoOriginal = $state<number | null>(null);
	let dFecha = $state('');
	// Período del disparo: se recomienda con la regla del veinte sobre la fecha de
	// cobro, pero es editable (la decisión final es del usuario). dPeriodoTocado
	// evita pisar una edición manual al cambiar la fecha.
	let dPeriodo = $state('');
	let dPeriodoTocado = $state(false);

	// Form unificado (alta + edicion). editId null = alta, numero = edicion.
	let editId = $state<number | null>(null);
	let formAbierto = $state(false); // panel de alta/edicion colapsable (solo UI)
	let fNombre = $state('');
	let fDetalle = $state('');
	let fMonto = $state('');
	// Monto original del fijo (precisión completa) al abrir su edición — ver
	// montoAGuardar (Brief H / B1): el prefill ahora se redondea a 0 decimales.
	let fMontoOriginal = $state<number | null>(null);
	let fMoneda = $state('ARS');
	let fCategoria = $state<'' | 'Ingreso Principal' | 'Ingresos Secundarios' | 'Otros'>('');
	let fTipo = $state<'Sueldo' | 'Aciclico'>('Sueldo');
	let fDiaEsperado = $state(''); // '' = sin especificar -> NULL

	const toast = new Toast();
	const editando = $derived(editId !== null);

	// Orden de presentación: activos primero, rotados por día de cobro (ordenDia),
	// los sin-día al final; inactivos al fondo. Rotación en JS porque el día de cobro
	// es runtime. Mismo patrón que Gastos Fijos.
	const ordenadas = $derived.by(() =>
		[...fijos].sort((a, b) => {
			if (a.activa !== b.activa) return b.activa - a.activa;
			const ka = ordenDia(a.dia_esperado, cobroDia), kb = ordenDia(b.dia_esperado, cobroDia);
			if (ka !== kb) return ka - kb;
			return String(a.nombre).localeCompare(String(b.nombre), 'es');
		})
	);

	// Lista plana con separadores tenues: "Sin día estimado" antes del primer activo
	// sin día, e "Inactivos" antes del primer pausado (el orden pone activos primero,
	// así que sin ese segundo corte un inactivo CON día quedaría colgado debajo de
	// "Sin día estimado"). Mismo patrón que Gastos Fijos.
	const filas = $derived.by(() => {
		const out: { sep?: string; s?: any }[] = [];
		let sepSinDia = false, sepInactivos = false;
		for (const s of ordenadas) {
			if (!s.activa) {
				if (!sepInactivos) { out.push({ sep: 'Inactivos' }); sepInactivos = true; }
			} else if (s.dia_esperado == null && !sepSinDia) {
				out.push({ sep: 'Sin día estimado' });
				sepSinDia = true;
			}
			out.push({ s });
		}
		return out;
	});

	const catLabel = (c: string) =>
		c === 'Ingreso Principal' ? 'Principal' : c === 'Ingresos Secundarios' ? 'Secundarios' : 'Otros';
	const tipoLabel = (t: string) => (t === 'Sueldo' ? 'Regular' : 'Extraordinario');

	// MEP de referencia del periodo: cotizacion del primer dia del mes corriente
	// (ancla deterministica, igual que en Gastos Fijos).
	async function mepDelPeriodo(): Promise<number> {
		const r = (await query("SELECT valor FROM cotizacion_dolar WHERE perfil_id=1 AND casa='bolsa' AND fecha <= ? ORDER BY fecha DESC LIMIT 1", [mesActual() + '-01'])) as any[];
		return r[0]?.valor ?? 1;
	}

	async function cargar() {
		modo = await cargarModo();
		// Día de cobro para rotar la lista: solo en modo sueldo (en calendario no rota).
		cobroDia = modo === 'sueldo' ? await diaCobroActivo() : null;
		fijos = (await query(`
			SELECT id, nombre, detalle, monto, moneda, categoria, tipo, activa, dia_esperado
			FROM ingreso_fijo WHERE perfil_id=1
			ORDER BY nombre`)) as any[];

		const reg = (await query('SELECT ingreso_fijo_id FROM ingreso_fijo_registro WHERE periodo=?', [periodo])) as any[];
		const r: Record<number, boolean> = {};
		for (const x of reg) r[x.ingreso_fijo_id] = true;
		// El SUELDO (Ingreso Principal Regular) en modo sueldo evalúa su "Registrado"
		// contra periodoRegla(hoy) — la regla del 20 — no contra el mes seleccionado:
		// rompe el deadlock (registrado el sueldo del período, el período no avanza hasta
		// disparar el siguiente sueldo). Del 5 al 19 mapea al mes actual (registrado); a
		// partir del 20 mapea al mes siguiente (no registrado → disparable).
		if (modo === 'sueldo') {
			const perSueldo = periodoRegla(hoyISO(), 'Ingreso Principal');
			const sueldos = fijos.filter((s: any) => s.categoria === 'Ingreso Principal' && s.tipo === 'Sueldo');
			if (sueldos.length) {
				const ids = sueldos.map((s: any) => s.id);
				const rs = (await query(
					`SELECT ingreso_fijo_id FROM ingreso_fijo_registro WHERE periodo=? AND ingreso_fijo_id IN (${ids.map(() => '?').join(',')})`,
					[perSueldo, ...ids]
				)) as any[];
				const regS = new Set(rs.map((x: any) => x.ingreso_fijo_id));
				for (const s of sueldos) r[s.id] = regS.has(s.id);
			}
		}
		registradas = r;

		dolar = await mepDelPeriodo();
		fijoMesARS = fijos
			.filter((s: any) => s.activa)
			.reduce((t: number, s: any) => t + (s.moneda === 'USD' ? s.monto * dolar : s.monto), 0);
	}

	onMount(cargar);

	function resetForm() {
		editId = null;
		fNombre = '';
		fDetalle = '';
		fMonto = '';
		fMontoOriginal = null;
		fMoneda = 'ARS';
		fCategoria = '';   // arranca vacía: obligatoria, se elige a mano
		fTipo = 'Sueldo';
		fDiaEsperado = '';
	}

	function iniciarEdit(s: any) {
		editId = s.id;
		fNombre = s.nombre;
		fDetalle = s.detalle ?? '';
		fMonto = formatNum(s.monto, 0);
		fMontoOriginal = s.monto;
		fMoneda = s.moneda;
		fCategoria = s.categoria;
		fTipo = s.tipo === 'Aciclico' ? 'Aciclico' : 'Sueldo';
		fDiaEsperado = s.dia_esperado != null ? String(s.dia_esperado) : '';
		toast.limpiar();
		formAbierto = true;
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	async function guardar() {
		toast.limpiar();
		const m = montoAGuardar(fMonto, fMontoOriginal);
		if (!fNombre.trim()) return toast.error('Falta el nombre');
		if (!Number.isFinite(m) || m <= 0) return toast.error('Monto inválido');
		if (!fCategoria) return toast.error('Elegí categoría');
		const detalle = fDetalle.trim() || null;
		const dia = fDiaEsperado ? Number(fDiaEsperado) : null;
		try {
			if (editId) {
				await query('UPDATE ingreso_fijo SET nombre=?, detalle=?, monto=?, moneda=?, categoria=?, tipo=?, dia_esperado=? WHERE id=? AND perfil_id=1',
					[fNombre.trim(), detalle, m, fMoneda, fCategoria, fTipo, dia, editId]);
				toast.exito('Ingreso recurrente actualizado ✅');
			} else {
				await query('INSERT INTO ingreso_fijo (perfil_id,nombre,detalle,monto,moneda,categoria,tipo,dia_esperado) VALUES (1,?,?,?,?,?,?,?)',
					[fNombre.trim(), detalle, m, fMoneda, fCategoria, fTipo, dia]);
				toast.exito('Ingreso recurrente agregado ✅');
			}
			resetForm();
			await cargar();
		} catch (e: any) {
			toast.errorTecnico(e);
		}
	}

	async function eliminar(s: any) {
		if (!confirm(`¿Eliminar el ingreso recurrente "${s.nombre}"? (no borra los ingresos ya registrados)`)) return;
		await query('DELETE FROM ingreso_fijo_registro WHERE ingreso_fijo_id=?', [s.id]);
		await query('DELETE FROM ingreso_fijo WHERE id=? AND perfil_id=1', [s.id]);
		if (editId === s.id) resetForm();
		await cargar();
	}

	function iniciarRegistro(s: any) {
		registrando = s.id;
		dMonto = formatNum(s.monto, 0);
		dMontoOriginal = s.monto;
		// El sueldo (Ingreso Principal Regular) en modo sueldo arranca con fecha HOY, así
		// la regla del 20 recomienda el período correcto (el que abre el corte nuevo). El
		// resto arranca con la fecha de cobro por defecto del mes seleccionado.
		const esSueldo = modo === 'sueldo' && s.categoria === 'Ingreso Principal' && s.tipo === 'Sueldo';
		dFecha = esSueldo ? hoyISO() : fechaCobroDefault(periodo);
		dPeriodoTocado = false;
		dPeriodo = periodoRegla(dFecha, s.categoria);
		toast.limpiar();
	}
	// Al cambiar la fecha de cobro, re-sugiere el período por la regla del veinte,
	// salvo que el usuario ya lo haya editado a mano.
	function onDFechaChange(s: any) {
		if (!dPeriodoTocado) dPeriodo = periodoRegla(dFecha, s.categoria);
	}
	async function confirmarRegistro(s: any) {
		const m = montoAGuardar(dMonto, dMontoOriginal);
		if (!Number.isFinite(m) || m <= 0) return toast.error('Monto inválido');
		if (!dFecha) return toast.error('Falta la fecha');
		if (!dPeriodo) return toast.error('Falta el período');
		try {
			// El ingreso hereda categoria y tipo del fijo. El periodo es UNA sola
			// fuente (dPeriodo, recomendado por la regla del veinte y editable): lo
			// comparten el ingreso y su registro -> nunca quedan desalineados. Todo en
			// un batch atomico: si el registro choca con UNIQUE (re-disparo del mismo
			// periodo), se revierte el ingreso y no queda huerfano.
			const det = s.detalle ?? s.nombre;
			await queryBatch([
				{ sql: "INSERT INTO ingreso (perfil_id,fecha,monto,moneda,categoria,tipo,detalle,periodo) VALUES (1,?,?,?,?,?,?,?)",
				  bind: [dFecha, m, s.moneda, s.categoria, s.tipo, det, dPeriodo] },
				{ sql: "INSERT INTO ingreso_fijo_registro (ingreso_fijo_id,ingreso_id,periodo) VALUES (?, last_insert_rowid(), ?)",
				  bind: [s.id, dPeriodo] }
			]);
			registrando = null; toast.exito(`"${s.nombre}" registrado (período ${dPeriodo}) ✅`);
			await cargar();
		} catch (e: any) { toast.errorTecnico(e); }
	}

	// Total de los ingresos recurrentes activos, separado por moneda (sin
	// convertir). El "Ingreso recurrente del mes" de arriba es el total convertido
	// a ARS; esto es el desglose por moneda tal cual.
	const totales = $derived.by(() => {
		const t: Record<string, number> = {};
		for (const s of fijos) if (s.activa) t[s.moneda] = (t[s.moneda] ?? 0) + s.monto;
		return Object.entries(t).sort((a, b) => a[0].localeCompare(b[0]));
	});
</script>

<div class="titulo-guia">
	<h1>Ingresos</h1>
	<Guia clave="ingresos-fijos" texto="Tus ingresos recurrentes (sueldo, alquiler, renta, freelance recurrente). Solo lo que cobrás todos los meses. 'Registrar Ingreso' lo convierte en un ingreso real del mes elegido, con su categoría y tipo. Si tu sueldo (Principal + Regular) es recurrente, registralo desde acá y no lo cargues además a mano el mismo mes." />
</div>
<div class="cr-nav">
	<a href="/" class="btn-volver">← Volver a Cuenta Corriente</a>
	<TabsCorrRec activo="recurrente" corriente="/carga-ingresos" recurrente="/ingresos-fijos" />
	<div class="periodo-nav">
		<button class="nav-flecha" onclick={() => vecino(-1)} aria-label="Período anterior" title="Período anterior">‹</button>
		<span class="periodo-medio">
			<button class="periodo-texto" onclick={abrirDropdown} title="Tocar para elegir otro período">{mesCorto(periodo)}</button>
			<input type="month" bind:this={mesInput} bind:value={periodo} onchange={cargar} class="periodo-overlay" aria-label="Elegir período" />
		</span>
		<button class="nav-flecha" onclick={() => vecino(1)} aria-label="Período siguiente" title="Período siguiente">›</button>
	</div>
</div>

<div class="card big">
	<span>Ingreso recurrente del mes</span>
	<strong>{peso(fijoMesARS)}</strong>
</div>
<p class="fijo-nota">suma de todos los ingresos recurrentes activos (USD al MEP)</p>

<details class="form-panel" bind:open={formAbierto}>
	<summary>{editando ? '✏ Editar ingreso recurrente' : '➕ Agregar ingreso recurrente'}</summary>
<div class="form" class:edit={editando}>
	{#if editando}<p class="editando">✏ Editando #{editId} · <button class="link" onclick={resetForm}>cancelar</button></p>{/if}
	<label>Nombre<input bind:value={fNombre} placeholder="Ej: Sueldo, Alquiler" /></label>
	<label>Detalle (como aparece en el ingreso)<input bind:value={fDetalle} placeholder="Ej: Sueldo empresa, Cochera" /></label>
	<label>Monto<input type="text" inputmode="decimal" use:soloNum bind:value={fMonto} placeholder="0,00" /></label>
	<label>Moneda<select bind:value={fMoneda}><option>ARS</option><option>USD</option></select></label>
	<label>Categoría<select bind:value={fCategoria}>
		<option value="">— elegí una —</option>
		<option value="Ingreso Principal">Ingreso Principal</option>
		<option value="Ingresos Secundarios">Ingresos Secundarios</option>
		<option value="Otros">Otros</option>
	</select></label>
	<p class="form-nota">El Ingreso Principal marca el ritmo de tus períodos (en modo sueldo). Secundarios y Otros se acomodan a ese mes.</p>
	<label>Tipo de ingreso<select bind:value={fTipo}>
		<option value="Sueldo">Regular</option>
		<option value="Aciclico">Extraordinario</option>
	</select></label>
	<p class="form-nota">Regular: recurrente (sueldo, alquiler, renta). Extraordinario: cobros puntuales.</p>
	<label>Día esperado de cobro
		<select bind:value={fDiaEsperado}>
			<option value="">— sin especificar —</option>
			{#each OPCIONES_DIA as d (d)}<option value={String(d)}>Día {d}</option>{/each}
		</select></label>
	<div class="botones">
		<button class="btn btn-primary" onclick={guardar}>{editando ? 'Guardar cambios' : 'Agregar'}</button>
		{#if editando}<button class="btn btn-secondary" onclick={resetForm}>Cancelar</button>{/if}
	</div>
</div>
</details>

{#if totales.length}
	<div class="totales">
		{#each totales as [mon, tot] (mon)}
			<div class="total">Total {mon}: <strong>{peso(tot, mon)}</strong></div>
		{/each}
	</div>
{/if}

<div class="grupos">
	{#each filas as f (f.sep ?? f.s.id)}
		{#if f.sep}
			<div class="sep-lista">{f.sep}</div>
		{:else}
			{@const s = f.s}
			<div class="ficha" class:inactiva={!s.activa} class:editrow={editId === s.id}>
				<div class="ficha-top">
					<span class="ficha-nombre">{s.nombre}</span>
					<span class="ficha-monto">{peso(s.monto, s.moneda)}</span>
					<span class="ficha-acc">
						<button aria-label="Editar" class="lapiz" onclick={() => iniciarEdit(s)} title="Editar">✏</button>
						<button aria-label="Eliminar" class="del" onclick={() => eliminar(s)} title="Eliminar">✕</button>
					</span>
				</div>
				<div class="ficha-meta">
					<span class="chip">{tipoLabel(s.tipo)}</span>
					{` · ${catLabel(s.categoria)}`}{s.dia_esperado != null ? ` · Día ${s.dia_esperado}` : ''}
				</div>
				<div class="ficha-estado">
					{#if !s.activa}
						<span class="dim">Inactivo</span>
					{:else if registradas[s.id]}
						<span class="ok">Registrado ✓</span>
					{:else if registrando === s.id}
						<span class="draft">
							<input type="text" inputmode="decimal" use:soloNum bind:value={dMonto} class="mini" title="Monto" />
							<input type="date" bind:value={dFecha} onchange={() => onDFechaChange(s)} class="mini" title="Fecha de cobro" />
							<input type="month" bind:value={dPeriodo} onchange={() => (dPeriodoTocado = true)} class="mini" title="Período (sugerido por la regla del veinte, editable)" />
							<button class="btn btn-primary" onclick={() => confirmarRegistro(s)}>Confirmar</button>
							<button class="btn btn-secondary" onclick={() => (registrando = null)}>Cancelar</button>
						</span>
					{:else}
						<button class="btn btn-primary" onclick={() => iniciarRegistro(s)}>Registrar Ingreso</button>
					{/if}
				</div>
			</div>
		{/if}
	{/each}
	{#if fijos.length === 0}<p class="vacio">No hay ingresos recurrentes. Agregá el primero desde “➕ Agregar ingreso recurrente”, arriba.</p>{/if}
</div>
{#if toast.texto}<p class="msg" class:err={toast.esError}>{#if toast.esError}<span class="err-x">✗</span> {/if}{toast.texto}</p>{/if}



<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	/* .card/.card.big vive ahora en +layout.svelte (global, tarjeta única migrada).
	   .card por sí sola no trae margin (eso lo aporta .resumen cuando envuelve
	   varias) — acá va suelta, así que el margin hay que ponerlo local. */
	.card.big { margin: 12px 0; }
	.fijo-nota { font-size: 0.72rem; color: var(--text-dim); margin: -8px 0 12px; }
	/* .form-panel vive ahora en +layout.svelte (global, Brief H / A3). */
	.form.edit { border-color: var(--accent); }
	label { display: flex; flex-direction: column; font-size: 0.82rem; color: var(--text-dim); gap: 3px; }
	input, select { padding: 6px; font-size: 0.95rem; }
	input.mini { width: 110px; padding: 3px 5px; display: inline-block; }
	.botones { display: flex; gap: 8px; margin-top: 4px; }
	.form-nota { font-size: 0.76rem; color: var(--text-dim); margin: 2px 0 0; line-height: 1.35; }
	.editando { font-size: 0.85rem; color: var(--warn); background: rgba(251, 191, 36, 0.1); padding: 6px 10px; border-radius: 6px; margin: 0; }
	.draft { display: inline-flex; gap: 5px; align-items: center; flex-wrap: wrap; }
	.ok { color: var(--pos); font-weight: 600; font-size: 0.85rem; }
	.dim { color: var(--text-dim); font-size: 0.85rem; }
	.vacio { color: var(--text-dim); font-style: italic; }
	.msg { color: var(--text-dim); font-weight: 600; }
	.msg.err { color: var(--neg); display: flex; align-items: center; gap: 6px; }
	.msg .err-x { font-size: 1.3em; line-height: 1; }

	/* Total de recurrentes activos, una línea por moneda (sin convertir) */
	.totales { display: flex; flex-wrap: wrap; gap: 4px 18px; margin: 10px 0; }
	.total { font-size: 0.9rem; color: var(--text-dim); font-weight: 600; }
	.total strong { color: var(--text); }
	.grupos { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
	/* Separadores tenues de la lista plana: no agrupan, solo marcan un corte. */
	.sep-lista { font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); font-weight: 600; margin-top: 14px; padding-bottom: 3px; border-bottom: 1px dashed var(--border); opacity: 0.75; }
	.ficha { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 10px 12px; }
	.ficha.inactiva { opacity: 0.45; }
	.ficha.editrow { border-color: var(--accent); background: rgba(91, 157, 255, 0.08); }
	.ficha-top { display: flex; align-items: baseline; gap: 10px; }
	.ficha-nombre { font-weight: 600; font-size: 0.95rem; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.ficha-monto { font-weight: 700; white-space: nowrap; }
	.ficha-acc { white-space: nowrap; flex-shrink: 0; }
	.ficha-meta { font-size: 0.78rem; color: var(--text-dim); margin-top: 5px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
	.chip { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 999px; padding: 2px 9px; font-size: 0.76rem; }
	.ficha-estado { margin-top: 8px; }

	/* Nav superior de Corriente/Recurrente: volver + tabs (+ selector de periodo si aplica), apilados */
	.cr-nav { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; margin: 4px 0 14px; }
	.cr-nav :global(.btn-volver) { margin: 0; }
	.periodo-nav { display: inline-flex; align-items: stretch; gap: 4px; }
	.nav-flecha { font-size: 1.2rem; line-height: 1; padding: 4px 12px; border: 1px solid var(--border); background: var(--surface); border-radius: 8px; cursor: pointer; color: var(--text); }
	.periodo-medio { position: relative; display: inline-flex; }
	.periodo-texto { font-size: 0.95rem; font-weight: 600; padding: 4px 12px; border: 1px solid var(--border); background: var(--surface); border-radius: 8px; cursor: pointer; color: var(--text); min-width: 120px; text-align: center; }
	.periodo-overlay { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: 0; padding: 0; margin: 0; }
</style>

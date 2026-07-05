<script lang="ts">
	import { onMount } from 'svelte';
	import { exportarDatos, importarDatos, leerFechasBackup, resetearBase, type FechasBackup } from '$lib/db/backup';
	import { crearAutobackup, listarAutobackups, leerAutobackup, type AutobackupItem } from '$lib/db/autobackup';
	import { leerMeta, setMeta, type Metadatos } from '$lib/db/meta';
	import {
		descargarArchivo, importarExcel,
		exportarGastosCSV, exportarIngresosCSV, exportarInversionesCSV
	} from '$lib/db/precarga';
	import { hoyISO } from '$lib/format';
	import Guia from '$lib/Guia.svelte';
	import InstalarApp from '$lib/InstalarApp.svelte';

	let meta = $state<Metadatos>({ ultima_importacion: null, ultima_edicion_finanzas: null, ultima_edicion_inversiones: null, ultima_exportacion: null, backup_aviso_hasta: null });
	let cargando = $state(true);
	let importInput: HTMLInputElement | undefined = $state();

	// Estado de la comparación previa al importar
	let comparando = $state(false);
	let fechasBackup = $state<FechasBackup | null>(null);
	let backupPendiente = $state<any>(null);
	let autobackups = $state<AutobackupItem[]>([]);

	// Estado del borrado total
	let reseteando = $state(false);
	let textoConfirm = $state('');
	let borrando = $state(false);
	let puedeBorrar = $derived(textoConfirm.trim().toUpperCase() === 'BORRAR');

	async function cargar() {
		meta = await leerMeta();
		autobackups = await listarAutobackups();
		cargando = false;
	}
	onMount(cargar);

	function fmt(iso: string | null): string {
		if (!iso) return 'Nunca';
		const d = new Date(iso);
		return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	// Días desde una fecha ISO guardada, sin new Date() (Date.parse sobre el ISO
	// absoluto + Date.now; no hay corrimiento de día). null si nunca.
	function diasDesde(iso: string | null): number | null {
		if (!iso) return null;
		const ms = Date.parse(iso);
		if (Number.isNaN(ms)) return null;
		return Math.floor((Date.now() - ms) / 86400000);
	}
	const diasCopia = $derived(diasDesde(meta.ultima_exportacion));
	const copiaVieja = $derived(diasCopia === null || diasCopia > 30);
	const textoCopia = $derived(
		diasCopia === null ? 'Todavía no descargaste ninguna copia'
		: diasCopia === 0 ? 'Última copia: hoy'
		: diasCopia === 1 ? 'Última copia: hace 1 día'
		: `Última copia: hace ${diasCopia} días`
	);

	// true si el backup es más viejo que la base actual en ese módulo
	function masViejo(actual: string | null, backup: string | null): boolean {
		if (!actual || !backup) return false;
		return backup < actual;
	}

	async function onExportar() {
		try { await exportarDatos(); }
		catch (e: any) { alert('Error al exportar: ' + (e?.message ?? e)); }
	}

	// Paso 1: elegir archivo -> leer fechas y mostrar comparación
	async function onElegirArchivo(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			const { backup, fechas } = await leerFechasBackup(file);
			fechasBackup = fechas;
			backupPendiente = backup;
			comparando = true;
		} catch (err: any) {
			alert(err?.message ?? String(err));
		} finally {
			input.value = '';
		}
	}

	// Paso 2: confirmar la importación
	async function confirmarImport() {
		try {
			await crearAutobackup(); // red de seguridad antes de pisar
			await importarDatos(backupPendiente);
			await setMeta('ultima_importacion', new Date().toISOString());
			alert('Importación completa. La página se va a recargar.');
			location.reload();
		} catch (err: any) {
			alert(err?.message ?? String(err));
			cancelarImport();
		}
	}

	function cancelarImport() {
		comparando = false;
		fechasBackup = null;
		backupPendiente = null;
	}

	// Restaurar una copia automatica: entra al MISMO flujo de comparacion que un import.
	async function restaurarAuto(nombre: string) {
		try {
			const texto = await leerAutobackup(nombre);
			const { backup, fechas } = await leerFechasBackup(texto);
			fechasBackup = fechas; backupPendiente = backup; comparando = true;
			window.scrollTo({ top: 0, behavior: 'smooth' });
		} catch (err: any) { alert(err?.message ?? String(err)); }
	}

	// ----- Planillas: precarga Excel + exportación CSV -----
	let excelInput: HTMLInputElement | undefined = $state();
	let importandoCSV = $state(false);

	async function onImportarExcel(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		importandoCSV = true;
		try {
			const resumen = await importarExcel(file);
			alert('Importación completa ✅\n' + resumen);
		} catch (err: any) {
			alert(err?.message ?? String(err));
		} finally {
			input.value = '';
			importandoCSV = false;
		}
	}

	async function onExportarCSV(nombre: string, exportar: () => Promise<string>) {
		try {
			descargarArchivo(`rienda-${nombre}-${hoyISO()}.csv`, await exportar());
		} catch (e: any) { alert('Error al exportar: ' + (e?.message ?? e)); }
	}

	// ----- Borrado total -----
	function abrirReset() {
		textoConfirm = '';
		reseteando = true;
	}

	function cerrarReset() {
		reseteando = false;
		textoConfirm = '';
	}

	async function confirmarReset() {
		if (!puedeBorrar || borrando) return;
		borrando = true;
		try {
			await crearAutobackup(); // red de seguridad antes de borrar
			await resetearBase();
			alert('Listo. Se borraron todos los datos de este dispositivo. La app vuelve al inicio.');
			location.reload();
		} catch (e: any) {
			alert(e?.message ?? String(e));
			borrando = false;
		}
	}
</script>

<div class="titulo-guia">
	<h1>Tus datos</h1>
	<Guia clave="datos" texto="Tus datos viven SOLO en este dispositivo. La copia de seguridad JSON es tu ÚNICO respaldo total: descargala seguido y guardala fuera del teléfono. Las planillas Excel/CSV NO son respaldo — solo mueven datos entre Rienda y una planilla." />
</div>

{#if cargando}
	<p>Cargando…</p>
{:else}
	<!-- Estado: lo que se mira de un vistazo (fijo, no colapsable) -->
	<div class="estado" class:vieja={copiaVieja}>
		<span class="est-main">{copiaVieja ? '⚠️ ' : ''}{textoCopia}.</span>
		{#if copiaVieja}<span class="est-sub">Tus datos viven solo en este teléfono — descargá la copia JSON abajo (tu único respaldo total).</span>{/if}
	</div>

	<!-- Comparación antes de restaurar (cuando elegiste una copia) -->
	{#if comparando && fechasBackup}
		<div class="comparacion">
			<h2>Comparación antes de restaurar</h2>
			<table>
				<thead><tr><th></th><th>Tu base actual</th><th>La copia</th></tr></thead>
				<tbody>
					<tr>
						<td>Edición de Finanzas</td>
						<td class="val">{fmt(meta.ultima_edicion_finanzas)}</td>
						<td class="val" class:rojo={masViejo(meta.ultima_edicion_finanzas, fechasBackup.edicion_finanzas)}>
							{fechasBackup.tieneMeta ? fmt(fechasBackup.edicion_finanzas) : 'Desconocido'}
						</td>
					</tr>
					<tr>
						<td>Edición de Inversiones</td>
						<td class="val">{fmt(meta.ultima_edicion_inversiones)}</td>
						<td class="val" class:rojo={masViejo(meta.ultima_edicion_inversiones, fechasBackup.edicion_inversiones)}>
							{fechasBackup.tieneMeta ? fmt(fechasBackup.edicion_inversiones) : 'Desconocido'}
						</td>
					</tr>
				</tbody>
			</table>

			{#if !fechasBackup.tieneMeta}
				<p class="aviso">Esta copia es de una versión anterior y no tiene información de fechas, así que no se puede comparar. Revisá bien antes de continuar.</p>
			{:else if masViejo(meta.ultima_edicion_finanzas, fechasBackup.edicion_finanzas) || masViejo(meta.ultima_edicion_inversiones, fechasBackup.edicion_inversiones)}
				<p class="aviso rojo">⚠ La copia tiene datos más viejos que tu base actual (en rojo). Si restaurás, perdés lo que cargaste después de esa fecha en este dispositivo.</p>
			{:else}
				<p class="aviso ok">La copia está al día o es más reciente que tu base actual.</p>
			{/if}

			<p class="recordatorio">Restaurar <strong>reemplaza TODOS</strong> los datos de este dispositivo por los de la copia.</p>
			<div class="botones">
				<button class="btn btn-secondary" onclick={cancelarImport}>Cancelar</button>
				<button class="btn btn-danger-solid" onclick={confirmarImport}>Restaurar de todos modos</button>
			</div>
		</div>
	{/if}

	<!-- Copia de seguridad JSON: el ÚNICO respaldo total -->
	<details class="sec" open>
		<summary>Copia de seguridad (JSON)</summary>
		<div class="sec-body">
			<p class="nota"><strong>Es el único respaldo total.</strong> Un archivo <strong>JSON</strong> con TODO (gastos, ingresos, inversiones, configuración y perfil). Es lo único que te deja <strong>recuperar todo</strong> si cambiás de teléfono o se borran los datos. Descargala seguido y guardala <strong>fuera del teléfono</strong> (mail, Drive, etc.). Restaurar <strong>reemplaza todo</strong> y vuelve exactamente a ese punto.</p>
			<div class="acc">
				<button class="btn btn-primary" onclick={onExportar}>⬇ Descargar copia (JSON)</button>
				<button class="btn btn-secondary" onclick={() => importInput?.click()}>⬆ Restaurar copia</button>
				<input type="file" accept="application/json" bind:this={importInput} onchange={onElegirArchivo} style="display:none" />
			</div>
			<details class="subsec">
				<summary>Detalle de fechas</summary>
				<table class="fechas">
					<tbody>
						<tr><td>Última importación</td><td class="val">{fmt(meta.ultima_importacion)}</td></tr>
						<tr><td>Última edición de Finanzas</td><td class="val">{fmt(meta.ultima_edicion_finanzas)}</td></tr>
						<tr><td>Última edición de Inversiones</td><td class="val">{fmt(meta.ultima_edicion_inversiones)}</td></tr>
					</tbody>
				</table>
				<p class="nota">"Última edición" = cuándo cargaste o modificaste datos, por módulo. Actualizar cotizaciones no cuenta.</p>
			</details>
		</div>
	</details>

	<!-- Planillas Excel/CSV: NO son respaldo, mueven datos entre Rienda y una planilla -->
	<details class="sec">
		<summary>Planillas (Excel / CSV)</summary>
		<div class="sec-body">
			<p class="nota"><strong>No son un respaldo</strong> — para eso está la copia JSON de arriba. Sirven para mover datos entre Rienda y una planilla.</p>
			<p class="nota"><strong>Excel — precargar (traer datos):</strong> bajá la plantilla, completá las hojas que quieras (Gastos / Ingresos / Inversiones) y subila. Importar <strong>AGREGA</strong>: no pisa ni borra lo que ya tenés y omite duplicados. Crea categorías, tarjetas y activos que falten.</p>
			<div class="acc">
				<a class="btn btn-secondary" href="/rienda-plantilla.xlsx" download>⬇ Plantilla Excel</a>
				<button class="btn btn-primary" disabled={importandoCSV} onclick={() => excelInput?.click()}>⬆ Importar planilla (agrega)</button>
				<input type="file" accept=".xlsx" bind:this={excelInput} onchange={onImportarExcel} style="display:none" />
			</div>
			<p class="nota"><strong>CSV — exportar (sacar datos):</strong> tus datos en formato planilla para mirarlos o analizarlos afuera (Excel, Google Sheets). Es solo salida: no se vuelve a importar.</p>
			<div class="acc">
				<button class="btn btn-secondary" onclick={() => onExportarCSV('gastos', exportarGastosCSV)}>⬇ CSV Gastos</button>
				<button class="btn btn-secondary" onclick={() => onExportarCSV('ingresos', exportarIngresosCSV)}>⬇ CSV Ingresos</button>
				<button class="btn btn-secondary" onclick={() => onExportarCSV('inversiones', exportarInversionesCSV)}>⬇ CSV Inversiones</button>
			</div>
		</div>
	</details>

	<!-- Últimas 5 versiones (deshacer) -->
	<details class="sec">
		<summary>Últimas 5 versiones</summary>
		<div class="sec-body">
			<p class="nota">Función deshacer: la app guarda sola tus últimas 5 versiones antes de cada cambio grande. ¿Te equivocaste? Volvé a cualquiera de las 5. ⚠️ Viven en este teléfono. Para no perder tus datos, descargá la copia JSON (arriba).</p>
			{#if autobackups.length}
				<ul class="autolist">
					{#each autobackups as a (a.nombre)}
						<li>
							<span class="auto-fecha">{a.fecha}</span>
							<span class="auto-size">{(a.size / 1024).toFixed(0)} KB</span>
							<button class="btn btn-secondary" onclick={() => restaurarAuto(a.nombre)}>Volver a esta</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="nota">Todavía no hay versiones guardadas (se crean al importar o al borrar).</p>
			{/if}
		</div>
	</details>

	<!-- Instalar la app -->
	<details class="sec">
		<summary>Instalar la app</summary>
		<div class="sec-body">
			<p class="nota">Instalada es más rápida, funciona sin conexión y ayuda a que no se borren tus datos (clave en iPhone/iPad).</p>
			<InstalarApp mostrarInstalada dismissible={false} />
		</div>
	</details>

	<!-- Zona peligrosa -->
	<details class="sec peligro">
		<summary>Zona peligrosa</summary>
		<div class="sec-body">
			{#if !reseteando}
				<p class="peligro-desc">Borra todos los datos de este dispositivo y devuelve la app al inicio. Es irreversible.</p>
				<button class="btn btn-danger-outline" onclick={abrirReset}>Borrar todos mis datos</button>
			{:else}
				<p class="peligro-desc">
					Vas a borrar <strong>todo</strong>: gastos, ingresos, inversiones, configuración y perfil.
					No se puede deshacer. Si todavía no tenés una copia, descargala ahora.
				</p>
				<button class="btn btn-primary exp-reset" onclick={onExportar}>⬇ Descargar copia primero</button>
				<label class="lbl-confirm" for="confirm-borrar">Escribí <strong>BORRAR</strong> para confirmar:</label>
				<input
					id="confirm-borrar"
					class="input-confirm"
					type="text"
					bind:value={textoConfirm}
					placeholder="BORRAR"
					autocapitalize="characters"
					autocorrect="off"
					autocomplete="off"
					spellcheck="false"
				/>
				<div class="botones">
					<button class="btn btn-secondary" onclick={cerrarReset}>Cancelar</button>
					<button class="btn btn-danger-solid" disabled={!puedeBorrar || borrando} onclick={confirmarReset}>
						{borrando ? 'Borrando…' : 'Borrar todo'}
					</button>
				</div>
			{/if}
		</div>
	</details>
{/if}

<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	h2 { font-size: 1.05rem; margin-top: 0; }

	/* Estado (fijo arriba) */
	.estado { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 10px 14px; margin: 10px 0 14px; display: flex; flex-direction: column; gap: 3px; }
	.estado.vieja { border-color: var(--warn); background: rgba(251, 191, 36, 0.08); }
	.est-main { font-weight: 600; font-size: 0.92rem; }
	.est-sub { font-size: 0.8rem; color: var(--text-dim); }

	/* Secciones colapsables */
	.sec { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; margin: 0 0 10px; }
	.sec > summary { cursor: pointer; padding: 12px 14px; font-weight: 600; font-size: 0.95rem; list-style: none; display: flex; align-items: center; justify-content: space-between; }
	.sec > summary::after { content: '▸'; color: var(--text-dim); }
	.sec[open] > summary::after { content: '▾'; }
	.sec > summary::-webkit-details-marker { display: none; }
	.sec-body { padding: 0 14px 14px; display: flex; flex-direction: column; gap: 10px; }
	.sec.peligro { border-color: var(--neg); margin-top: 22px; }
	.sec.peligro > summary { color: var(--neg); }

	/* Botones de tamaño uniforme (full-width, sin corrimiento en móvil) */
	.acc { display: flex; flex-direction: column; gap: 8px; }
	.acc :global(.btn) { width: 100%; box-sizing: border-box; text-align: center; }

	.subsec { border-top: 1px solid var(--border); padding-top: 8px; }
	.subsec > summary { cursor: pointer; font-size: 0.84rem; color: var(--text-dim); }

	.nota { font-size: 0.82rem; color: var(--text-dim); margin: 0; line-height: 1.5; }
	.nota strong { color: var(--text); }

	/* Comparación previa a restaurar */
	.comparacion { border: 1px solid var(--warn); background: var(--surface); border-radius: 8px; padding: 14px; margin: 0 0 14px; }
	.comparacion h2 { margin-top: 0; }
	table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
	.fechas { max-width: 420px; }
	td, th { padding: 7px 9px; text-align: left; }
	th { color: var(--text-dim); }
	td.val, th:nth-child(n+2) { text-align: right; font-weight: 600; }
	td.rojo { color: var(--neg) !important; }
	.aviso { font-size: 0.85rem; margin: 12px 0 6px; line-height: 1.5; }
	.aviso.rojo { color: var(--neg); font-weight: 600; }
	.aviso.ok { color: var(--pos); }
	.recordatorio { font-size: 0.82rem; color: var(--text-dim); margin: 6px 0 12px; }
	.botones { display: flex; gap: 10px; flex-wrap: wrap; }

	/* Versiones (deshacer) */
	.autolist { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
	.autolist li { display: flex; align-items: center; gap: 10px; border: 1px solid var(--border); background: var(--surface-2); border-radius: 8px; padding: 7px 12px; }
	.auto-fecha { flex: 1; font-size: 0.88rem; }
	.auto-size { color: var(--text-dim); font-size: 0.8rem; }

	/* Zona peligrosa */
	.peligro-desc { font-size: 0.85rem; color: var(--text-dim); line-height: 1.5; margin: 0; }
	.exp-reset { align-self: flex-start; }
	.lbl-confirm { font-size: 0.85rem; }
	.input-confirm { width: 100%; max-width: 240px; box-sizing: border-box; padding: 9px 12px; font-size: 1rem; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-2); color: var(--text); letter-spacing: 0.05em; }
	.input-confirm:focus { outline: none; border-color: var(--neg); }
</style>

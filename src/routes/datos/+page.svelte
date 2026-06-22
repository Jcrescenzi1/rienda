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
	<h1>Datos</h1>
	<Guia clave="datos" texto="Tus datos viven SOLO en este dispositivo. Creá copias de seguridad seguido y guardalas en otro lado: son tu única red. Las planillas Excel/CSV son para traer o sacar datos; la copia de seguridad, para restaurar todo." />
</div>

{#if cargando}
	<p>Cargando…</p>
{:else}
	<h2>Copia de seguridad</h2>
	<p class="nota">
		Tu <strong>resguardo total</strong>: un archivo con TODO (datos, configuración y perfil) para
		guardar a salvo o mudarte de dispositivo. Restaurar <strong>reemplaza todo</strong> lo que haya
		en la app y vuelve exactamente a ese punto.
	</p>
	<div class="acciones">
		<button class="btn btn-primary" onclick={onExportar}>⬇ Crear copia de seguridad</button>
		<button class="btn btn-secondary" onclick={() => importInput?.click()}>⬆ Restaurar copia</button>
		<input type="file" accept="application/json" bind:this={importInput} onchange={onElegirArchivo} style="display:none" />
	</div>

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

	<h2>Copias automáticas</h2>
	<p class="nota">Antes de cada importación o borrado, Rienda guarda sola una copia en este dispositivo (las últimas 5). Si una operación pisó tus datos, restaurá desde acá — usa la misma comparación que una importación.</p>
	{#if autobackups.length}
		<ul class="autolist">
			{#each autobackups as a (a.nombre)}
				<li>
					<span class="auto-fecha">{a.fecha}</span>
					<span class="auto-size">{(a.size / 1024).toFixed(0)} KB</span>
					<button class="btn btn-secondary" onclick={() => restaurarAuto(a.nombre)}>Restaurar</button>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="nota">Todavía no hay copias automáticas (se crean al importar o al borrar).</p>
	{/if}
	<p class="nota auto-lim">Estas copias viven en este mismo dispositivo. NO protegen contra "limpiar datos de navegación", desalojo del navegador ni pérdida del equipo. Para eso, descargá la copia de seguridad y guardala en otro lado.</p>

	<h2>Instalá la app (recomendado)</h2>
	<p class="nota">
		Instalar Rienda en tu dispositivo protege tus datos y la abre como una app propia.
		<strong>En iPhone/iPad es clave:</strong> si la usás como pestaña de Safari, el sistema borra
		tus datos tras 7 días sin abrirla; instalada en la pantalla de inicio, no.
	</p>
	<div class="instalar">
		<div class="inst-card">
			<strong>📱 iPhone / iPad (Safari)</strong>
			<ol>
				<li>Abrí Rienda en <strong>Safari</strong>.</li>
				<li>Tocá el botón <strong>Compartir</strong> (el cuadrado con la flecha ↑).</li>
				<li>Elegí <strong>"Agregar a inicio"</strong>.</li>
				<li>Abrila siempre desde el ícono de la pantalla de inicio.</li>
			</ol>
		</div>
		<div class="inst-card">
			<strong>🖥 Windows (Chrome / Edge)</strong>
			<ol>
				<li>Abrí Rienda en <strong>Chrome</strong> o <strong>Edge</strong>.</li>
				<li>En la barra de direcciones, clic en el ícono de <strong>instalar</strong> (un monitor con ↓), o menú <strong>⋮ → "Instalar Rienda"</strong>.</li>
				<li>Se abre como app propia, con su ícono en el escritorio.</li>
			</ol>
		</div>
		<div class="inst-card">
			<strong>🖥 Mac (Chrome)</strong>
			<ol>
				<li>En Mac, <strong>instalá desde Chrome</strong> (no desde Safari): Safari solo permite instalar PWAs en macOS Sonoma o superior, y la opción está escondida.</li>
				<li>Abrí Rienda en <strong>Chrome</strong>.</li>
				<li>En la barra de direcciones, clic en el ícono de <strong>instalar</strong> (un monitor con ↓), o menú <strong>⋮ → "Instalar Rienda"</strong>.</li>
				<li>Se abre como app propia, con su ícono en el Dock.</li>
			</ol>
		</div>
	</div>

	<h2>Planillas (Excel / CSV)</h2>
	<p class="nota">
		<strong>Precarga histórica:</strong> ¿venís de una planilla? Bajá la plantilla Excel y completá
		solo las hojas que quieras (Gastos / Ingresos / Inversiones — adentro tenés instrucciones y
		desplegables con los valores válidos). Al subirla se importa lo que tenga datos; si una hoja tiene
		errores, ese bloque no entra y te decimos qué corregir. Categorías, tarjetas, activos y cuentas
		que no existan se crean solas.<br />
		<strong>Importar siempre AGREGA</strong>: no pisa ni borra lo que ya tenés, y las filas idénticas
		a registros existentes se omiten solas (podés resubir un archivo sin miedo a duplicar).
		<strong>Exportar CSV:</strong> tus datos en formato planilla, para analizarlos en Excel u otra herramienta.
	</p>
	<div class="precarga">
		<div class="prow destacada">
			<span>Precargar</span>
			<a class="btn btn-secondary" href="/rienda-plantilla.xlsx" download>⬇ Plantilla Excel</a>
			<button class="btn btn-primary" disabled={importandoCSV} onclick={() => excelInput?.click()}>⬆ Importar datos (agrega)</button>
			<input type="file" accept=".xlsx" bind:this={excelInput} onchange={onImportarExcel} style="display:none" />
		</div>
		<div class="prow">
			<span>Exportar</span>
			<button class="btn btn-secondary" onclick={() => onExportarCSV('gastos', exportarGastosCSV)}>⬇ Gastos</button>
			<button class="btn btn-secondary" onclick={() => onExportarCSV('ingresos', exportarIngresosCSV)}>⬇ Ingresos</button>
			<button class="btn btn-secondary" onclick={() => onExportarCSV('inversiones', exportarInversionesCSV)}>⬇ Inversiones</button>
		</div>
	</div>

	<h2>Estado de tus datos</h2>
	<table>
		<tbody>
			<tr><td>Última importación</td><td class="val">{fmt(meta.ultima_importacion)}</td></tr>
			<tr><td>Última edición de Finanzas</td><td class="val">{fmt(meta.ultima_edicion_finanzas)}</td></tr>
			<tr><td>Última edición de Inversiones</td><td class="val">{fmt(meta.ultima_edicion_inversiones)}</td></tr>
		</tbody>
	</table>

	<p class="nota">
		"Última edición" registra cuándo cargaste o modificaste datos en este dispositivo, por módulo.
		Actualizar cotizaciones desde la API no cuenta como edición.
	</p>

	<div class="peligro">
		<h2>Zona peligrosa</h2>
		{#if !reseteando}
			<p class="peligro-desc">Borra todos los datos de este dispositivo y devuelve la app al inicio. Es irreversible.</p>
			<button class="btn btn-danger-outline" onclick={abrirReset}>Borrar todos mis datos</button>
		{:else}
			<p class="peligro-desc">
				Vas a borrar <strong>todo</strong>: gastos, ingresos, inversiones, configuración y perfil.
				No se puede deshacer. Si todavía no tenés una copia, exportala ahora.
			</p>
			<button class="btn btn-primary exp-reset" onclick={onExportar}>⬇ Crear copia de seguridad primero</button>
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
{/if}

<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	h2 { font-size: 1.05rem; margin-top: 24px; }
	.acciones { display: flex; gap: 10px; flex-wrap: wrap; margin: 12px 0; }
	.comparacion { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 14px; margin: 12px 0; }
	table { border-collapse: collapse; width: 100%; max-width: 560px; font-size: 0.9rem; }
	td, th { padding: 8px 10px; text-align: left; }
	th { color: var(--text-dim); }
	td.val, th:nth-child(n+2) { text-align: right; font-weight: 600; }
	td.rojo { color: var(--neg) !important; }
	.aviso { font-size: 0.85rem; margin: 12px 0 6px; line-height: 1.5; }
	.aviso.rojo { color: var(--neg); font-weight: 600; }
	.aviso.ok { color: var(--pos); }
	.recordatorio { font-size: 0.82rem; color: var(--text-dim); margin: 6px 0 12px; }
	.botones { display: flex; gap: 10px; }
	.nota { font-size: 0.8rem; color: var(--text-dim); margin-top: 12px; max-width: 560px; line-height: 1.5; }
	.nota strong { color: var(--text); }

	/* Instalación PWA */
	.instalar { display: flex; gap: 12px; flex-wrap: wrap; margin: 10px 0; }
	.inst-card { flex: 1; min-width: 250px; border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 10px 14px; }
	.inst-card strong { font-size: 0.92rem; }
	.inst-card ol { margin: 8px 0 0; padding-left: 20px; font-size: 0.83rem; color: var(--text-dim); line-height: 1.6; }
	.inst-card ol strong { color: var(--text); font-size: inherit; }

	/* Planillas (precarga + exportación) */
	.precarga { display: flex; flex-direction: column; gap: 8px; margin: 10px 0; max-width: 620px; }
	.prow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
	.prow span { font-weight: 600; font-size: 0.9rem; width: 90px; }
	.prow.destacada { border: 1px solid var(--accent); border-radius: 8px; padding: 8px 10px; background: rgba(91, 157, 255, 0.06); margin-bottom: 4px; }

	/* Zona peligrosa */
	.peligro { border: 1px solid var(--neg); border-radius: 8px; padding: 14px; margin-top: 32px; max-width: 560px; box-sizing: border-box; }
	.peligro h2 { margin-top: 0; color: var(--neg); }
	.peligro-desc { font-size: 0.85rem; color: var(--text-dim); line-height: 1.5; margin: 6px 0 12px; }
	.exp-reset { display: inline-block; margin: 0 0 14px; }
	.lbl-confirm { display: block; font-size: 0.85rem; margin: 4px 0 6px; }
	.input-confirm { width: 100%; max-width: 240px; box-sizing: border-box; padding: 9px 12px; font-size: 1rem; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-2); color: var(--text); letter-spacing: 0.05em; margin-bottom: 14px; }
	.input-confirm:focus { outline: none; border-color: var(--neg); }
	.autolist { list-style: none; padding: 0; margin: 8px 0 12px; display: flex; flex-direction: column; gap: 6px; max-width: 560px; }
	.autolist li { display: flex; align-items: center; gap: 10px; border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 7px 12px; }
	.auto-fecha { flex: 1; font-size: 0.88rem; }
	.auto-size { color: var(--text-dim); font-size: 0.8rem; }
	.auto-lim { font-size: 0.78rem; }
</style>
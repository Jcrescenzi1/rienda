<script lang="ts">
	import { onMount } from 'svelte';
	import { exportarDatos, importarDatos, leerFechasBackup, type FechasBackup } from '$lib/db/backup';
	import { leerMeta, setMeta, type Metadatos } from '$lib/db/meta';

	let meta = $state<Metadatos>({ ultima_importacion: null, ultima_edicion_finanzas: null, ultima_edicion_inversiones: null });
	let cargando = $state(true);
	let importInput: HTMLInputElement;

	// Estado de la comparación previa al importar
	let comparando = $state(false);
	let fechasBackup = $state<FechasBackup | null>(null);
	let backupPendiente = $state<any>(null);

	async function cargar() {
		meta = await leerMeta();
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
</script>

<h1>Datos</h1>

{#if cargando}
	<p>Cargando…</p>
{:else}
	<div class="acciones">
		<button class="exp" onclick={onExportar}>⬇ Exportar backup</button>
		<button class="imp" onclick={() => importInput.click()}>⬆ Importar backup</button>
		<input type="file" accept="application/json" bind:this={importInput} onchange={onElegirArchivo} style="display:none" />
	</div>

	{#if comparando && fechasBackup}
		<div class="comparacion">
			<h2>Comparación antes de importar</h2>
			<table>
				<thead><tr><th></th><th>Tu base actual</th><th>El backup</th></tr></thead>
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
				<p class="aviso">Este backup es de una versión anterior y no tiene información de fechas, así que no se puede comparar. Revisá bien antes de continuar.</p>
			{:else if masViejo(meta.ultima_edicion_finanzas, fechasBackup.edicion_finanzas) || masViejo(meta.ultima_edicion_inversiones, fechasBackup.edicion_inversiones)}
				<p class="aviso rojo">⚠️ El backup tiene datos más viejos que tu base actual (en rojo). Si importás, perdés lo que cargaste después de esa fecha en este dispositivo.</p>
			{:else}
				<p class="aviso ok">El backup está al día o es más reciente que tu base actual.</p>
			{/if}

			<p class="recordatorio">Importar <strong>reemplaza TODOS</strong> los datos de este dispositivo por los del backup.</p>
			<div class="botones">
				<button class="cancelar" onclick={cancelarImport}>Cancelar</button>
				<button class="confirmar" onclick={confirmarImport}>Importar de todos modos</button>
			</div>
		</div>
	{/if}

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
{/if}

<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	h2 { font-size: 1.05rem; margin-top: 24px; }
	.acciones { display: flex; gap: 10px; flex-wrap: wrap; margin: 12px 0; }
	.exp, .imp { border: 1px solid var(--border); border-radius: 6px; padding: 9px 16px; cursor: pointer; font-size: 0.9rem; font-weight: 600; }
	.exp { background: var(--accent); color: #fff; border-color: var(--accent); }
	.imp { background: var(--surface-2); color: var(--text); }
	.imp:hover { border-color: var(--accent); }
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
	.cancelar { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 9px 16px; cursor: pointer; }
	.confirmar { background: var(--neg); color: #fff; border: none; border-radius: 6px; padding: 9px 16px; cursor: pointer; font-weight: 600; }
	.nota { font-size: 0.8rem; color: var(--text-dim); margin-top: 12px; max-width: 560px; line-height: 1.5; }
</style>
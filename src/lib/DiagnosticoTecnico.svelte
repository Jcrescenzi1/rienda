<script lang="ts">
	// src/lib/DiagnosticoTecnico.svelte
	// Bloque de diagnóstico copiable (Blindaje iOS). Texto plano, etiquetas
	// cortas, legible en WhatsApp. Usado en 3 lugares: la pantalla diferenciada
	// de arranque, "No pudimos verificar tu perfil" y el banner rojo global.
	// Lo que no se pudo leer va como "desconocido"; nunca rompe el armado.
	import { Toast } from './toast.svelte';
	import { leerMeta } from './db/meta';
	import { formatBytesMB, type SenalPool, type MarcaPerfil, type EstadoStorage } from './db/senales';

	let { pantalla, senalPool, marcaPerfil, estadoStorage, errorCrudo = null, abierto = false }: {
		pantalla: string;
		senalPool: SenalPool;
		marcaPerfil: MarcaPerfil | null;
		estadoStorage: EstadoStorage;
		errorCrudo?: unknown;
		abierto?: boolean;
	} = $props();

	const toast = new Toast();

	// Campos que dependen de leer la base o APIs async: arrancan en "desconocido"
	// y se completan solos si responden. Nunca bloquean el render del bloque.
	let ultimaExportacion = $state('desconocido');
	let cacheSW = $state('desconocido');

	$effect(() => {
		leerMeta()
			.then((m) => { ultimaExportacion = m.ultima_exportacion ?? 'sin dato'; })
			.catch(() => { ultimaExportacion = 'desconocido'; });
	});

	$effect(() => {
		if (!('caches' in globalThis)) return;
		caches.keys()
			.then((ks) => { cacheSW = ks.length ? ks.join(', ') : 'desconocido'; })
			.catch(() => { /* desconocido, ya es el default */ });
	});

	function siNo(v: boolean | null): string {
		return v === null ? 'desconocido' : v ? 'sí' : 'no';
	}

	function esStandalone(): boolean {
		try {
			return matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
		} catch {
			return false;
		}
	}

	function textoError(): string | null {
		if (errorCrudo == null) return null;
		if (errorCrudo instanceof Error) return errorCrudo.message;
		try { return String(errorCrudo); } catch { return 'desconocido'; }
	}

	function stackError(): string | null {
		return errorCrudo instanceof Error && errorCrudo.stack ? errorCrudo.stack : null;
	}

	function armarTexto(): string {
		const lineas = [
			'Diagnóstico técnico Rienda',
			`Pantalla: ${pantalla}`,
			`Fecha: ${new Date().toISOString()}`,
			`Pool OPFS: ${senalPool ? `existe=${siNo(senalPool.existe)} archivos=${senalPool.archivos} bytes=${senalPool.bytes}` : 'desconocido'}`,
			`Marca perfil: ${marcaPerfil ? `creado=${marcaPerfil.creado_en} ultimo_ok=${marcaPerfil.ultimo_arranque_ok}` : 'sin marca'}`,
			`Almacenamiento persistente: ${siNo(estadoStorage.persistido)}`,
			`Uso/cuota: ${formatBytesMB(estadoStorage.usage)} / ${formatBytesMB(estadoStorage.quota)}`,
			`Cache SW: ${cacheSW}`,
			`Standalone: ${esStandalone() ? 'sí' : 'no'}`,
			`User agent: ${navigator.userAgent}`,
			`Última exportación: ${ultimaExportacion}`
		];
		const err = textoError();
		if (err) lineas.push(`Error: ${err}`);
		const stack = stackError();
		if (stack) lineas.push(`Stack: ${stack}`);
		return lineas.join('\n');
	}

	async function onCopiar() {
		try {
			await navigator.clipboard.writeText(armarTexto());
			toast.exito('Copiado ✅');
		} catch (e) {
			toast.errorTecnico(e);
		}
	}
</script>

<details class="form-panel diag-tecnico" open={abierto}>
	<summary>Ver detalle técnico</summary>
	<div class="form diag-cuerpo">
		<pre class="diag-pre">{armarTexto()}</pre>
		<button type="button" class="btn btn-secondary" onclick={onCopiar}>Copiar</button>
		{#if toast.texto}<p class="diag-msg" class:err={toast.esError}>{#if toast.esError}<span class="diag-err-x">✗</span> {/if}{toast.texto}</p>{/if}
	</div>
</details>

<style>
	.diag-tecnico { font-size: 0.85rem; }
	.diag-cuerpo { max-width: none; }
	.diag-pre {
		white-space: pre-wrap; word-break: break-word; margin: 0;
		background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px;
		padding: 8px 10px; font-family: var(--font-num); font-size: 0.76rem; line-height: 1.5;
	}
	.diag-msg { font-size: 0.85rem; margin: 0; }
	.diag-msg.err { color: var(--neg); }
	.diag-err-x { font-size: 1.2em; line-height: 1; }
</style>

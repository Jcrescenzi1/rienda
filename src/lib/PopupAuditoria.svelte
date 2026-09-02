<script lang="ts">
	// Popup de auditoría previa a la carga de Excel (Finanzas / Inversiones):
	// muestra, hoja por hoja, qué se va a cargar, qué no y por qué, ANTES de
	// tocar la base. Reusado por los dos módulos, parametrizado por `modulo`.
	// Reglas de confirmación (definen si se puede ofrecer "Aceptar"):
	//  - Finanzas: cada hoja se confirma independiente. Si hay error en una
	//    hoja pero otra está ok, se ofrece avanzar solo con la que está ok.
	//  - Inversiones: todo o nada (dependencia Activos → Renta). Si hay
	//    cualquier error, no se ofrece Aceptar.
	//  - Si TODAS las hojas vienen 'no_encontrada' (archivo vacío o de otro
	//    formato), tampoco se ofrece Aceptar: no hay nada para confirmar.
	import type { DiagnosticoHoja } from '$lib/db/precarga';

	let { abierto = false, modulo, diagnosticos, procesando = false, onAceptar, onCerrar }:
		{
			abierto?: boolean;
			modulo: 'finanzas' | 'inversiones';
			diagnosticos: DiagnosticoHoja[];
			procesando?: boolean;
			onAceptar: () => void;
			onCerrar: () => void;
		} = $props();

	function lineaHoja(d: DiagnosticoHoja): string {
		if (d.estado === 'ok') return `${d.hoja}: sin errores · ${d.nuevas} nuevo(s) · ${d.duplicadas} duplicado(s)`;
		if (d.estado === 'error') return `${d.hoja}: ${d.numErrores} error(es) detectado(s) — ${d.mensajeError}`;
		return `${d.hoja}: no se encontró esta hoja en el archivo`;
	}

	const evaluado = $derived.by(() => {
		const conError = diagnosticos.filter((d) => d.estado === 'error');
		const conOk = diagnosticos.filter((d) => d.estado === 'ok');
		const soloNoEncontradas = diagnosticos.length > 0 && diagnosticos.every((d) => d.estado === 'no_encontrada');
		// Duplicados aparte: la cuenta real que se va a cargar es "nuevas" de las
		// hojas 'ok' — se lo aclaramos siempre en la pregunta de confirmación para
		// que quede claro cuando la carga es parcial (hay duplicados de por medio).
		const nuevasOk = conOk.reduce((acc, d) => acc + d.nuevas, 0);

		if (soloNoEncontradas) return { mensaje: 'No se encontraron datos para cargar en este archivo.', aceptar: false };
		if (conError.length === 0) {
			return { mensaje: `Finalizó la auditoría del archivo sin errores encontrados. ¿Avanza con la carga de los ${nuevasOk} registro(s) nuevo(s)?`, aceptar: true };
		}

		const nombresError = conError.map((d) => d.hoja).join(', ');
		if (modulo === 'inversiones') return { mensaje: `No se podrá cargar los registros hasta corregir el error en ${nombresError}.`, aceptar: false };
		if (conOk.length > 0) {
			const nombresOk = conOk.map((d) => d.hoja).join(', ');
			return { mensaje: `Se encontraron errores en la hoja ${nombresError} por lo que no se puede cargar. ¿Avanza con la carga de los ${nuevasOk} registro(s) nuevo(s) de ${nombresOk}?`, aceptar: true };
		}
		return { mensaje: `Se encontraron errores en ${nombresError}. No hay ninguna hoja sin errores para cargar.`, aceptar: false };
	});
</script>

{#if abierto}
	<div class="aud-backdrop">
		<div class="aud-sheet">
			<h2 class="aud-tit">Auditoría de importación — {modulo === 'finanzas' ? 'Finanzas' : 'Inversiones'}</h2>
			<ul class="aud-lista">
				{#each diagnosticos as d (d.hoja)}
					<li class="aud-linea" class:err={d.estado === 'error'}>{lineaHoja(d)}</li>
				{/each}
			</ul>
			<p class="aud-msg">{evaluado.mensaje}</p>
			<div class="aud-botones">
				<button class="btn btn-secondary" onclick={onCerrar} disabled={procesando}>{evaluado.aceptar ? 'Cancelar' : 'Cerrar'}</button>
				{#if evaluado.aceptar}
					<button class="btn btn-primary" onclick={onAceptar} disabled={procesando}>{procesando ? 'Cargando…' : 'Aceptar'}</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.aud-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 16px; }
	.aud-sheet { width: 100%; max-width: 480px; max-height: 85vh; overflow-y: auto; background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 18px; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4); }
	.aud-tit { font-family: var(--font-display); font-size: 0.95rem; margin: 0 0 12px; }
	.aud-lista { list-style: none; padding: 0; margin: 0 0 12px; display: flex; flex-direction: column; gap: 8px; }
	.aud-linea { font-size: 0.85rem; line-height: 1.5; white-space: pre-line; border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 8px 10px; }
	.aud-linea.err { border-color: var(--neg); color: var(--neg); }
	.aud-msg { font-size: 0.88rem; line-height: 1.5; margin: 0 0 14px; }
	.aud-botones { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
</style>

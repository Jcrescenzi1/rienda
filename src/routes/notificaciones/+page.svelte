<script lang="ts">
	import { onMount } from 'svelte';
	import { cargarNotificaciones, marcarRecurrentesVistos, faltanTxt, type Notificaciones } from '$lib/notificaciones';
	import { notif } from '$lib/notif.svelte';
	import { query } from '$lib/db/client';
	import { setMeta } from '$lib/db/meta';
	import { pwa, instalarApp } from '$lib/pwa.svelte';
	import { goto } from '$app/navigation';
	import { actualizarCotizaciones } from '$lib/db/cotizaciones';

	let cargando = $state(true);
	let n = $state<Notificaciones>({ pagos: [], cobros: [], reglas: [], badge: 0 });
	let actualizando = $state(false);

	// Hay algo para mostrar si hay reglas rotas o recurrentes en ventana (vistos o no).
	let vacio = $derived(n.reglas.length === 0 && n.pagos.length === 0 && n.cobros.length === 0);

	// ===== Onboarding (primeros pasos) — NO cuenta para el badge =====
	// Cada paso queda resuelto para siempre al Configurar u Omitir (deja su flag en 1).
	// Algunos además se autocompletan por dato (fijos, ingresos fijos, app instalada).
	type Paso = { clave: string; flag: string; label: string; href?: string; instalar?: boolean };
	let pasosPend = $state<Paso[]>([]);

	async function cargarPasos() {
		const flags = (await query(
			"SELECT clave FROM meta WHERE clave IN ('paso_categorias','paso_tarjeta','paso_instalar','paso_fijos','paso_ingresos_fijos','paso_meta_ahorro')"
		)) as any[];
		const set = new Set(flags.map((f) => f.clave));
		const nf = (await query('SELECT COUNT(*) AS n FROM suscripcion WHERE perfil_id=1')) as any[];
		const nif = (await query('SELECT COUNT(*) AS n FROM ingreso_fijo WHERE perfil_id=1')) as any[];
		const todos: (Paso & { done: boolean })[] = [
			{ clave: 'categorias', flag: 'paso_categorias', label: 'Revisá y ajustá tus categorías', href: '/configuracion', done: set.has('paso_categorias') },
			{ clave: 'instalar', flag: 'paso_instalar', label: 'Instalá la app en tu teléfono', instalar: true, done: pwa.standalone || set.has('paso_instalar') },
			{ clave: 'fijos', flag: 'paso_fijos', label: 'Cargá tus gastos recurrentes', href: '/suscripciones', done: (nf[0]?.n ?? 0) > 0 || set.has('paso_fijos') },
			{ clave: 'ingfijos', flag: 'paso_ingresos_fijos', label: 'Cargá tus ingresos recurrentes', href: '/ingresos-fijos', done: (nif[0]?.n ?? 0) > 0 || set.has('paso_ingresos_fijos') },
			{ clave: 'tarjeta', flag: 'paso_tarjeta', label: 'Renombrá o elegí tu tarjeta', href: '/configuracion', done: set.has('paso_tarjeta') },
			{ clave: 'meta', flag: 'paso_meta_ahorro', label: 'Fijá tu meta de ahorro', href: '/evolucion-finanzas?tab=capacidad', done: set.has('paso_meta_ahorro') }
		];
		pasosPend = todos.filter((p) => !p.done);
	}

	async function configurarPaso(p: Paso) {
		await setMeta(p.flag, '1');
		if (p.instalar) { await instalarApp(); await cargarPasos(); }
		else if (p.href) goto(p.href);
	}
	async function omitirPaso(p: Paso) {
		await setMeta(p.flag, '1');
		await cargarPasos();
	}

	onMount(async () => {
		n = await cargarNotificaciones();
		await cargarPasos();
		cargando = false;
		// Entrar al centro marca vistos los recurrentes en ventana (se apagan del badge,
		// siguen en la lista) y refresca el badge de la campana en el acto.
		await marcarRecurrentesVistos();
		await notif.refrescar();
	});

	async function actualizarCotiz() {
		actualizando = true;
		try {
			const msg = await actualizarCotizaciones();
			alert(msg);
			location.reload();
		} catch (e: any) {
			console.error(e); // Brief H / B3: detalle a consola, no crudo en pantalla.
			alert('Ocurrió un error. Contactá al administrador.');
			actualizando = false;
		}
	}
</script>

<h1>Notificaciones</h1>
<a class="btn-volver" href="/">← Volver a Cuenta Corriente</a>

{#if cargando}
	<p class="nota">Cargando…</p>
{:else if vacio && !pasosPend.length}
	<div class="limpio">
		<span class="tilde">✓</span>
		<p>Está todo al día. No hay nada pendiente por ahora.</p>
	</div>
{:else}
	{#if n.pagos.length}
		<section class="grupo">
			<h2><a class="h2-link" href="/suscripciones">Próximos <span class="subrayado">Gastos Recurrentes</span> →</a></h2>
			<ul class="lista">
				{#each n.pagos as p (p.nombre)}
					<li><span class="rec-nombre">{p.nombre}</span><span class="rec-dias">{faltanTxt(p.dias)}</span></li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if n.cobros.length}
		<section class="grupo">
			<h2><a class="h2-link" href="/ingresos-fijos">Próximos <span class="subrayado">Ingresos Recurrentes</span> →</a></h2>
			<ul class="lista">
				{#each n.cobros as c (c.nombre)}
					<li><span class="rec-nombre">{c.nombre}</span><span class="rec-dias">{faltanTxt(c.dias)}</span></li>
				{/each}
			</ul>
		</section>
	{/if}

	{#each n.reglas as r (r.tipo)}
		{#if r.accion === 'cotiz'}
			<button class="fila" onclick={actualizarCotiz} disabled={actualizando}>
				<span>{actualizando ? 'Actualizando…' : r.texto}</span><span class="chevron">›</span>
			</button>
		{:else}
			<a class="fila" href={r.href}>
				<span>{r.texto}</span><span class="chevron">›</span>
			</a>
		{/if}
	{/each}

	{#if pasosPend.length}
		<section class="onboarding">
			<h2>Primeros pasos</h2>
			<p class="ob-intro">Configurá lo esencial para sacarle el jugo a la app. Podés omitir lo que no te sirva.</p>
			{#each pasosPend as p (p.clave)}
				<div class="ob-paso">
					<span class="ob-label">{p.label}</span>
					<span class="ob-acc">
						<button class="ob-conf" onclick={() => configurarPaso(p)}>Configurar</button>
						<button class="ob-omit" onclick={() => omitirPaso(p)} title="Omitir" aria-label="Omitir">✓</button>
					</span>
				</div>
			{/each}
		</section>
	{/if}
{/if}

<style>
	/* .volver eliminado (Brief H / B5): usa el .btn-volver global de +layout.svelte,
	   ahora debajo del título en vez de arriba. */
	h1 { margin: 0 0 14px; }
	h2 { font-size: 0.95rem; margin: 0 0 8px; }
	/* Título de tarjeta como acceso directo a la pantalla de recurrentes (a pedido
	   de Julián): reemplaza el "Ver todos" que se había sacado por no ser
	   tap-despliega — acá el link vive en el título, no en un item de la lista. */
	.h2-link { color: var(--accent); text-decoration: none; }
	.h2-link .subrayado { text-decoration: underline; }
	.h2-link:hover { text-decoration: underline; }
	.nota { color: var(--text-dim); font-size: 0.85rem; }

	/* Onboarding: se lee distinto de las alertas (regla neutra, no roja). */
	.onboarding { border: 1px solid var(--border); border-left: 3px solid var(--text-dim); background: var(--surface); border-radius: 0 8px 8px 0; padding: 12px 14px; margin: 14px 0 0; }
	.onboarding h2 { margin: 0 0 4px; }
	.ob-intro { font-size: 0.8rem; color: var(--text-dim); margin: 0 0 10px; }
	.ob-paso { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--border); }
	.ob-paso:last-child { border-bottom: none; }
	.ob-label { font-size: 0.88rem; }
	.ob-acc { display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0; }
	.ob-conf { background: none; border: 1px solid var(--accent); color: var(--accent); border-radius: 6px; padding: 4px 10px; font-size: 0.8rem; cursor: pointer; }
	.ob-conf:hover { background: rgba(91, 157, 255, 0.08); }
	.ob-omit { background: none; border: 1px solid var(--border); color: var(--text-dim); border-radius: 6px; padding: 4px 9px; font-size: 0.82rem; cursor: pointer; }
	.ob-omit:hover { color: var(--pos); border-color: var(--pos); }

	.limpio {
		display: flex; align-items: center; gap: 12px;
		border: 1px solid var(--border); border-left: 3px solid var(--pos);
		background: var(--surface); border-radius: 0 8px 8px 0; padding: 16px 16px;
	}
	.limpio .tilde { color: var(--pos); font-size: 1.4rem; font-weight: 700; }
	.limpio p { margin: 0; color: var(--text); }

	.grupo {
		border: 1px solid var(--border); border-left: 3px solid var(--accent);
		background: var(--surface); border-radius: 0 8px 8px 0; padding: 12px 14px; margin: 0 0 10px;
	}
	.lista { list-style: none; margin: 0 0 6px; padding: 0; }
	.lista li { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 5px 0; border-bottom: 1px solid var(--border); }
	.lista li:last-child { border-bottom: none; }
	.rec-nombre { font-weight: 600; }
	.rec-dias { color: var(--text-dim); font-size: 0.82rem; white-space: nowrap; }

	.fila {
		display: flex; justify-content: space-between; align-items: center; gap: 12px;
		text-align: left; font: inherit; cursor: pointer;
		border: 1px solid var(--border); border-left: 3px solid var(--accent);
		background: var(--surface); color: var(--text); border-radius: 0 8px 8px 0;
		padding: 12px 14px; margin: 0 0 10px; text-decoration: none;
	}
	.fila:hover { border-color: var(--accent); }
	.fila:disabled { opacity: 0.6; cursor: default; }
	.chevron { color: var(--text-dim); font-size: 1.1rem; flex-shrink: 0; }
</style>

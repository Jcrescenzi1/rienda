<script lang="ts">
	// Selector de activo con búsqueda incremental. Reemplaza al <select> nativo en
	// las pantallas que eligen un activo: con el catálogo de data912 sincronizado,
	// la tabla `activo` pasa de ~15 filas a varios cientos, y un desplegable nativo
	// con esa cantidad de opciones es inusable en mobile (no se puede tipear para
	// filtrar, hay que scrollear a mano).
	//
	// Deliberadamente NO filtra el universo de activos: el usuario tiene que poder
	// elegir cualquiera del catálogo, incluso uno que nunca operó (es justamente el
	// caso de cargar su primer movimiento). Lo que cambia es cómo se navega, no qué
	// se ofrece.

	type ActivoOpt = { id: number; ticker: string; nombre: string; tipo: string; moneda?: string };

	let {
		activos = [],
		value = $bindable(''),
		placeholder = 'Buscar por ticker o nombre…',
		id = undefined,
		onselect = undefined,
		especieDe = undefined,
		especieInicial = 'Todas'
	}: {
		activos?: ActivoOpt[];
		value?: string;
		placeholder?: string;
		id?: string;
		onselect?: (a: ActivoOpt) => void;
		// Faceta opcional de segundo nivel. La pantalla que la conoce (Mercado) pasa
		// la función que deriva la especie de un activo; las que no, no muestran esa
		// fila de chips. Así el componente no necesita saber nada de especies.
		especieDe?: (a: ActivoOpt) => string;
		// Chip de especie premarcado. Mercado arranca en 'Pesos' porque es la especie
		// que tiene serie histórica publicada: si no, el camino por defecto lleva a
		// activos sin gráfico.
		especieInicial?: string;
	} = $props();

	// Cuántas opciones se dibujan como máximo. Con el catálogo entero, montar
	// cientos de nodos por cada tecla tipeada se nota en mobile; el corte mantiene
	// la lista liviana y empuja a afinar la búsqueda (mismo criterio que el listado
	// de Mercado).
	const TOPE = 40;

	let texto = $state('');
	let abierto = $state(false);
	let resaltado = $state(0);
	let caja: HTMLDivElement | undefined = $state();
	// Facetas: acotan el universo ANTES del texto. Con cientos de activos, escribir
	// "GG" devuelve el papel en pesos, el MEP y el CCL mezclados con cualquier bono
	// que contenga esas letras; filtrar por tipo y especie primero deja la lista
	// corta sin tener que acordarse del ticker exacto.
	let fTipo = $state('Todos');
	// null = el usuario todavía no tocó el chip de especie; vale `especieInicial`.
	// Se modela así (y no copiando la prop al estado) para que quede explícito qué
	// es elección del usuario y qué es el default de la pantalla.
	let fEspecie = $state<string | null>(null);

	// Los chips salen de los datos, no de una lista fija: si el catálogo todavía no
	// tiene CEDEARs, no se muestra un chip de CEDEAR que no filtra nada.
	const tiposDisponibles = $derived([...new Set(activos.map((a) => a.tipo).filter(Boolean))].sort());
	const especiesDisponibles = $derived(
		especieDe ? [...new Set(activos.map((a) => especieDe(a)).filter(Boolean))].sort() : []
	);

	const elegido = $derived(activos.find((a) => String(a.id) === String(value)) ?? null);

	// Etiqueta visible de una opción. Los activos que entraron por el sync tienen
	// nombre = ticker: mostrar "GD35 · GD35" sería ruido, así que en ese caso se
	// muestra solo el ticker. Los que tienen nombre propio muestran los dos.
	function etiqueta(a: ActivoOpt): string {
		const t = a.ticker ?? '';
		const n = a.nombre ?? '';
		return n && n.toUpperCase() !== t.toUpperCase() ? `${t} · ${n}` : t;
	}

	// La especie premarcada solo se aplica si existe en los datos: con el catálogo
	// vacío o sin especies dólar, un default de 'Pesos' que no matchea nada dejaría
	// el selector en blanco sin motivo visible.
	const especieActiva = $derived.by(() => {
		const e = fEspecie ?? especieInicial;
		return e !== 'Todas' && !especiesDisponibles.includes(e) ? 'Todas' : e;
	});

	// Universo tras aplicar las facetas (sin el texto todavía).
	const porFacetas = $derived(
		activos.filter(
			(a) =>
				(fTipo === 'Todos' || a.tipo === fTipo) &&
				(especieActiva === 'Todas' || !especieDe || especieDe(a) === especieActiva)
		)
	);

	const filtrados = $derived.by(() => {
		const base = porFacetas;
		const q = texto.trim().toLowerCase();
		if (!q) return base.slice(0, TOPE);
		// Los que empiezan con lo tipeado van primero: si escribís "GD3" querés
		// GD30/GD35 arriba, no un nombre que contenga esas letras en el medio.
		const empiezan: ActivoOpt[] = [];
		const contienen: ActivoOpt[] = [];
		for (const a of base) {
			const t = String(a.ticker ?? '').toLowerCase();
			const n = String(a.nombre ?? '').toLowerCase();
			if (t.startsWith(q) || n.startsWith(q)) empiezan.push(a);
			else if (t.includes(q) || n.includes(q)) contienen.push(a);
			if (empiezan.length >= TOPE) break;
		}
		return [...empiezan, ...contienen].slice(0, TOPE);
	});

	// Al cambiar el filtro el resaltado vuelve al principio: si no, podía quedar
	// apuntando a un índice que ya no existe en la lista nueva.
	$effect(() => {
		filtrados;
		resaltado = 0;
	});

	// stopPropagation: el mismo click que abre el combo sigue viaje hasta el
	// handler de `window` que cierra al tocar afuera. Para cuando ese handler
	// corre, el botón que se tocó puede haber sido reemplazado por el input, con
	// lo cual "está adentro de la caja" ya no se puede comprobar y el combo se
	// cerraría solo. Cortar la propagación acá lo vuelve independiente del orden
	// en que Svelte aplique el cambio en el DOM.
	function abrir(e: MouseEvent) {
		e.stopPropagation();
		abierto = true;
		texto = '';
	}

	function elegir(a: ActivoOpt) {
		value = String(a.id);
		abierto = false;
		texto = '';
		onselect?.(a);
	}

	function teclas(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			resaltado = Math.min(resaltado + 1, filtrados.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			resaltado = Math.max(resaltado - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const a = filtrados[resaltado];
			if (a) elegir(a);
		} else if (e.key === 'Escape') {
			abierto = false;
		}
	}

	// Click fuera: cierra sin elegir (queda lo que ya estaba seleccionado).
	function afuera(e: MouseEvent) {
		if (abierto && caja && !caja.contains(e.target as Node)) abierto = false;
	}

	// Foco al abrir, vía action en vez del atributo `autofocus` (que dispara el
	// aviso de accesibilidad de Svelte): acá el foco es la razón de ser del
	// control — se abre justamente para escribir.
	function enfocar(el: HTMLInputElement) {
		el.focus();
	}
</script>

<svelte:window onclick={afuera} />

<div class="combo" bind:this={caja}>
	{#if abierto}
		<input
			{id}
			type="search"
			class="combo-input"
			bind:value={texto}
			{placeholder}
			onkeydown={teclas}
			autocomplete="off"
			use:enfocar
		/>
		<div class="combo-panel">
		{#if tiposDisponibles.length > 1 || especiesDisponibles.length > 1}
			<div class="combo-facetas">
				{#if tiposDisponibles.length > 1}
					<div class="combo-chips">
						<button type="button" class:on={fTipo === 'Todos'} onclick={() => (fTipo = 'Todos')}>Todos</button>
						{#each tiposDisponibles as t (t)}
							<button type="button" class:on={fTipo === t} onclick={() => (fTipo = t)}>{t}</button>
						{/each}
					</div>
				{/if}
				{#if especiesDisponibles.length > 1}
					<div class="combo-chips">
						<button type="button" class:on={especieActiva === 'Todas'} onclick={() => (fEspecie = 'Todas')}>Todas</button>
						{#each especiesDisponibles as e (e)}
							<button type="button" class:on={especieActiva === e} onclick={() => (fEspecie = e)}>{e}</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
		<ul class="combo-lista">
			{#each filtrados as a, i (a.id)}
				<li>
					<button
						type="button"
						class="combo-opcion"
						class:resaltada={i === resaltado}
						onclick={() => elegir(a)}
					>
						<span class="combo-tk">{a.ticker}</span>
						<span class="combo-nom">{etiqueta(a) === a.ticker ? '' : a.nombre}</span>
						<span class="combo-meta">{a.tipo}{a.moneda ? ' · ' + a.moneda : ''}</span>
					</button>
				</li>
			{/each}
			{#if filtrados.length === 0}
				<li class="combo-vacio">Sin resultados{fTipo !== 'Todos' || especieActiva !== 'Todas' ? ' con esos filtros' : ''}.</li>
			{:else if porFacetas.length > filtrados.length}
				<li class="combo-nota">Mostrando {filtrados.length} de {porFacetas.length} — seguí escribiendo para afinar.</li>
			{/if}
		</ul>
		</div>
	{:else}
		<button type="button" class="combo-trigger" class:vacio={!elegido} onclick={(e) => abrir(e)}>
			{elegido ? etiqueta(elegido) : 'Elegir…'}
			<span class="combo-flecha">▾</span>
		</button>
	{/if}
</div>

<style>
	.combo { position: relative; }
	.combo-trigger,
	.combo-input {
		width: 100%;
		box-sizing: border-box;
		padding: 7px 9px;
		font-size: 0.95rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--surface-2, var(--surface));
		color: var(--text);
	}
	.combo-trigger {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		text-align: left;
		cursor: pointer;
	}
	.combo-trigger.vacio { color: var(--text-dim); }
	.combo-flecha { color: var(--text-dim); flex-shrink: 0; }

	/* Panel desplegable: chips de faceta arriba, lista abajo. Va posicionado en
	   absoluto para que abrir el combo no empuje el contenido de la pantalla. */
	.combo-panel {
		position: absolute;
		z-index: 30;
		left: 0;
		right: 0;
		top: 100%;
		margin-top: 4px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--surface);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
		overflow: hidden;
	}
	.combo-facetas {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 6px 8px;
		border-bottom: 1px solid var(--border);
	}
	.combo-chips { display: flex; gap: 4px; flex-wrap: wrap; }
	.combo-chips button {
		font-size: 0.68rem;
		padding: 2px 8px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface-2, var(--surface));
		color: var(--text-dim);
		cursor: pointer;
	}
	.combo-chips button.on { background: var(--accent); border-color: var(--accent); color: #fff; }

	.combo-lista {
		margin: 0;
		padding: 0;
		list-style: none;
		max-height: 260px;
		overflow-y: auto;
	}
	.combo-opcion {
		display: flex;
		align-items: baseline;
		gap: 8px;
		width: 100%;
		box-sizing: border-box;
		padding: 8px 10px;
		border: 0;
		background: none;
		color: var(--text);
		text-align: left;
		font-size: 0.9rem;
		cursor: pointer;
	}
	.combo-opcion.resaltada { background: rgba(91, 157, 255, 0.14); }
	.combo-tk { font-family: var(--font-mono, monospace); color: var(--accent); font-weight: 600; flex-shrink: 0; }
	.combo-nom { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.combo-meta { font-size: 0.76rem; color: var(--text-dim); white-space: nowrap; flex-shrink: 0; }
	.combo-vacio,
	.combo-nota { padding: 8px 10px; font-size: 0.8rem; color: var(--text-dim); font-style: italic; }
</style>

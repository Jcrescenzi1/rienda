<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';

	const hoy = new Date();
	let periodo = $state(hoy.toISOString().slice(0, 7));
	let grupos = $state<any[]>([]);
	let consolidado = $state<any[]>([]);
	let totales = $state<any>({ n2: 0, n1: 0, presup: 0, real: 0 });
	let rango = $state('');
	let cargando = $state(true);

	function addMonths(ym: string, delta: number): string {
		const [y, m] = ym.split('-').map(Number);
		const d = new Date(y, m - 1 + delta, 1);
		return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
	}
	function desvio(real: number, presup: number): string {
		if (!presup) return '—';
		if (real <= presup) return 'En margen';
		if (real <= presup * 1.25) return 'Superado';
		return 'Muy superado';
	}

	// Mapa fecha_gasto -> periodo de sueldo. Se arma con las fechas de los sueldos.
	let cortes: { fecha: string; periodo: string }[] = [];

	function periodoDeFecha(fecha: string): string | null {
		let elegido: string | null = null;
		for (const c of cortes) {
			if (c.fecha <= fecha) elegido = c.periodo;
			else break;
		}
		return elegido;
	}

	async function cargar() {
		cargando = true;

		// 1) Cortes = fechas de los sueldos (categoria Salario, tipo Sueldo) con su periodo
		const sueldos = (await query(
			"SELECT fecha, periodo FROM ingreso WHERE perfil_id=1 AND categoria='Salario' AND tipo='Sueldo' AND periodo IS NOT NULL ORDER BY fecha"
		)) as any[];
		cortes = sueldos.map((s) => ({ fecha: s.fecha, periodo: s.periodo }));

		const n = periodo;
		const n1 = addMonths(periodo, -1);
		const n2 = addMonths(periodo, -2);
		const objetivo = new Set([n, n1, n2]);

		// rango de fechas del período visible (del sueldo que lo abre al día antes del siguiente)
		const idx = cortes.findIndex((c) => c.periodo === n);
		if (idx >= 0) {
			const ini = cortes[idx].fecha;
			const fin = idx + 1 < cortes.length ? cortes[idx + 1].fecha : 'hoy';
			rango = `${ini} al ${fin === 'hoy' ? 'hoy' : fin}`;
		} else rango = '(sin sueldo cargado para este período)';

		// 2) Traigo TODOS los gastos con subcategoria efectiva y los asigno a período en JS
		const gastos = (await query(
			`SELECT g.fecha, g.monto, g.categoria_id,
			        COALESCE(g.subcategoria_id, m.subcategoria_id) AS scid
			 FROM gasto g
			 LEFT JOIN mapeo_detalle m ON m.perfil_id = g.perfil_id AND m.detalle = g.detalle
			 WHERE g.perfil_id = 1`
		)) as any[];

		// categoría habitual por subcategoría
		const hab = (await query(
			`SELECT scid, categoria_id, COUNT(*) AS c FROM (
			   SELECT COALESCE(g.subcategoria_id, m.subcategoria_id) AS scid, g.categoria_id
			   FROM gasto g LEFT JOIN mapeo_detalle m ON m.perfil_id=g.perfil_id AND m.detalle=g.detalle
			   WHERE g.perfil_id=1
			 ) GROUP BY scid, categoria_id`
		)) as any[];
		const homeCat: Record<string, number | null> = {};
		const bestC: Record<string, number> = {};
		for (const h of hab) {
			const k = h.scid == null ? 'null' : String(h.scid);
			if (bestC[k] === undefined || h.c > bestC[k]) { bestC[k] = h.c; homeCat[k] = h.categoria_id; }
		}

		const subs = (await query('SELECT id, nombre FROM subcategoria WHERE perfil_id=1 AND activa=1')) as any[];
		const nombreSub: Record<number, string> = {};
		for (const s of subs) nombreSub[s.id] = s.nombre;
		const cats = (await query('SELECT id, nombre FROM categoria WHERE perfil_id=1')) as any[];
		const nombreCat: Record<number, string> = {};
		for (const c of cats) nombreCat[c.id] = c.nombre;

		const presup = (await query("SELECT subcategoria_id, monto FROM presupuesto WHERE perfil_id=1 AND periodo='default'")) as any[];
		const presupMap: Record<number, number> = {};
		for (const p of presup) presupMap[p.subcategoria_id] = p.monto;

		// 3) Acumular por subcategoría, solo para los 3 períodos objetivo
		const key = (id: any) => (id == null ? 'null' : String(id));
		const acc: Record<string, any> = {};
		for (const g of gastos) {
			const per = periodoDeFecha(g.fecha);
			if (!per || !objetivo.has(per)) continue;
			const k = key(g.scid);
			acc[k] ??= { scid: g.scid, n2: 0, n1: 0, real: 0 };
			if (per === n2) acc[k].n2 += g.monto;
			else if (per === n1) acc[k].n1 += g.monto;
			else if (per === n) acc[k].real += g.monto;
		}
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
				estado: desvio(a.real, presupVal)
			};
		});

		const map: Record<string, any[]> = {};
		for (const f of filas) (map[f.catNombre] ??= []).push(f);
		const gr = Object.keys(map).sort((a, b) => a.localeCompare(b, 'es')).map((cat) => {
			const rows = map[cat].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
			const sub = rows.reduce((t, r) => ({ n2: t.n2 + r.n2, n1: t.n1 + r.n1, presup: t.presup + r.presup, real: t.real + r.real }), { n2: 0, n1: 0, presup: 0, real: 0 });
			return { cat, rows, sub };
		});
		grupos = gr;
		consolidado = gr.map((g) => ({ cat: g.cat, ...g.sub, estado: desvio(g.sub.real, g.sub.presup) }));
		totales = filas.reduce((t, r) => ({ n2: t.n2 + r.n2, n1: t.n1 + r.n1, presup: t.presup + r.presup, real: t.real + r.real }), { n2: 0, n1: 0, presup: 0, real: 0 });
		cargando = false;
	}

	async function guardarPresup(scid: number, valor: string) {
		const monto = Number(valor);
		if (scid == null || isNaN(monto) || monto < 0) return;
		await query("INSERT INTO presupuesto (perfil_id, subcategoria_id, periodo, monto) VALUES (1, ?, 'default', ?) ON CONFLICT(perfil_id, subcategoria_id, periodo) DO UPDATE SET monto = excluded.monto", [scid, monto]);
		await cargar();
	}

	onMount(cargar);

	const peso = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-AR');
	const claseEstado = (e: string) => e === 'En margen' ? 'ok' : e === 'Superado' ? 'warn' : e === 'Muy superado' ? 'bad' : 'none';
</script>

<h1>Presupuesto</h1>

<div class="accesos">
	<a href="/gastos" class="btn-carga">➕ Cargar gasto</a>
	<a href="/credito" class="btn-carga sec">Gastos en Crédito</a>
	<a href="/suscripciones" class="btn-carga sec">Ver Suscripciones</a>
</div>

<label class="sel">Período de sueldo: <input type="month" bind:value={periodo} onchange={cargar} /></label>
<p class="rango">Gastos del <strong>{rango}</strong> (el período lo abre la fecha real de tu sueldo).</p>

{#if cargando}
	<p>Cargando…</p>
{:else}
	<h2>Consolidado por categoría</h2>
	<table>
		<thead><tr><th>Categoría</th><th>n-2</th><th>n-1</th><th>Presupuesto</th><th>Real</th><th>Desvío</th></tr></thead>
		<tbody>
			{#each consolidado as c (c.cat)}
				<tr>
					<td><strong>{c.cat}</strong></td>
					<td class="num">{peso(c.n2)}</td><td class="num">{peso(c.n1)}</td>
					<td class="num">{peso(c.presup)}</td><td class="num">{peso(c.real)}</td>
					<td class={claseEstado(c.estado)}>{c.estado}</td>
				</tr>
			{/each}
		</tbody>
		<tfoot>
			<tr><td><strong>Total general</strong></td>
				<td class="num">{peso(totales.n2)}</td><td class="num">{peso(totales.n1)}</td>
				<td class="num">{peso(totales.presup)}</td><td class="num">{peso(totales.real)}</td><td></td></tr>
		</tfoot>
	</table>

	<h2>Detalle por subcategoría</h2>
	<table>
		<thead><tr><th>Subcategoría</th><th>n-2</th><th>n-1</th><th>Presupuesto</th><th>Real</th><th>Desvío</th></tr></thead>
		<tbody>
			{#each grupos as g (g.cat)}
				<tr class="cat"><td colspan="6">{g.cat}</td></tr>
				{#each g.rows as f (f.scid ?? 'null')}
					<tr>
						<td class="ind">{f.nombre}</td>
						<td class="num">{peso(f.n2)}</td>
						<td class="num">{peso(f.n1)}</td>
						<td class="num">
							{#if f.scid != null}
								<input class="presup" type="number" min="0" value={f.presup || ''} placeholder="—"
									onchange={(e) => guardarPresup(f.scid, e.currentTarget.value)} />
							{:else}—{/if}
						</td>
						<td class="num">{peso(f.real)}</td>
						<td class={claseEstado(f.estado)}>{f.estado}</td>
					</tr>
				{/each}
			{/each}
		</tbody>
		<tfoot>
			<tr><td><strong>Total general</strong></td>
				<td class="num">{peso(totales.n2)}</td><td class="num">{peso(totales.n1)}</td>
				<td class="num">{peso(totales.presup)}</td><td class="num">{peso(totales.real)}</td><td></td></tr>
		</tfoot>
	</table>
{/if}

<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	.sel { font-size: 0.9rem; display: inline-flex; gap: 8px; align-items: center; margin-bottom: 4px; }
	.rango { font-size: 0.82rem; color: var(--text-dim); margin: 0 0 12px; }
	h2 { font-size: 1.05rem; margin-top: 20px; }
	table { border-collapse: collapse; width: 100%; font-size: 0.9rem; margin-bottom: 8px; }
	th, td { padding: 5px 8px; text-align: left; }
	td.num, th:nth-child(n + 2) { text-align: right; }
	td.ind { padding-left: 20px; }
	tr.cat td { background: var(--surface-2); font-weight: 700; color: var(--text); }
	input.presup { width: 90px; text-align: right; padding: 3px 5px; }
	td.ok { color: var(--pos); }
	td.warn { color: var(--warn); font-weight: 600; }
	td.bad { color: var(--neg); font-weight: 700; }
	td.none { color: var(--text-dim); }
	tfoot td { border-top: 2px solid var(--border); font-weight: 600; }
	.accesos { display: flex; gap: 8px; flex-wrap: wrap; margin: 4px 0 14px; }
	.btn-carga { display: inline-block; background: var(--accent); color: #fff; text-decoration: none; padding: 7px 14px; border-radius: 6px; font-weight: 600; font-size: 0.9rem; }
	.btn-carga.sec { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); }
</style>
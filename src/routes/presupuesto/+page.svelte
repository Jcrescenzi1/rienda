<script lang="ts">
	import { onMount } from 'svelte';
	import { query } from '$lib/db/client';

	const hoy = new Date();
	let periodo = $state(hoy.toISOString().slice(0, 7));
	let grupos = $state<any[]>([]);
	let totales = $state<any>({ n2: 0, n1: 0, presup: 0, real: 0 });
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

	async function cargar() {
		cargando = true;
		const n = periodo;
		const n1 = addMonths(periodo, -1);
		const n2 = addMonths(periodo, -2);

		// Reales por subcategoria (efectiva) para los 3 meses
		const reales = (await query(
			`SELECT COALESCE(g.subcategoria_id, m.subcategoria_id) AS scid,
			        strftime('%Y-%m', g.fecha) AS mes, SUM(g.monto) AS total
			 FROM gasto g
			 LEFT JOIN mapeo_detalle m ON m.perfil_id = g.perfil_id AND m.detalle = g.detalle
			 WHERE g.perfil_id = 1 AND strftime('%Y-%m', g.fecha) IN (?,?,?)
			 GROUP BY scid, mes`,
			[n, n1, n2]
		)) as any[];

		// Categoria habitual de cada subcategoria (la mas frecuente en todo el historial)
		const hab = (await query(
			`SELECT scid, categoria_id, COUNT(*) AS c FROM (
			   SELECT COALESCE(g.subcategoria_id, m.subcategoria_id) AS scid, g.categoria_id
			   FROM gasto g
			   LEFT JOIN mapeo_detalle m ON m.perfil_id = g.perfil_id AND m.detalle = g.detalle
			   WHERE g.perfil_id = 1
			 ) GROUP BY scid, categoria_id`
		)) as any[];
		const homeCat: Record<string, number | null> = {};
		const bestC: Record<string, number> = {};
		for (const h of hab) {
			const k = h.scid == null ? 'null' : String(h.scid);
			if (bestC[k] === undefined || h.c > bestC[k]) {
				bestC[k] = h.c;
				homeCat[k] = h.categoria_id;
			}
		}

		const subs = (await query('SELECT id, nombre FROM subcategoria WHERE perfil_id=1 AND activa=1')) as any[];
		const nombreSub: Record<number, string> = {};
		for (const s of subs) nombreSub[s.id] = s.nombre;

		const cats = (await query('SELECT id, nombre FROM categoria WHERE perfil_id=1')) as any[];
		const nombreCat: Record<number, string> = {};
		for (const c of cats) nombreCat[c.id] = c.nombre;

		const presup = (await query(
			"SELECT subcategoria_id, monto FROM presupuesto WHERE perfil_id=1 AND periodo='default'"
		)) as any[];
		const presupMap: Record<number, number> = {};
		for (const p of presup) presupMap[p.subcategoria_id] = p.monto;

		// Acumular por subcategoria
		const acc: Record<string, any> = {};
		const key = (id: any) => (id == null ? 'null' : String(id));
		for (const r of reales) {
			const k = key(r.scid);
			acc[k] ??= { scid: r.scid, n2: 0, n1: 0, real: 0 };
			if (r.mes === n2) acc[k].n2 = r.total;
			else if (r.mes === n1) acc[k].n1 = r.total;
			else if (r.mes === n) acc[k].real = r.total;
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

		// Agrupar por categoria
		const map: Record<string, any[]> = {};
		for (const f of filas) (map[f.catNombre] ??= []).push(f);
		const gr = Object.keys(map)
			.sort((a, b) => a.localeCompare(b, 'es'))
			.map((cat) => {
				const rows = map[cat].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
				const sub = rows.reduce(
					(t, r) => ({ n2: t.n2 + r.n2, n1: t.n1 + r.n1, presup: t.presup + r.presup, real: t.real + r.real }),
					{ n2: 0, n1: 0, presup: 0, real: 0 }
				);
				return { cat, rows, sub };
			});

		grupos = gr;
		totales = filas.reduce(
			(t, r) => ({ n2: t.n2 + r.n2, n1: t.n1 + r.n1, presup: t.presup + r.presup, real: t.real + r.real }),
			{ n2: 0, n1: 0, presup: 0, real: 0 }
		);
		cargando = false;
	}

	async function guardarPresup(scid: number, valor: string) {
		const monto = Number(valor);
		if (scid == null || isNaN(monto) || monto < 0) return;
		await query(
			"INSERT INTO presupuesto (perfil_id, subcategoria_id, periodo, monto) VALUES (1, ?, 'default', ?) " +
				'ON CONFLICT(perfil_id, subcategoria_id, periodo) DO UPDATE SET monto = excluded.monto',
			[scid, monto]
		);
		await cargar();
	}

	onMount(cargar);

	const peso = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-AR');
	const claseEstado = (e: string) =>
		e === 'En margen' ? 'ok' : e === 'Superado' ? 'warn' : e === 'Muy superado' ? 'bad' : 'none';
</script>

<h1>Presupuesto</h1>

<label class="sel">Mes / Año: <input type="month" bind:value={periodo} onchange={cargar} /></label>

{#if cargando}
	<p>Cargando…</p>
{:else}
	<table>
		<thead>
			<tr><th>Subcategoría</th><th>n-2</th><th>n-1</th><th>Presupuesto</th><th>Real</th><th>Desvío</th></tr>
		</thead>
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
			<tr>
				<td><strong>Total general</strong></td>
				<td class="num">{peso(totales.n2)}</td>
				<td class="num">{peso(totales.n1)}</td>
				<td class="num">{peso(totales.presup)}</td>
				<td class="num">{peso(totales.real)}</td>
				<td></td>
			</tr>
		</tfoot>
	</table>
{/if}

<style>
	:global(body) { font-family: system-ui, sans-serif; max-width: 820px; margin: 0 auto; padding: 16px; }
	.sel { font-size: 0.9rem; display: inline-flex; gap: 8px; align-items: center; margin-bottom: 8px; }
	table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
	th, td { border: 1px solid #ddd; padding: 5px 8px; text-align: left; }
	td.num, th:nth-child(n + 2) { text-align: right; }
	td.ind { padding-left: 20px; }
	tr.cat td { background: #eef2f7; font-weight: 700; }
	tr.subt td { background: #fafafa; font-style: italic; color: #555; border-top: 1px solid #bbb; }
	input.presup { width: 90px; text-align: right; padding: 3px 5px; border: 1px solid #bbb; border-radius: 4px; }
	td.ok { color: #137333; }
	td.warn { color: #b06000; font-weight: 600; }
	td.bad { color: #c5221f; font-weight: 700; }
	td.none { color: #999; }
	tfoot td { border-top: 2px solid #999; font-weight: 600; }
</style>
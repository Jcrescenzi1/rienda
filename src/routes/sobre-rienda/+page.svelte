<script lang="ts">
	import { onMount } from 'svelte';

	// Capa 3: página consultable con lo avanzado. No se fuerza; se linkea desde las
	// guías. Contenido estático (sin queries).

	// Acordeón: un ítem abierto a la vez en toda la página, mismo patrón que
	// Configuración. Arranca con el primero, salvo que la URL traiga hash
	// (linkeado desde NotaVisual, ej. /sobre-rienda#tenencia), en cuyo caso
	// arranca abierto ahí.
	let abierta = $state<string>('');
	function toggle(s: string) { abierta = abierta === s ? '' : s; }

	onMount(() => {
		const hash = window.location.hash.slice(1);
		if (hash) abierta = hash;
	});
</script>

<div class="titulo-guia">
	<h1>Sobre Rienda</h1>
</div>
<a href="/" class="btn-volver">← Volver</a>

<div class="intro">
	<p><strong>Vas a poder usar Rienda con el nivel de profundidad que prefieras.</strong> Podés comenzar cargando gastos e ingresos y luego tenés la posibilidad de profundizar con:</p>
	<ul>
		<li>Separar gastos en débito y crédito (calculando pago de cuotas)</li>
		<li>Establecer meta de ahorro y hacerle seguimiento</li>
		<li>Armar tu presupuesto mensual</li>
		<li>Realizar análisis de evolución y tendencia (nominal y real)</li>
		<li>Seguimiento de tus inversiones y activos preferidos</li>
	</ul>
</div>

<h2 class="modulo">Finanzas</h2>

<section class="acc">
	<button class="acc-h" onclick={() => toggle('periodos')}>
		<span class="flecha">{abierta === 'periodos' ? '▾' : '▸'}</span> Períodos: sueldo vs calendario
	</button>
	{#if abierta === 'periodos'}
		<div class="acc-body">
			<p>Tenés dos formas de definir tu "mes financiero" (la cambiás en Configuración):</p>
			<ul>
				<li><strong>Calendario</strong>: el período es el mes del 1 al último día. Simple y predecible.</li>
				<li><strong>Sueldo</strong>: el período lo abre el día que cobrás tu ingreso principal. Cada cobro marca un "corte"; un gasto cae en el corte cuya fecha es la última anterior o igual a la del gasto. Por eso un gasto puede aparecer en "otro mes": si cobrás el 28, lo que gastes después arranca el período siguiente.</li>
			</ul>
			<p><strong>Regla del veinte</strong>: al cargar el ingreso principal, si lo cobrás del día 20 en adelante, Rienda te sugiere imputarlo al mes siguiente (es plata para ese mes). Es solo una sugerencia editable.</p>
		</div>
	{/if}
</section>

<section class="acc">
	<button class="acc-h" onclick={() => toggle('tarjetas')}>
		<span class="flecha">{abierta === 'tarjetas' ? '▾' : '▸'}</span> Tarjetas y crédito en cuotas
	</button>
	{#if abierta === 'tarjetas'}
		<div class="acc-body">
			<p>Una tarjeta puede ser de débito o crédito. En una compra en crédito indicás <strong>cuotas</strong> y el <strong>mes de inicio de pago</strong> (por defecto, el mes siguiente). Rienda proyecta el pago de cada cuota a su mes de vencimiento para que te sea mas facil el seguimiento.</p>
			<p>El gasto se cuenta <strong>entero el día que lo hacés</strong> (devengado), no cuando pagás las cuotas. El vencimiento mensual de tarjeta solo ajusta tu <strong>Ingreso disponible</strong> del mes (cuánto te queda libre después de separar para pagar la tarjeta). Pesos y dólares de la tarjeta se muestran por separado (no se mezclan).</p>
		</div>
	{/if}
</section>

<section class="acc">
	<button class="acc-h" onclick={() => toggle('dolares')}>
		<span class="flecha">{abierta === 'dolares' ? '▾' : '▸'}</span> Dólares: recurrente vs puntual
	</button>
	{#if abierta === 'dolares'}
		<div class="acc-body">
			<p>Rienda decide el trato del dólar por <strong>recurrente vs puntual</strong>, no por la moneda:</p>
			<ul>
				<li><strong>Recurrente</strong> (gastos e ingresos periódicos, registrados desde la pantalla "Recurrentes"): se pesifica al dólar MEP y entra a tu flujo en pesos.</li>
				<li><strong>Puntual</strong> (un gasto o ingreso suelto en USD):  se muestra informativo en USD. Si ese mes no cobrás ningún ingreso puntual en USD, la cuota en dólares que tengas queda aparte del cálculo en pesos, bajo Gasto; si cobrás uno, esa cuota se netea contra ese ingreso en cambio — el resultado es el <strong>"Ingreso disponible (USD)"</strong> que se muestra en Cuenta Corriente, al lado del disponible en pesos.</li>
			</ul>
			<p>El dólar de referencia es el <strong>MEP (bolsa)</strong>, y cada conversión usa el valor del día del propio movimiento (no flota con el dólar de hoy).</p>
			<p>La cotización de dólar e inflación no depende solo de vos: el valor de hoy se refresca solo cada 20 minutos, junto con los precios de Mercado (silencioso, sin avisar si falla); el histórico completo del dólar y la inflación se resincroniza aparte, una vez por día. Si necesitás algo más fresco al toque, el botón <strong>"Actualizar tipo de cambio"</strong> (menú → Datos) fuerza las dos actualizaciones en el momento.</p>
		</div>
	{/if}
</section>

<section class="acc">
	<button class="acc-h" onclick={() => toggle('poder')}>
		<span class="flecha">{abierta === 'poder' ? '▾' : '▸'}</span> Poder adquisitivo
	</button>
	{#if abierta === 'poder'}
		<div class="acc-body">
			<p>Compara tu ingreso principal regular contra la inflación (base 100) y contra el dólar. Sirve para ver si tu sueldo le gana a los precios, y si una caída en dólares vino de tu ingreso o del tipo de cambio.</p>
		</div>
	{/if}
</section>

<section class="acc">
	<button class="acc-h" onclick={() => toggle('meta-ahorro')}>
		<span class="flecha">{abierta === 'meta-ahorro' ? '▾' : '▸'}</span> Meta de ahorro
	</button>
	{#if abierta === 'meta-ahorro'}
		<div class="acc-body">
			<p>Ves qué % de tu ingreso regular estás ahorrando, contra un objetivo que vos definís.</p>
			<p>Se usa desde <strong>Evolución de Gastos → "Capacidad de ahorro"</strong>: ahí editás el objetivo (%), por separado para ARS y USD. Ese mismo objetivo alimenta el semáforo de la fila <strong>"Ahorro"</strong> en Cuenta Corriente (home) — no se configura dos veces.</p>
			<p>El <strong>ahorro neto</strong> es gastos en categorías marcadas como ahorro, menos ingresos de categoría "Desahorro" (retiros), neteado dentro de cada moneda — nunca se mezcla ARS con USD. Objetivo por defecto: <strong>10%</strong>. El semáforo tiene polaridad invertida respecto a una categoría de gasto: verde si alcanzás o superás el objetivo, no si te quedás corto.</p>
		</div>
	{/if}
</section>

<section class="acc">
	<button class="acc-h" onclick={() => toggle('presupuesto')}>
		<span class="flecha">{abierta === 'presupuesto' ? '▾' : '▸'}</span> Presupuesto mensual
	</button>
	{#if abierta === 'presupuesto'}
		<div class="acc-body">
			<p>Le ponés un tope de gasto a cada subcategoría y ves de un vistazo cómo venís parado.</p>
			<p>Se usa desde <strong>Cuenta Corriente</strong> (la pantalla principal): tocás el casillero de Presupuesto de cualquier subcategoría para asignarle un monto. Las flechas de arriba cambian de período.</p>
			<p>Con presupuesto asignado, el semáforo compara gasto real contra ese monto. Sin presupuesto asignado, compara contra tu ingreso disponible/total. La fila de <strong>Ahorro</strong> es la excepción: su "presupuesto" no se carga a mano — sale solo del objetivo % que definiste en Meta de ahorro, multiplicado por tu ingreso regular del período.</p>
		</div>
	{/if}
</section>

<h2 class="modulo">Inversiones</h2>

<section class="acc">
	<button class="acc-h" onclick={() => toggle('tenencia')}>
		<span class="flecha">{abierta === 'tenencia' ? '▾' : '▸'}</span> Tenencia Actual y Tenencia en montos (FIFO, PPC, PPV)
	</button>
	{#if abierta === 'tenencia'}
		<div class="acc-body">
			<p>La cartera se valúa a precio de mercado en dólares, con método <strong>FIFO</strong> (las ventas consumen primero los lotes más viejos). <strong>Tenencia Actual</strong> muestra la foto sin montos —solo %, precio por unidad y rendimiento—; los montos y la edición de precio de mercado y caja viven en <strong>Tenencia en montos</strong>.</p>
			<ul>
				<li><strong>PPC</strong> (precio promedio de compra): cuánto te costó en promedio lo que tenés.</li>
				<li><strong>PPV</strong> (precio de salida ponderado): lo recuperado en ventas, rentas y amortizaciones más la tenencia a precio actual, sobre el total comprado.</li>
				<li><strong>Rend. %</strong>: ganancia (realizada + no realizada) de la posición abierta, sobre lo invertido en USD de ese episodio.</li>
				<li><strong>Rendimiento del mes / trimestre / año</strong> (cards): TWR de toda la cartera, rebasado a cada ventana — descuenta el efecto de tus propios ingresos y retiros, para medir solo el resultado de tu estrategia.</li>
				<li><strong>Detalle del mix</strong>: ranking de tus posiciones ordenado por % de la cartera, de mayor a menor (cruza todas las categorías de renta). Incluye Renta y Exposición (Dólar/CER/Peso) por fila, para ver de dónde sale cada % del gráfico de arriba. Marca con ⚠ cualquier posición que supere el 20% del total, como alerta de concentración.</li>
			</ul>
			<p>Los precios se actualizan solos cada 20 minutos en horario de mercado (o con "⟳ Actualizar precios"), y cada actualización deja hecha la <strong>foto del día automáticamente</strong> — no hace falta ninguna acción manual para que la curva de Evolución tenga datos. La liquidez tampoco se ajusta a mano: cambia únicamente por movimientos de caja, el efecto caja de tus compras/ventas y los cobros de renta.</p>
		</div>
	{/if}
</section>

<section class="acc">
	<button class="acc-h" onclick={() => toggle('mercado')}>
		<span class="flecha">{abierta === 'mercado' ? '▾' : '▸'}</span> Mercado
	</button>
	{#if abierta === 'mercado'}
		<div class="acc-body">
			<p><strong>Mercado</strong> es el catálogo de referencia de activos. Con <strong>"⬇ Sincronizar catálogo"</strong> se dan de alta de una sola vez todos los instrumentos que publica la fuente de precios, así no hay que cargar un activo a mano cada vez que operás uno nuevo; se puede volver a correr cuando quieras y solo agrega lo que apareció nuevo, sin tocar lo que ya está. Los que no cotizan ahí (FCI, activos del exterior) se cargan con <strong>"➕ Nuevo activo"</strong>.</p>
			<p>Cada instrumento aparece en sus <strong>especies</strong>: el ticker pelado cotiza en pesos, el terminado en D es dólar MEP y el terminado en C es dólar CCL. El gráfico de arriba muestra la evolución del activo que elijas, con media móvil de 200 ruedas y volumen operado; la serie histórica se baja en el momento y no se guarda, y la fuente la publica solo para la especie en pesos.</p>
			<p>Los activos que traés del catálogo entran con el ticker como nombre y con su renta y exposición puestas por regla — conviene corregir a mano solo los pocos que efectivamente operás.</p>
		</div>
	{/if}
</section>

<h2 class="modulo">General</h2>

<section class="acc">
	<button class="acc-h" onclick={() => toggle('backups')}>
		<span class="flecha">{abierta === 'backups' ? '▾' : '▸'}</span> Tus datos y backups
	</button>
	{#if abierta === 'backups'}
		<div class="acc-body">
			<p>Todo vive solo en este dispositivo (sin nube). Por eso conviene <strong>instalar la app</strong> y hacer <strong>backup</strong> cada tanto desde Importar/Exportar. Rienda también guarda copias automáticas antes de operaciones riesgosas (importar/reset), pero esas viven en el mismo dispositivo: no reemplazan a un backup tuyo.</p>
		</div>
	{/if}
</section>

<a href="/" class="btn-volver">← Volver</a>

<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	.intro { background: rgba(91, 157, 255, 0.08); border: 1px solid var(--accent); border-radius: 8px; padding: 12px 14px; margin: 8px 0 4px; }
	.intro p { margin: 0 0 6px; }
	.intro ul { margin: 4px 0 0; }
	.intro li:last-child { margin-bottom: 0; }
	.modulo { font-size: 1.1rem; margin: 22px 0 4px; border-left: 3px solid var(--accent); padding-left: 12px; }
	.modulo:first-of-type { margin-top: 18px; }
	p { font-size: 0.9rem; line-height: 1.55; margin: 6px 0; }
	ul { margin: 6px 0; padding-left: 18px; }
	li { font-size: 0.9rem; line-height: 1.5; margin: 4px 0; }
	strong { color: var(--text); }

	.acc { border: 1px solid transparent; border-radius: 8px; margin-top: 10px; overflow: hidden; background: var(--surface); }
	.acc-h {
		width: 100%; text-align: left; background: none; color: var(--text);
		border: none; padding: 12px 14px; font-family: var(--font-display); font-size: 0.95rem; font-weight: 600; cursor: pointer;
		display: flex; align-items: center; gap: 8px;
		transition: background 0.12s ease;
	}
	.acc-h:hover { background: var(--surface-2); }
	.flecha { color: var(--text-dim); font-size: 0.85rem; width: 14px; display: inline-block; }
	.acc-body { padding: 12px 14px; }
</style>

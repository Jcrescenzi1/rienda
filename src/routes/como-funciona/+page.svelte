<script lang="ts">
	// Capa 3: página consultable con lo avanzado. No se fuerza; se linkea desde las
	// guías. Contenido estático (sin queries).
</script>

<div class="titulo-guia">
	<h1>Cómo funciona Rienda</h1>
</div>
<a href="/" class="btn-volver">← Volver</a>

<p class="intro">Rienda te deja arrancar con lo mínimo (cargar gastos e ingresos) y sumar profundidad cuando quieras. Acá está el detalle de lo avanzado, por si te interesa. Nada de esto es obligatorio.</p>

<section>
	<h2>Períodos: sueldo vs calendario</h2>
	<p>Tenés dos formas de definir tu "mes financiero" (la cambiás en Configuración):</p>
	<ul>
		<li><strong>Calendario</strong>: el período es el mes del 1 al último día. Simple y predecible.</li>
		<li><strong>Sueldo</strong>: el período lo abre el día que cobrás tu ingreso principal. Cada cobro marca un "corte"; un gasto cae en el corte cuya fecha es la última anterior o igual a la del gasto. Por eso un gasto puede aparecer en "otro mes": si cobrás el 28, lo que gastes después arranca el período siguiente.</li>
	</ul>
	<p><strong>Regla del veinte</strong>: al cargar el ingreso principal, si lo cobrás del día 20 en adelante, Rienda te sugiere imputarlo al mes siguiente (es plata para ese mes). Es solo una sugerencia editable.</p>
</section>

<section>
	<h2>Tarjetas y crédito en cuotas</h2>
	<p>Una tarjeta puede ser de débito o crédito. En una compra en crédito indicás <strong>cuotas</strong> y el <strong>mes de inicio de pago</strong> (por defecto, el mes siguiente). Rienda reparte la compra 1/N y proyecta cada cuota a su mes de vencimiento.</p>
	<p>El gasto se cuenta <strong>entero el día que lo hacés</strong> (devengado), no cuando pagás las cuotas. El vencimiento mensual de tarjeta solo ajusta tu <strong>Ingreso disponible</strong> del mes (cuánto te queda libre después de separar para pagar la tarjeta). Pesos y dólares de la tarjeta se muestran por separado (no se mezclan).</p>
</section>

<section>
	<h2>Dólares: recurrente vs puntual</h2>
	<p>Rienda decide el trato del dólar por <strong>recurrente vs puntual</strong>, no por la moneda:</p>
	<ul>
		<li><strong>Recurrente</strong> (fijos, cuotas, ingresos recurrentes): se pesifica al dólar MEP y entra a tu flujo en pesos.</li>
		<li><strong>Puntual</strong> (un gasto o ingreso suelto en USD): sale de tu stock de dólares, queda aparte del cálculo en pesos y se muestra informativo en USD.</li>
	</ul>
	<p>El dólar de referencia es el <strong>MEP (bolsa)</strong>, y cada conversión usa el valor del día del propio movimiento (no flota con el dólar de hoy).</p>
</section>

<section>
	<h2>Inversiones (FIFO, PPC, PPV)</h2>
	<p>La cartera se valúa a precio de mercado en dólares. Los resultados se calculan con método <strong>FIFO</strong> (las ventas consumen primero los lotes más viejos):</p>
	<ul>
		<li><strong>PPC</strong> (precio promedio de compra): cuánto te costó en promedio lo que tenés.</li>
		<li><strong>PPV</strong> (precio de salida ponderado): lo recuperado en ventas más la tenencia a precio actual, sobre el total comprado.</li>
		<li><strong>Ganancia realizada</strong>: la que ya cerraste al vender. <strong>No realizada</strong>: la diferencia entre el valor de mercado y el costo de lo que todavía tenés.</li>
	</ul>
	<p>Podés guardar "fotos" de la cartera para ver su evolución (rendimiento descontando ingresos/retiros, base 100).</p>
</section>

<section>
	<h2>Poder adquisitivo</h2>
	<p>Compara tu ingreso principal regular contra la inflación (base 100) y contra el dólar. Sirve para ver si tu sueldo le gana a los precios, y si una caída en dólares vino de tu ingreso o del tipo de cambio.</p>
</section>

<section>
	<h2>Tus datos y backups</h2>
	<p>Todo vive solo en este dispositivo (sin nube). Por eso conviene <strong>instalar la app</strong> y hacer <strong>backup</strong> cada tanto desde Importar/Exportar. Rienda también guarda copias automáticas antes de operaciones riesgosas (importar/reset), pero esas viven en el mismo dispositivo: no reemplazan a un backup tuyo.</p>
</section>

<a href="/" class="btn-volver">← Volver</a>

<style>
	:global(body) { max-width: 820px; margin: 0 auto; padding: 16px; }
	.intro { color: var(--text-dim); font-size: 0.92rem; line-height: 1.5; margin: 8px 0 4px; }
	section { border-top: 1px solid var(--border); padding: 4px 0 2px; margin-top: 14px; }
	h2 { font-size: 1.05rem; margin: 12px 0 6px; }
	p { font-size: 0.9rem; line-height: 1.55; margin: 6px 0; }
	ul { margin: 6px 0; padding-left: 18px; }
	li { font-size: 0.9rem; line-height: 1.5; margin: 4px 0; }
	strong { color: var(--text); }
</style>

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
	<p>La cotización de dólar e inflación no depende solo de vos: al abrir la app se refresca sola si la última guardada tiene más de 3 días (silencioso, sin avisar si falla). Si necesitás algo más fresco al toque, el botón <strong>"Actualizar tipo de cambio"</strong> (menú → Datos) la fuerza en el momento.</p>
</section>

<section>
	<h2>Tenencia Actual (FIFO, PPC, PPV)</h2>
	<p>La cartera se valúa a precio de mercado en dólares. Los resultados se calculan con método <strong>FIFO</strong> (las ventas consumen primero los lotes más viejos):</p>
	<ul>
		<li><strong>PPC</strong> (precio promedio de compra): cuánto te costó en promedio lo que tenés.</li>
		<li><strong>PPV</strong> (precio de salida ponderado): lo recuperado en ventas, rentas y amortizaciones más la tenencia a precio actual, sobre el total comprado.</li>
		<li><strong>Rend. %</strong>: Result. Real de la posición ÷ lo invertido en USD del episodio abierto. Es el % que le falta al monto absoluto para saber si un resultado es grande o chico.</li>
		<li><strong>Resultado Posiciones Abiertas</strong> (card): la ganancia total de todo lo que tenés hoy, en USD — ventas parciales + rentas/amortización cobradas + valor de mercado actual, menos lo invertido. Reemplaza al viejo concepto de "ganancia no realizada", que ignoraba la plata ya cobrada por renta y por eso subestimaba (o exageraba) cómo te estaba yendo.</li>
		<li><strong>Ganancia realizada del año</strong> (card) y su detalle <strong>por año</strong> (tabla plegable debajo): solo cuenta ciclos que cerraste del todo (vendiste el 100%). Lo de una posición que seguís teniendo, aunque hayas vendido una parte, ya está adentro de "Resultado Posiciones Abiertas" — así no se duplica ni se pierde nada entre un año y el siguiente.</li>
		<li><strong>Detalle del mix</strong>: ranking de tus posiciones ordenado por % de la cartera, de mayor a menor (cruza todas las categorías de renta). Incluye Renta y Exposición (Dólar/CER/Peso) por fila, para ver de dónde sale cada % del gráfico de arriba. Marca con ⚠ cualquier posición que supere el 20% del total, como alerta de concentración.</li>
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
	h2 { font-size: 1.02rem; margin: 14px 0 6px; border-left: 3px solid var(--accent); padding-left: 12px; }
	p { font-size: 0.9rem; line-height: 1.55; margin: 6px 0; }
	ul { margin: 6px 0; padding-left: 18px; }
	li { font-size: 0.9rem; line-height: 1.5; margin: 4px 0; }
	strong { color: var(--text); }
</style>

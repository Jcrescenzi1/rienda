// src/lib/toast.svelte.ts
// Mensaje de confirmación/error para las pantallas de carga. Reutilizable: cada
// pantalla crea su propia instancia (const toast = new Toast()).
// - exito(): confirma y se autodismiss a los ~3s. El timer se reinicia en cada
//   llamada, así que guardar en tanda no acumula timers ni parpadea.
// - error(): queda fijo hasta que el usuario lo resuelva (sin autodismiss).
// - limpiar(): borra el mensaje y cancela cualquier timer pendiente.
export class Toast {
	texto = $state('');
	esError = $state(false);
	private timer: ReturnType<typeof setTimeout> | undefined;
	private ms: number;

	constructor(ms = 3000) {
		this.ms = ms;
	}

	private cancelar() {
		if (this.timer !== undefined) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
	}

	exito(t: string) {
		this.cancelar();
		this.esError = false;
		this.texto = t;
		this.timer = setTimeout(() => {
			this.texto = '';
			this.timer = undefined;
		}, this.ms);
	}

	error(t: string) {
		this.cancelar();
		this.esError = true;
		this.texto = t;
	}

	limpiar() {
		this.cancelar();
		this.esError = false;
		this.texto = '';
	}
}

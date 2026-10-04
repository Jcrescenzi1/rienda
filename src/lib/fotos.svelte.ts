// Estado reactivo (app-wide) del recálculo de fotos de cartera. Lo escribe
// cartera.ts (invalidarFotosDesde) y lo muestra +layout.svelte como indicador de
// progreso. Cuenta corridas simultáneas: el progreso es la suma de todas.

let _corridas = $state(0);
let _hecho = $state(0);
let _total = $state(0);

export const fotosProgreso = {
	get activo() {
		return _corridas > 0;
	},
	get hecho() {
		return _hecho;
	},
	get total() {
		return _total;
	},
	iniciar(total: number) {
		_corridas++;
		_total += total;
	},
	avanzar() {
		_hecho++;
	},
	terminar() {
		_corridas = Math.max(0, _corridas - 1);
		if (_corridas === 0) {
			_hecho = 0;
			_total = 0;
		}
	}
};

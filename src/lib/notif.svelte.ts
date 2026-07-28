// Estado reactivo del badge de la campana (app-wide). Lo consume el layout y lo
// refresca tanto la navegación (afterNavigate) como el centro de notificaciones al
// marcar recurrentes vistos. Mantiene la lógica de conteo en notificaciones.ts.

import { cargarNotificaciones } from './notificaciones';

let _count = $state(0);

export const notif = {
	get count() {
		return _count;
	},
	async refrescar() {
		try {
			_count = (await cargarNotificaciones()).badge;
		} catch {
			/* sin datos: dejar el conteo como está */
		}
	}
};

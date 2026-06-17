// src/lib/moneda.svelte.ts
// Estado reactivo del modo de moneda elegido, compartido entre las visuales de
// análisis y persistido en la tabla meta para que la elección se mantenga al
// navegar y entre sesiones.

import { query } from './db/client';
import { setMeta } from './db/meta';
import type { ModoMoneda } from './moneda';

class MonedaStore {
	modo = $state<ModoMoneda>('usd');
	private cargado = false;

	// Lee el modo guardado (una sola vez). Seguro de llamar en cada onMount.
	async cargar(): Promise<void> {
		if (this.cargado) return;
		this.cargado = true;
		try {
			const r = (await query("SELECT valor FROM meta WHERE clave='modo_moneda'")) as any[];
			const v = r[0]?.valor;
			if (v === 'usd' || v === 'real' || v === 'nominal') this.modo = v;
		} catch {
			/* sin dato previo: queda el default 'usd' */
		}
	}

	async set(m: ModoMoneda): Promise<void> {
		this.modo = m;
		try {
			await setMeta('modo_moneda', m);
		} catch {
			/* la persistencia es best-effort; el cambio en pantalla ya aplicó */
		}
	}
}

export const moneda = new MonedaStore();

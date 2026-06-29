// src/lib/pwa.svelte.ts
// Estado PWA compartido entre el layout (que captura los eventos) y el CTA de
// instalación (Home). Degrada limpio: si el navegador no soporta nada, queda todo
// en null/false y la app sigue andando desde el navegador.

export const pwa = $state<{ deferred: any; standalone: boolean }>({
	deferred: null, // evento beforeinstallprompt diferido (Android/Chromium)
	standalone: false // true si ya corre instalada
});

// ¿La app ya corre instalada? (display-mode standalone o el flag de iOS Safari).
export function esStandalone(): boolean {
	try {
		return (
			window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
			(navigator as any).standalone === true
		);
	} catch {
		return false;
	}
}

// ¿Es iOS (iPhone/iPad)? Safari iOS no dispara beforeinstallprompt → instrucciones manuales.
export function esIOS(): boolean {
	try {
		const ua = navigator.userAgent || '';
		// iPadOS 13+ se hace pasar por Mac; se detecta por touch.
		return /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1);
	} catch {
		return false;
	}
}

// Lanza el prompt nativo de instalación (Android/Chromium). Devuelve el resultado.
// Tras aceptar, re-pide almacenamiento persistente. 'no-prompt' = no hay evento
// (iOS o ya instalada o navegador sin soporte).
export async function instalarApp(): Promise<'accepted' | 'dismissed' | 'no-prompt'> {
	if (!pwa.deferred) return 'no-prompt';
	try {
		pwa.deferred.prompt();
		const { outcome } = await pwa.deferred.userChoice;
		pwa.deferred = null;
		if (outcome === 'accepted') {
			try { await navigator.storage?.persist?.(); } catch { /* no soportado */ }
		}
		return outcome;
	} catch {
		pwa.deferred = null;
		return 'dismissed';
	}
}

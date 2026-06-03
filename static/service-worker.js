// service-worker.js
// Estrategia "network-first": siempre intenta traer la versión más nueva del
// servidor. Solo usa el caché si no hay conexión. Así un deploy nuevo se ve
// al recargar, sin quedar pegado a una versión vieja.

const CACHE = 'rienda-cache-v1';

self.addEventListener('install', (event) => {
	// Activa la versión nueva del SW de inmediato, sin esperar.
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			// Borra cachés viejos de versiones anteriores.
			const keys = await caches.keys();
			await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
			await self.clients.claim();
		})()
	);
});

self.addEventListener('fetch', (event) => {
	const req = event.request;

	// Solo manejamos GET. El resto pasa directo.
	if (req.method !== 'GET') return;

	event.respondWith(
		(async () => {
			try {
				// Network-first: pedimos al servidor.
				const fresh = await fetch(req);
				// Guardamos copia en caché para uso offline.
				const cache = await caches.open(CACHE);
				cache.put(req, fresh.clone());
				return fresh;
			} catch {
				// Sin conexión: servimos lo cacheado si existe.
				const cached = await caches.match(req);
				if (cached) return cached;
				throw new Error('Sin conexión y sin caché para: ' + req.url);
			}
		})()
	);
});
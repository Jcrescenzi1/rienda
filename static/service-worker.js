// service-worker.js
// Estrategia "stale-while-revalidate": sirve al instante desde el cache y, en
// paralelo, baja la version nueva del servidor para la proxima apertura. Asi la
// app instalada (PWA) abre rapido en mobile y, aun asi, se mantiene actualizada.
// Los assets con hash (immutable) y el WASM de SQLite quedan cacheados: no se
// vuelven a bajar en cada arranque (eso era lo que la hacia lenta).

const CACHE = 'rienda-cache-v2';

self.addEventListener('install', () => {
	// Activa la version nueva del SW de inmediato, sin esperar.
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			// Borra caches de versiones anteriores (incluye el v1 network-first).
			const keys = await caches.keys();
			await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
			await self.clients.claim();
		})()
	);
});

self.addEventListener('fetch', (event) => {
	const req = event.request;

	// Solo GET y solo mismo origen; el resto pasa directo a la red.
	if (req.method !== 'GET') return;
	const url = new URL(req.url);
	if (url.origin !== self.location.origin) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			const cached = await cache.match(req);

			// Refresco en segundo plano: actualiza el cache para la proxima vez.
			const red = fetch(req)
				.then((fresh) => {
					if (fresh && fresh.status === 200) cache.put(req, fresh.clone());
					return fresh;
				})
				.catch(() => null);

			// Si hay copia en cache, la devolvemos YA (instantaneo) y dejamos que
			// el refresco corra atras. Si no hay, esperamos a la red.
			if (cached) return cached;
			const fresh = await red;
			if (fresh) return fresh;
			return new Response('Sin conexion y sin cache para: ' + req.url, { status: 504 });
		})()
	);
});

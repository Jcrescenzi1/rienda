// src/lib/db/data912.ts
// Primitivas compartidas de la API data912, sin dependencias propias — así
// precios.ts (paneles en vivo) y precios_historicos.ts (histórico + cadena de
// respaldo) pueden importar de acá sin quedar uno dependiendo del otro.

// Si data912 bloqueara CORS, basta cambiar esta base por un proxy propio
// (p. ej. un Cloudflare Worker) sin tocar el resto.
export const BASE = 'https://data912.com';

// Bonos y ONs cotizan por cada 100 nominales; el resto por unidad. Esta función
// pasa el precio crudo a "precio por unidad" comparable con lo que registra la app.
export function ajustarEscala(px: number, tipo: string): number {
	return tipo === 'Bono' || tipo === 'ON' ? px / 100 : px;
}

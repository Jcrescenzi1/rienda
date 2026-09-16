// src/lib/errores.ts
// Error de validación esperado (archivo/backup con formato incorrecto, etc.):
// se distingue de una falla técnica real para poder mostrarle al usuario el
// mensaje específico en vez del genérico "Contactá al administrador".
export class ErrorValidacion extends Error {}

// Bloque C — falla de red/API externa esperada (data912 no responde, sin
// internet, bloqueo CORS): distinta de una falla de la base, para mostrar un
// mensaje de "no se pudieron traer los precios" con sugerencia de reintentar,
// en vez del mensaje técnico genérico.
export class ErrorRed extends Error {}

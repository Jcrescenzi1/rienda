// src/lib/errores.ts
// Error de validación esperado (archivo/backup con formato incorrecto, etc.):
// se distingue de una falla técnica real para poder mostrarle al usuario el
// mensaje específico en vez del genérico "Contactá al administrador".
export class ErrorValidacion extends Error {}

// src/lib/db/perfil.ts
// Gestión del perfil único (mono-perfil). La app trabaja siempre con perfil_id=1.

import { query } from './client';
import { SEED_BASE } from './seed';
import { SEED_MACRO } from './seed_macro';
import type { ModoPeriodo } from '../periodo';

// ¿Ya existe un perfil creado?
export async function hayPerfil(): Promise<boolean> {
	const r = (await query('SELECT COUNT(*) AS n FROM perfil')) as any[];
	return (r[0]?.n ?? 0) > 0;
}

// Nombre del perfil actual (o null si no hay).
export async function nombrePerfil(): Promise<string | null> {
	const r = (await query('SELECT nombre FROM perfil WHERE id=1')) as any[];
	return r[0]?.nombre ?? null;
}

// Crea el perfil id=1 con el nombre y modo de período dados, carga las
// categorías genéricas y los datos macro de arranque (dólar/inflación de fallback).
// Nota: no se envuelve en una transacción propia porque SEED_MACRO ya trae su
// propio BEGIN/COMMIT (transacciones anidadas no están permitidas en SQLite).
export async function crearPerfil(nombre: string, modoPeriodo: ModoPeriodo = 'sueldo'): Promise<void> {
	const limpio = nombre.trim();
	if (!limpio) throw new Error('El nombre no puede estar vacío.');

	await query('INSERT INTO perfil (id, nombre, modo_periodo) VALUES (1, ?, ?)', [limpio, modoPeriodo]);
	await query(SEED_BASE); // categorías y subcategorías genéricas
	if (SEED_MACRO && SEED_MACRO.trim()) {
		await query(SEED_MACRO); // dólar/inflación de arranque (trae su propia transacción)
	}
}
// Datos genéricos de arranque para un usuario nuevo.
// NO incluye el perfil (lo crea la pantalla de bienvenida con el nombre del usuario)
// ni datos personales. Se ejecuta al crear el perfil, una sola vez.

export const SEED_BASE = `
-- Categorías genéricas de arranque (el usuario las edita después en Configuración)
INSERT INTO categoria (perfil_id, nombre) VALUES (1, 'Comidas');
INSERT INTO categoria (perfil_id, nombre) VALUES (1, 'Transporte');
INSERT INTO categoria (perfil_id, nombre) VALUES (1, 'Impuestos/Servicios');
INSERT INTO categoria (perfil_id, nombre) VALUES (1, 'Salidas');
INSERT INTO categoria (perfil_id, nombre) VALUES (1, 'Salud');
INSERT INTO categoria (perfil_id, nombre) VALUES (1, 'Compras');
INSERT INTO categoria (perfil_id, nombre) VALUES (1, 'Otros');

-- Subcategorías genéricas mínimas (para que el formulario de gastos funcione)
INSERT INTO subcategoria (perfil_id, nombre) VALUES (1, 'General');
INSERT INTO subcategoria (perfil_id, nombre) VALUES (1, 'Supermercado');
INSERT INTO subcategoria (perfil_id, nombre) VALUES (1, 'Restaurante');
INSERT INTO subcategoria (perfil_id, nombre) VALUES (1, 'Transporte');
INSERT INTO subcategoria (perfil_id, nombre) VALUES (1, 'Servicios');
INSERT INTO subcategoria (perfil_id, nombre) VALUES (1, 'Salud');
INSERT INTO subcategoria (perfil_id, nombre) VALUES (1, 'Ropa');
INSERT INTO subcategoria (perfil_id, nombre) VALUES (1, 'Ahorro');

-- Tarjeta genérica de arranque (sin proveedor): habilita el flujo de crédito de
-- entrada. El usuario la renombra, le elige proveedor o agrega más en Configuración.
INSERT INTO tarjeta (perfil_id, nombre, tipo) VALUES (1, 'Genérica', 'credito');
`;
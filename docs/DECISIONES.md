# Decisiones de implementación

- Decisión técnica: usar Node.js + TypeScript + Express para backend y React + Vite para frontend, pues se requiere una base web moderna y un flujo de trabajo compatible con pruebas automatizadas.
- Decisión técnica: usar SQLite con Sequelize para la persistencia local del sprint, priorizando simplicidad de instalación y migraciones declarativas.
- Decisión de experiencia: para empleados y pasajeros, la interfaz muestra un mensaje "Disponible próximamente" tras autenticarse, conforme a la decisión de implementación del sprint.
- Decisión de alcance: con este cierre se implementa y verifica la lógica de US-08 y US-09, manteniendo la base ya entregada en US-07 y US-10.
- Se consultó `src/referencia/SPRINT_0_SIGVA.txt` y se utilizaron sus criterios de aceptación para cerrar el checklist y las decisiones de alcance.
- Las fechas de vuelos y salidas se procesan como fechas de calendario y el día actual se calcula con la zona `America/Argentina/Buenos_Aires`; los tests pueden inyectar el día actual.
- Las salidas nuevas comienzan con cero asientos vendidos; capacidad y precio por clase permanecen en columnas de vuelos para mantener compatibilidad con las consultas, y `fares` conserva su representación normalizada por vuelo/clase.
- Las sesiones se guardan en `sessions`; JWT contiene el UUID de sesión y el middleware actualiza la última actividad en cada petición válida. El timeout se configura con `SESSION_TIMEOUT_MINUTES` (30 por defecto) y logout revoca la sesión.
- El único registro de cambios de vuelo es `flight_change_history`; el detalle reconstruye desde allí fecha, hora, usuario y valores anteriores/nuevos. `cancellations` conserva las cancelaciones completas, puntuales y de salidas retiradas con ventas.
- Los estados físicos se codifican como `ACTIVE/CANCELLED` para vuelos, `SCHEDULED/CANCELLED` para salidas y `RESERVED/CONFIRMED/EXPIRED/REJECTED` para compras; representan los estados de dominio Activo/Cancelado, Programada/Cancelada y Reservada/Confirmada/Vencida/Rechazada.
- El seed reproducible genera vuelos y fechas relativos al día de ejecución; los tests de API usan un seed mínimo independiente para conservar fixtures deterministas.
- La publicación se prepara con un Blueprint de Render, pero el alta de cuenta, conexión del repositorio, secreto JWT y despliegue final requieren una persona; no se considera desplegada hasta que se complete ese proceso.
- `JWT_SECRET` no tiene fallback de desarrollo: el servidor falla al arrancar si falta. Vitest establece explícitamente una clave exclusiva para tests.
- En US-10 se muestran las acciones Modificar y Cancelar solo cuando el vuelo está activo; los cambios con ventas requerirán confirmación explícita según la regla de negocio de US-08 y US-09.
- Toda modificación requiere `confirmed: true`; cuando el cambio de días o período afecta salidas con ventas se requiere además la confirmación específica de esos conflictos. Las validaciones, historial, tarifas, vuelo y actualización de salidas se confirman en una transacción.
- Las salidas futuras que dejan de corresponder se cancelan y conservan si tienen ventas; si no tienen ventas se eliminan. Las salidas pasadas no se alteran.
- Las fechas sembradas se generan usando los días propios de cada vuelo; para vuelos existentes, la reconciliación de AR1450 cancela las salidas futuras inválidas con ventas y quita las inválidas sin ventas, sin tocar salidas pasadas.
- Render puede asignar URLs distintas si los nombres de servicio están ocupados; se actualizan `CLIENT_URL` y `VITE_API_URL` con las URLs asignadas. `DB_PATH=/tmp/...` es efímero y la base demo se recrea y se vuelve a sembrar en cada reinicio.

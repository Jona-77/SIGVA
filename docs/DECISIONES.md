# Decisiones de implementación

- Decisión técnica: usar Node.js + TypeScript + Express para backend y React + Vite para frontend, pues se requiere una base web moderna y un flujo de trabajo compatible con pruebas automatizadas.
- Decisión técnica: usar SQLite con Sequelize para la persistencia local del sprint, priorizando simplicidad de instalación y migraciones declarativas.
- Decisión de experiencia: para empleados y pasajeros, la interfaz muestra un mensaje "Disponible próximamente" tras autenticarse, conforme a la decisión de implementación del sprint.
- Decisión de alcance: con este cierre se implementa y verifica la lógica de US-08 y US-09, manteniendo la base ya entregada en US-07 y US-10.
- Se consultó `src/referencia/SPRINT_0_SIGVA.txt` y se utilizaron sus criterios de aceptación para cerrar el checklist y las decisiones de alcance.
- Las fechas de vuelos y salidas se procesan como fechas de calendario y el día actual se calcula con la zona `America/Argentina/Buenos_Aires`; los tests pueden inyectar el día actual.
- Las salidas nuevas comienzan con cero asientos vendidos; la consulta informa vendidos y disponibles por clase, y el historial de cambios de vuelo se registra en JSON para ser consultado desde el detalle.
- En US-10 se muestran las acciones Modificar y Cancelar solo cuando el vuelo está activo; los cambios con ventas requerirán confirmación explícita según la regla de negocio de US-08 y US-09.

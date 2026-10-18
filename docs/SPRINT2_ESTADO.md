# Estado Sprint #2
- Tanda A ejecutada y verificada: cobertura Sprint #1 y corrección de US-08.
- Tanda B implementada anteriormente: registro, búsqueda pública y cotización.
- Tanda C: formulario de pasajeros con titular precargado, errores por campo y vista de reserva con cuenta regresiva/cancelación.
- Reservas validadas en backend, con control atómico de disponibilidad, expiración, cancelación y una reserva activa por pasajero.
- Tests C: reservas concurrentes en ambas clases, disponibilidad, vencimiento/liberación, cancelación, compra ajena y rol no pasajero.
- No se avanzó a la Tanda D.
- Validación final: `npm run ci` y `npm run db:reset`.

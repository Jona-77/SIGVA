# Decisiones de trabajo
- Tanda A: se hace un único ajuste de infraestructura y verificación, sin modificar el dominio del sprint #2.
- US-08: se conserva el contrato del backend (`400` con `conflicts`) y se presenta la lista en la interfaz sin cambiar la regla de negocio.
- Se agrega `test` y `ci` en la raíz para ejecutar la suite del Sprint #1 y compilar backend/frontend en un único flujo.
- Tanda C: una cola/mutex en proceso por salida y una transacción SQLite `BEGIN IMMEDIATE` serializan la comprobación de disponibilidad y creación de reservas; varias instancias requerirían un bloqueo compartido en base cliente-servidor.
- Los asientos reservados se guardan en la compra (`departureId`, `classId`, `quantity`) y disponibilidad resta solo reservas vigentes (`expiresAt > ahora`); la reserva no crea pasajes (`tickets`).
- El sweep y la liberación conservan `expiresAt` y cierran con `releaseReason` (`EXPIRADA` o `CANCELADA_POR_USUARIO`).
- La reserva activa por pasajero se comporta como una sola reserva vigente; al crear otra, se libera la anterior dentro de la transacción.

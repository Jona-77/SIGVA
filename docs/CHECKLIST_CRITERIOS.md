# Checklist de criterios del Sprint #2

Estados: ✅ verificado; ⏳ implementado o documentado, falta ejecutar/verificar; 👤 pendiente humano.

## US-04 Registro

- [x] US-04.1 Cuenta de pasajero con perfil personal. Verificación: automática, suite B registrada como completada en `SPRINT2_ESTADO.md`.
- [x] US-04.2 Rechazo de email inválido/duplicado y contraseña débil. Verificación: automática, suite B registrada como completada.
- [x] US-04.3 Inicio de sesión inmediato. Verificación: automática, suite B registrada como completada.
- [x] US-04.4 Perfil del titular disponible para compra. Verificación: automática, suite B/C registrada como completada.

## US-11 Búsqueda

- [x] US-11.1 Búsqueda pública por ruta y fecha. Verificación: automática, suite B registrada como completada.
- [x] US-11.2 Solo salidas activas, vigentes y reservables. Verificación: automática, suite B registrada como completada.
- [x] US-11.3 Horarios, duración, clases, precios y asientos libres. Verificación: automática, suite B registrada como completada.
- [x] US-11.4 Mensaje claro cuando no hay resultados. Verificación: automática, suite B registrada como completada.

## US-13 Selección

- [x] US-13.1 Sesión de pasajero requerida para avanzar. Verificación: automática, suite B registrada como completada.
- [x] US-13.2 Cantidad limitada por disponibilidad y máximo nueve. Verificación: automática, suite B registrada como completada.
- [x] US-13.3 Total visible antes de continuar. Verificación: automática, suite B registrada como completada.
- [x] US-13.4 Selección conservada al cargar pasajeros. Verificación: automática, suite B/C registrada como completada.

## US-14 Datos de pasajeros

- [x] US-14.1 Formulario por pasajero con nombre, apellido, documento y nacimiento. Verificación: automática, suite C registrada como completada.
- [ ] US-14.2 Titular precargado desde el perfil. Verificación: 👤 verificación en navegador.
- [x] US-14.3 Validaciones de campos, fechas y documentos repetidos. Verificación: automática, suite C registrada como completada.
- [x] US-14.4 Datos asociados a la compra y reserva. Verificación: automática, suite C registrada como completada.

## US-15 Reserva

- [x] US-15.1 Reserva limitada por `RESERVATION_MINUTES`. Verificación: automática, suite C registrada como completada.
- [x] US-15.2 Asientos reservados excluidos de búsqueda/cotización. Verificación: automática, suite C registrada como completada.
- [x] US-15.3 Expiración y cancelación liberan asientos. Verificación: automática, suite C registrada como completada.
- [x] US-15.4 Concurrencia no supera capacidad. Verificación: automática, suite C registrada como completada.

## US-17 Pago

- [ ] US-17.1 Checkout externo en modo sandbox; sin almacenar datos de tarjeta. Verificación: código/documentación revisados; integración real 👤 pendiente de credenciales y prueba humana.
- [x] US-17.2 Aprobación en plazo confirma y convierte reservas en ventas. Verificación: automática, `tanda-d.test.ts` pasó en CI informado.
- [x] US-17.3 Pago registra fecha, titular, salida, clase, cantidad, monto y referencia. Verificación: automática, `tanda-d.test.ts` pasó en CI informado.
- [x] US-17.4 Emisión de un ticket asociado por pasajero. Verificación: automática, `tanda-d.test.ts` pasó en CI informado.
- [x] US-17.5 Rechazo libera la reserva; pago tardío no emite tickets. Verificación: automática, `tanda-d.test.ts` pasó en CI informado.
- [x] US-17.6 Repetir confirmación no duplica ventas ni tickets. Verificación: automática, `tanda-d.test.ts` pasó en CI informado.

## Historias técnicas

- [x] HT-01.1 Pruebas del Sprint #1 en un comando. Verificación: automática, Tanda A registrada como completada.
- [ ] HT-02.1 Conflictos de capacidad US-08 visibles por salida y clase. Verificación: 👤 verificación en navegador.

## Definition of Done

- [ ] DoD-1 Código integrado mediante PR revisado. Verificación: 👤 pendiente del equipo; no se creó PR.
- [x] DoD-2 Compilación y pruebas locales en verde. Verificación: automática, CI informado en verde (backend build, 63 tests y frontend build).
- [ ] DoD-3 Criterios verificados por Análisis y Management. Verificación: 👤 pendiente de la comisión.
- [ ] DoD-4 Compra completa en entorno demo sin pasos simulados. Verificación: 👤 pendiente de despliegue y prueba con Mercado Pago; `local-sandbox` es simulado.
- [x] DoD-5 Reservas simultáneas sin sobreventa. Verificación: automática, validación de Tanda C registrada en `SPRINT2_ESTADO.md`; no repetida en esta sesión.
- [ ] DoD-6 Pago aprobado en sandbox de Mercado Pago. Verificación: 👤 pendiente de credenciales y prueba externa.
- [ ] DoD-7 Incremento desplegado en el entorno demo. Verificación: 👤 pendiente; no se realizó despliegue.
- [x] DoD-8 Modelo de datos y decisiones actualizados. Verificación: manual, `PRAGMA table_info` contrastado después de `npm run db:reset`; índices únicos de referencia y código comprobados.
- [x] DoD-9 Pruebas del Sprint #1 completas y previas a historias nuevas. Verificación: automática, Tanda A registrada como completada.
- [ ] DoD-10 Conflictos de capacidad US-08 indicados en pantalla. Verificación: 👤 verificación en navegador.
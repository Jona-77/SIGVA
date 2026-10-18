# SIGVA — Sprint #2: compra de pasajes (implementación)

Sos el agente que implementa el Sprint #2 sobre el proyecto SIGVA **ya existente** (Sprint #1 completo). Objetivo de la demo: un pasajero se registra, busca vuelos, elige salida/clase/cantidad, carga los datos de los pasajeros, reserva asientos por tiempo limitado y paga; la compra queda registrada y los pasajes emitidos.

## Referencias

```
SIGVA/
├── referencia/ (solo lectura)
│   ├── ENUNCIADO_SIGVA.txt   dominio y reglas de negocio
│   ├── SPRINT_0_SIGVA.txt    criterios del Sprint #1 (US-03, 06–10)
│   └── SPRINT_2_SIGVA.txt    criterios y DoD del Sprint #2  ← fuente funcional
├── backend/  frontend/  docs/  (proyecto existente)
└── prompt-sprint2.md
```

Los criterios de aceptación están en `SPRINT_2_SIGVA.txt`: leé solo la sección de la US que estás haciendo. Este prompt define lo técnico y las reglas de trabajo; si hay conflicto funcional, manda el Sprint 2. No modifiques `referencia/`.

## 0. Reglas de trabajo

- **Tanda:** el usuario te indica una tanda (A, B, C o D). Hacé **solo esa**, en orden, y no pases a la siguiente. Antes de empezar leé `docs/SPRINT2_ESTADO.md` (si existe) para retomar decisiones; al terminar, actualizalo (máx. 15 líneas: qué quedó hecho, decisiones técnicas, qué falta).
- No pidas confirmaciones. Si algo es ambiguo, elegí lo más simple coherente con el enunciado y anotalo en `docs/DECISIONES.md`.
- **No elimines ni "limpies" archivos existentes** (tests, configuración de vitest/eslint, scripts, `.github`, docs). Solo creá y modificá lo que pide la tanda. No rompas los tests del Sprint #1.
- Mismo stack y convenciones que el proyecto (Express 4 + TypeScript, Sequelize + SQLite, React + Vite, Vitest + Supertest, JWT con tabla `sessions`). No agregues frameworks nuevos sin necesidad. La base se recrea con `npm run db:reset`: **no hacen falta migraciones**; modificá modelos y seed.
- Inspección acotada: antes de codificar mirá solo los modelos (`backend/src/db/index.ts`), `app.ts`, `auth.ts` y la estructura de `frontend/src`. No releas archivos salvo que un test falle.
- Salidas silenciosas: ejecutá comandos con salida mínima (`--silent`, reporter básico) y no pegues logs largos. Si el mismo error persiste después de 2 intentos, dejalo anotado en `SPRINT2_ESTADO.md` y pasá a lo siguiente.
- Datos de prueba por script (bucles), nunca a mano. No hagas commits, ramas, push ni PRs: el usuario los hace.
- Interfaz y mensajes en español. Validá siempre en el backend; el frontend solo ayuda.
- Seguridad: los secretos van por variables de entorno (`.env.example` con valores claramente falsos), nunca en el código ni en logs. Un pasajero solo accede a **sus** compras (si no es suya: 404).
- Cierre de cada tanda: `npm run ci` en verde (lint + tests + builds) y `npm run db:reset` correcto. Respuesta final: lista breve de lo hecho y lo no resuelto.

## 1. Dominio y decisiones técnicas comunes

- **Disponibilidad** de una salida y clase = capacidad − vendidos − asientos en **reservas activas** (compra `Reservada` con `expiresAt` > ahora). Una sola función compartida (`getAvailability`) usada por búsqueda, selección, reserva y pago.
- Estados de compra (ya definidos): `Reservada → Confirmada | Vencida | Rechazada`. Reserva cancelada por el pasajero = `Vencida` con motivo `CANCELADA_POR_USUARIO` (columna `releaseReason`: `EXPIRADA`, `CANCELADA_POR_USUARIO`, `PAGO_RECHAZADO`).
- Solo el rol **pasajero** compra (empleado/admin: 403 en endpoints de compra). El registro crea siempre rol pasajero.
- Zona horaria y helpers de "hora pasada" (`hasDepartureTimePassed`) ya existentes: reutilizalos. Precios en pesos enteros (ARS). `+1` y duración: si llegada ≤ partida, la llegada es el día siguiente; duración = llegada − partida (+24 h si corresponde), mostrada como `2 h 30 min`.
- Tiempo de reserva configurable: `RESERVATION_MINUTES` (por defecto 10; en `config.ts`, con valor distinto en tests).
- Las salidas con vuelo o salida cancelados, o ya pasadas, no se pueden buscar, reservar ni pagar.

## Tanda A — Deuda del Sprint #1 (se hace primero; las demás dependen de que esté verde)

**A1. Testing de las funcionalidades del Sprint #1** (criterios en `SPRINT_2_SIGVA.txt`, "Testing de las funcionalidades del Sprint #1").
- Auditá los tests existentes contra las seis áreas: US-03, US-06, US-07, US-08, US-09, US-10. Para cada una debe haber el caso exitoso y al menos un error de sus criterios (`SPRINT_0_SIGVA.txt`). Agregá **solo** lo que falte; no reescribas ni dupliques lo que ya está. Tamaño moderado.
- Un único comando los ejecuta todos: agregá `test` al `package.json` de la raíz (`npm --prefix backend run test`). `npm run ci` debe seguir pasando.
- Todos en verde sobre los datos de prueba.

**A2. Corrección de US-08: salida en conflicto en la pantalla** (`SPRINT_2_SIGVA.txt`, "Corrección de US-08").
- El backend ya responde 400 con `conflicts` (fecha de salida, campo/clase, vendidos, capacidad pedida). No lo cambies.
- En `FlightEdit` (`frontend/src/Flights.tsx`, `catch` del submit) mostrá una línea por conflicto, p. ej. `05/10/2026: 5 Economy vendidos, capacidad pedida 2`, cubriendo Economy y Primera y todas las salidas. Ampliá el tipo `ApiError.conflicts`. Limpiá la lista al volver a editar o guardar. No rompas los conflictos 409 de horario ya existentes.
- Si ya está hecho, verificalo (AR1450 → Economy = 2) y seguí.

## Tanda B — US-04, US-11, US-13

**US-04 Registro de pasajeros**
- `POST /api/auth/register` (público): nombre, apellido, documento, email, contraseña (+ fecha de nacimiento opcional). Crea usuario de rol pasajero y su perfil de pasajero en las tablas existentes. Email normalizado (minúsculas, trim) y único (409 si existe); formato de email válido; contraseña mínima: 8 caracteres con al menos una letra y un número (decisión del equipo, documentala); documento obligatorio (6–15 caracteres alfanuméricos). Errores por campo en `errors`. Nunca devuelvas el hash.
- Tras registrarse, la cuenta puede iniciar sesión de inmediato (no hay verificación de email). `GET /api/auth/me` debe devolver los datos del perfil (nombre, apellido, documento, email, fecha de nacimiento si existe) para precargar al titular en US-14.
- Pantalla `/registro` con errores por campo y enlace desde el login.

**US-11 Búsqueda de vuelos**
- `GET /api/public/airports` (público): solo aeropuertos activos, para los selectores.
- `GET /api/search/flights?origin=<IATA>&destination=<IATA>&date=YYYY-MM-DD` (**público**, sin sesión). Validación: parámetros obligatorios, IATA existentes y activos, origen ≠ destino, fecha válida y no pasada (400 con `errors`).
- Devuelve solo salidas `SCHEDULED` de vuelos `ACTIVE`, de esa fecha, dentro del período de disponibilidad del vuelo (límites inclusivos), cuya hora de partida no pasó, con asientos libres en al menos una clase. Cada resultado: id de salida, número de vuelo, origen/destino, partida y llegada (`+1` si corresponde), duración, y por clase: precio y asientos libres (clases sin libres se indican como agotadas). Orden por hora de partida (desempate por id).
- Sin resultados: 200 con lista vacía y mensaje claro; en la UI un aviso, no un error.
- Pantalla `/buscar` (página de inicio del pasajero y de los visitantes): formulario origen/destino/fecha, listado de resultados con botón "Seleccionar".

**US-13 Selección de vuelo, clase y cantidad**
- `POST /api/purchases/quote` (sesión de pasajero) con `{departureId, classCode, quantity}`: valida cantidad entera 1–9, ≤ disponibles de esa clase, salida reservable; devuelve precio unitario, cantidad y **total = precio × cantidad**. 401 sin sesión, 403 si no es pasajero, 409 si excede los disponibles (indicá cuántos hay).
- Frontend: desde un resultado, el visitante sin sesión es llevado al login (y vuelve a la selección conservando salida, clase y cantidad); selección con clase y cantidad (máx. 9 y ≤ disponibles), total visible antes de continuar y avance al paso de datos de pasajeros conservando la selección (estado del router/contexto; no hace falta persistirla en el servidor).

**Tests (B):** registro (válido, email duplicado/formato, contraseña débil, login inmediato); búsqueda (con y sin resultados, primer y último día del período, día fuera del período, vuelo cancelado, salida pasada de hoy, sin sesión, parámetros inválidos, salida agotada en una clase); selección (total, 9 válido, 10 rechazado, excede disponibles, 401, 403). Seed: asegurá que existan salidas futuras buscables en varias rutas y **una salida con solo 2 asientos Economy libres** para la demo.

## Tanda C — US-14 y US-15

**US-14 Carga de datos de pasajeros + US-15 Reserva temporal** (un único paso del usuario: confirmar los datos reserva los asientos).
- `POST /api/purchases` (pasajero): `{departureId, classCode, quantity, passengers: [{firstName, lastName, document, birthDate}, ...]}`. Valida en el servidor: cantidad 1–9; exactamente `quantity` pasajeros; nombre y apellido no vacíos; documento 6–15 alfanuméricos y **sin repetirse** dentro de la compra; fecha de nacimiento válida, no futura y no anterior a 120 años (errores por pasajero e índice). Revalida la disponibilidad dentro de la transacción.
- Si todo es válido: crea la compra `Reservada` con `expiresAt = ahora + RESERVATION_MINUTES`, total y los datos de los pasajeros asociados a la compra (usá las tablas de pasajeros/compras existentes; los **pasajes** (`tickets`) se emiten recién al pagar). Responde 201 con id, total y `expiresAt`. Si el pasajero ya tenía una reserva activa, se **libera** (queda `Vencida`/`CANCELADA_POR_USUARIO`) en la misma transacción.
- `GET /api/purchases/:id` (dueño): estado, `expiresAt`, datos y, si está confirmada, los pasajes. `POST /api/purchases/:id/cancel` (dueño, solo `Reservada`): libera los asientos.
- **Concurrencia (criterio central, DoD 5):** la verificación de disponibilidad y la creación de la reserva deben ser atómicas. Serializá la sección crítica (cola/mutex en proceso por salida **más** transacción de SQLite con bloqueo de escritura inmediato, `BEGIN IMMEDIATE` o equivalente) y recalculá la disponibilidad adentro. Nunca vendas/reservá más que la capacidad. Documentá en `DECISIONES.md` el mecanismo y su límite (con varias instancias haría falta bloqueo a nivel de fila en una base cliente-servidor).
- **Expiración y liberación:** nunca confíes solo en un temporizador. (1) La disponibilidad ignora reservas vencidas por cálculo (`expiresAt <= ahora`); (2) un barrido periódico (cada 30 s, `unref`, desactivable en tests) pasa a `Vencida`/`EXPIRADA` las reservas vencidas; (3) al intentar pagar una reserva vencida se marca `Vencida` y se responde 409/410 con mensaje claro.
- Frontend: pantalla de datos de pasajeros (un formulario por pasajero, el primero **precargado con los datos del titular** desde `/api/auth/me`; fecha de nacimiento a completar si no estaba), validación visible por campo, y al confirmar pasa a una pantalla de **reserva con cuenta regresiva** (`expiresAt`), botón "Cancelar reserva" y botón "Pagar". Al llegar a 0: aviso "La reserva venció" y vuelta a la búsqueda. Si el servidor responde 409 por asientos insuficientes, mostralo y permití reelegir.

**Tests (C):** datos válidos/ inválidos (campos vacíos, documento repetido, fecha futura, cantidad ≠ pasajeros); compra con 3 pasajeros; **simultaneidad**: salida con N asientos libres y varias solicitudes concurrentes (`Promise.all`, usuarios distintos y cantidades variadas, ambas clases) → los asientos reservados nunca superan la capacidad y las excedentes reciben 409; los asientos reservados no aparecen disponibles en búsqueda ni cotización; vencimiento (forzando `expiresAt` en el pasado o con `RESERVATION_MINUTES` mínimo) libera los asientos y vuelve a buscarse disponible; cancelar libera; una segunda reserva del mismo pasajero libera la primera; compra ajena → 404; rol no pasajero → 403.

## Tanda D — US-17 y cierre

**US-17 Pago y registro de la transacción**
- Capa `PaymentGateway` (interfaz: crear sesión de pago para una compra y verificar un pago por referencia). Variable `PAYMENT_GATEWAY`:
  - `mercadopago` (**para la demo**): integración real en **modo sandbox** de Mercado Pago (Checkout Pro: crear preferencia con `external_reference` = id de compra, `back_urls` hacia el frontend; verificar siempre el pago consultando la API de Mercado Pago con el access token — **nunca confiar en los parámetros de la URL**). Credenciales de prueba por entorno (`MP_ACCESS_TOKEN`, etc.). Consultá la documentación oficial vigente para endpoints y parámetros y aislá todo en un único módulo.
  - `local-sandbox`: adaptador local con una pantalla de pago de prueba, **claramente rotulada** "Sandbox local — no es un cobro real"; se usa en los tests automáticos y como respaldo sin credenciales. En el informe/README aclarar que el cumplimiento de DoD 4 y 6 exige `mercadopago`.
- El sistema **no recibe, almacena ni loguea** datos de tarjeta; solo guarda la referencia del pago, el estado y el monto.
- `POST /api/purchases/:id/payment` (dueño, `Reservada` y no vencida): devuelve la URL de pago de la pasarela. `POST /api/purchases/:id/payment/confirm` con la referencia del pago: verifica con la pasarela y, **en una única transacción con la misma exclusión de concurrencia**:
  - **Aprobado dentro del plazo** (`expiresAt` no vencido): compra → `Confirmada`; los asientos pasan de reservados a vendidos (contadores de la salida); se registra el pago con fecha y hora, pasajero titular, salida, clase, cantidad, monto y referencia; se emiten los **pasajes** (uno por pasajero, código único `SIGVA-XXXXXX`) asociados a la compra. Revalidá que `vendidos + cantidad ≤ capacidad` y que la salida siga activa; si no, no confirmes y marcá la compra `Vencida`.
  - **Idempotente:** repetir la confirmación no duplica pasajes ni vende dos veces (referencia de pago única).
  - **Rechazado:** pago registrado como rechazado, compra `Rechazada` (`PAGO_RECHAZADO`), asientos liberados.
  - **Aprobado fuera de plazo:** no se emiten pasajes; se registra el pago como `APROBADO_FUERA_DE_PLAZO` y se documenta como limitación (reembolso manual, fuera de alcance).
- Frontend: pantalla de pago (botón que redirige a la pasarela con los datos del resumen) y pantalla de resultado/confirmación que llama a `confirm` al volver; si es exitoso muestra la compra confirmada con sus pasajes (código, pasajero, vuelo, fecha, clase) y total; si falla, el mensaje correspondiente. Si la pasarela no acepta `localhost` en las URLs de retorno, documentalo y probá con el entorno desplegado.
- Variables nuevas en `.env.example` y en `render.yaml`/README (`PAYMENT_GATEWAY`, `MP_ACCESS_TOKEN`, `RESERVATION_MINUTES`, URLs públicas). Marcá qué pasos son humanos (crear la cuenta de desarrolladora y las credenciales/usuarios de prueba de Mercado Pago, cargarlas como secretos en Render). No afirmes que está desplegado ni que se probó contra Mercado Pago si no lo hiciste.

**Tests (D)** con el adaptador local inyectable: pago aprobado confirma, vende, registra el pago con todos sus campos y emite un pasaje por pasajero; confirmar dos veces no duplica; rechazado libera y deja `Rechazada`; aprobado después del vencimiento no emite; pago sobre reserva vencida o ajena rechazado; flujo completo de punta a punta por API (registro → búsqueda → cotización → reserva → pago → pasajes) con la disponibilidad final coherente.

**Cierre (Tanda D)**
- Seed: sin cambios que rompan el Sprint #1; una cuenta de pasajero de demo (`pasajero@sigva.test`).
- `docs/modelo-datos.md`: entidades/columnas nuevas y ER (Mermaid) actualizados cruzando con `PRAGMA table_info`; la sección `## Validación` sigue en blanco.
- `docs/DECISIONES.md`: contraseña mínima, motivos de liberación, mecanismo de concurrencia y límites, pasarela y limitación del pago fuera de plazo, regla de una reserva activa por pasajero.
- `docs/CHECKLIST_CRITERIOS.md`: criterios del Sprint #2 con numeración `US-04.1`, `US-11.3`, etc., más los dos de las historias técnicas y los 10 puntos del DoD, con el estado real y el modo de verificación (automática / manual / 👤 pendiente humano). No marques cumplido lo que no probaste.
- Recorrido manual de demo en el README (5–6 pasos) incluyendo el caso "salida con 2 asientos libres" y cómo provocar el vencimiento (`RESERVATION_MINUTES` bajo).
- `npm run ci` y `npm run db:reset` en verde.

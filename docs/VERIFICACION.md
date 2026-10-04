# Verificación independiente de SIGVA — Sprint #1

**Fecha:** 2026-10-03  
**Alcance ejecutado:** Parte A — base y acceso (evidencia de la pasada anterior) y Parte B — vuelos e integración (US-07 a US-10).
**Veredicto:** **No listo**. La Parte B deja 500 salidas canceladas del seed sin fecha/hora ni usuario responsable.

## Resumen

| Resultado en los 44 criterios |
|---|---:|
| ✅ Cumple | 39 |
| ❌ No cumple | 0 |
| ⚠️ No verificable | 0 |
| 👤 Requiere revisión manual | 5 |

Filas complementarias: **Extra ✅ Cumple** e **Invariantes ❌ No cumple**. Los 44 criterios formales suman 39 ✅ y 5 👤; el incumplimiento de la fila de invariantes determina el veredicto general.

Preparé una copia limpia en `C:\Users\User\AppData\Local\Temp\SIGVA-QA-ParteB-20261003-225117`, excluyendo `.git`, `node_modules`, `.env` y archivos SQLite. Seguí README para instalar, generé un `JWT_SECRET` local y usé las credenciales demo documentadas; Node v22.16.0 y npm 10.9.2. En esta copia `npm run ci` terminó con código 0: **2 archivos y 45 tests pasaron**; compiló backend y frontend. Dos `npm run db:reset` consecutivos tuvieron éxito. La API devolvió HTTP 200 en `/api/health` y Vite HTTP 200 en `/`.

`verificacion/parte-b.mjs` llamó a la API real y comparó respuestas con SQLite: **19 de 20 comprobaciones agrupadas pasaron**. La única observación es de integridad del seed: las 500 salidas Canceladas carecen de `cancelledAt` y `cancelledByUserId`; las filas de vuelo y de `cancellations` sí tienen esos datos. El flujo API de demo pasó; la revisión visual en navegador sigue pendiente.

## Tabla de criterios

| ID | Criterio (breve) | Resultado | Evidencia |
|---|---|---|---|
| US-01.1 | CONTRIBUTING documenta PR, aprobación de otra persona y CI; protección activa de `main`. | 👤 Requiere revisión manual | `CONTRIBUTING.md:3-10,19-28` explica PR, una aprobación y CI. No pude observar la configuración de protección activa en GitHub. |
| US-01.2 | Clonar y ejecutar en un equipo limpio siguiendo solo README. | ✅ Cumple | En la copia limpia ejecuté los pasos README `npm install --prefix backend`, `npm install --prefix frontend`, `npm run backend:dev` y `npm run frontend:dev`; API `/api/health` y frontend `/` devolvieron 200. |
| US-01.3 | CI corre en PR, compila, prueba y falla ante errores; pasos locales equivalentes. | ✅ Cumple | `.github/workflows/ci.yml` tiene `pull_request`, tests backend y build frontend. `npm run ci`: exit 0, 2 archivos/45 tests aprobados, lint y builds exitosos. |
| US-01.4 | Stack y justificación de frontend, backend, BD, testing y app móvil. | ✅ Cumple | `README.md:23-29` documenta las cinco elecciones y una justificación para cada una. |
| US-01.5 | Demo preparada y documentada: variables, pasos exactos, intervención humana; demo desplegada. | 👤 Requiere revisión manual | `render.yaml` y README describen configuración reproducible; una persona debe crear la cuenta, conectar el repositorio, cargar `JWT_SECRET` y desplegar. No se afirma que esté desplegada. |
| US-02.1 | Entidades requeridas representadas en la BD real. | ✅ Cumple | Verificador: las 15 tablas requeridas existen, incluyendo `sessions`, `classes`, `fares`, pasajeros, compras, pasajes, pagos, facturas, historial y cancelaciones. |
| US-02.2 | Vuelo y salida separados; ocupación por vuelo, clase y fecha consultable. | ✅ Cumple | El mismo script ejecutó `flights JOIN departures` para ambas clases. Ejemplo: `AR1450`, `2026-11-02`, Economy `0/180` y Primera `0/20`. |
| US-02.3 | Estados de vuelo, salida y compra restringidos a valores permitidos. | ✅ Cumple | `verificacion/parte-a.mjs` intentó estados inválidos en las tres tablas; SQLite rechazó las escrituras. |
| US-02.4 | Un comando recrea esquema y seed; reset idempotente para uso repetido. | ✅ Cumple | En la copia limpia, dos ejecuciones consecutivas de `npm run db:reset` terminaron con código 0 y “Base de datos recreada y sembrada correctamente”. |
| US-02.5 | Modelo conceptual/lógico/físico, ER Mermaid válido, diccionario completo y validación en blanco. | 👤 Requiere revisión manual | ER y diccionario se completaron según `PRAGMA table_info`; la sección de validación permanece vacía para que la complete la comisión. |
| US-03.1 | Login correcto; email inexistente y contraseña incorrecta con misma respuesta. | ✅ Cumple | API real: login admin 200; email inexistente y contraseña incorrecta devolvieron ambos 401 y “Las credenciales ingresadas no son válidas.” |
| US-03.2 | Contraseñas con hash y sal, no texto plano. | ✅ Cumple | Consulta de SQLite: hashes existentes cumplen formato bcrypt `$2b$…`, no hay columna `password`/`passwd`. Dos usuarios QA insertados con bcrypt para la misma clave tuvieron hashes distintos. |
| US-03.3 | Menús y rutas protegidas según rol; empleado/pasajero sin pantallas admin. | 👤 Requiere revisión manual | `frontend/src/App.tsx:39-48,259-316` protege rutas admin y muestra esos links solo a admin; `:199-207` limita inicio por rol. Falta comprobar la experiencia visual en navegador. |
| US-03.4 | Matriz administrativa: sin token, inválido, vencido, empleado, pasajero y admin. | ✅ Cumple | API real: todas las celdas de la matriz devolvieron `401, 401, 401, 403, 403` y éxito admin. Rutas verificadas: 4 de aeropuertos y 7 de vuelos; detalle de celdas abajo. |
| US-03.5 | Logout invalida token y 30 min de inactividad con renovación al usarlo. | ✅ Cumple | API real: logout 200, mismo token 401, sesión con 31 min inactiva 401 y `lastActivity` avanzó en una petición válida. |
| US-03.6 | Tests cubren login correcto/incorrecto, permitido/denegado, logout y expiración. | ✅ Cumple | Suite de autenticación: email inexistente igual a contraseña errónea, revocación, renovación/timeout configurable, 401 y 403 por grupos de rutas. |
| US-06.1 | Alta de aeropuerto con IATA, nombre, ciudad y provincia. | ✅ Cumple | API real creó `YQB`; la respuesta incluyó los cuatro campos requeridos. |
| US-06.2 | Rechaza IATA inválido y repetido; informa error y define minúsculas. | ✅ Cumple | API real: `AB`, `ABCD`, `123`, `A$C` → 400 con motivo; duplicados `YQB` y `yqb` → 409. Minúsculas se normalizan a mayúsculas. |
| US-06.3 | Modifica, desactiva aeropuerto libre; bloquea aeropuerto de vuelo activo y permite uno usado solo por vuelos cancelados. | ✅ Cumple | API real: modificación 200, libre 200, usado por vuelo activo 400, usado solo por vuelo cancelado 200. |
| US-06.4 | Inactivo persiste, no aparece en opciones y backend bloquea alta/modificación de vuelo. | ✅ Cumple | API real: el aeropuerto inactivo siguió en listado general y no apareció con `?active=true`; POST y PUT de vuelo que lo referenciaron devolvieron 400. `frontend/src/Flights.tsx:235,393` consulta aeropuertos activos en formularios. |
| US-06.5 | Solo admin usa los endpoints de aeropuertos. | ✅ Cumple | Matriz real para GET/POST/PUT/DELETE `/api/airports`: sin token 401, inválido 401, vencido 401, empleado 403, pasajero 403, admin 200/201/200/200. |
| US-07.1 | Crear vuelo con todos los campos. | ✅ Cumple | `verificacion/parte-b.mjs`: POST devolvió 201; `QAV253804` quedó Activo con ruta, días, horas, período, capacidades y precios. |
| US-07.2 | Validar obligatorios, ruta, días, período, capacidades y precios. | ✅ Cumple | API real: cada uno de 12 campos obligatorios faltante y 9 validaciones de negocio (origen=destino, días vacíos, período invertido/pasado, capacidad total 0, precios 0/negativos en ambas clases) dieron 4xx, error por campo/motivo y sin cambios en conteos de vuelos/salidas/tarifas/historial. |
| US-07.3 | Llegada menor o igual a partida indica día siguiente. | ✅ Cumple | API: `23:00→01:00` y `10:00→10:00` dieron `arrivalsNextDay=true`; `10:00→11:00`, `false`. `frontend/src/Flights.tsx:193,620` agrega `+1` cuando el indicador es verdadero. |
| US-07.4 | Inválido no persiste e identifica campo y motivo. | ✅ Cumple | API: hora `25:61`, fechas `2026-02-31` en ambos campos y número duplicado rechazados con 4xx; error específico y conteos de tablas sin cambios. `frontend/src/Flights.tsx:245-271,283-357` muestra errores por campo con `role="alert"`. |
| US-07.5 | Activo, nueve salidas exactas y bordes incluidos sin duplicados. | ✅ Cumple | POST, 01/11–30/11/2026 lunes/viernes: 02, 06, 09, 13, 16, 20, 23, 27, 30/11; segunda prueba con desde=02/11 confirma inclusión del borde desde; hasta=30/11 incluido, todas Programadas, 0 duplicados. |
| US-07.6 | Solo administrador crea vuelos. | ✅ Cumple | Matriz API `GET/POST /flights`: sin token/inválido/vencido/empleado/pasajero = `401/401/401/403/403`; admin = `200/201`. Sin diferencias. |
| US-08.1 | Editar vuelo Activo salvo número; exige confirmación; ruta editable. | ✅ Cumple | API: PUT sin `confirmed` = 409 y horario intacto; confirmado actualizó horario, número `AR1450` inmutable pese a intentar cambiarlo; origen/destino editables (200); editar cancelado = 400. |
| US-08.2 | Modificación repite validaciones de creación. | ✅ Cumple | Ocho PUT inválidos (días, ruta, fecha imposible/pasada, hora, período, capacidad 0 y precio 0) dieron 4xx con campo/motivo; SQL antes/después idéntico. |
| US-08.3 | Cambios futuros sin alterar salidas pasadas. | ✅ Cumple | API/SQL `AR1450`: vuelo y tarifa Economy reflejaron horario `08:32` y precio `12505`; salida pasada `2026-09-21` conservó id, fecha, estado y ventas. |
| US-08.4 | Capacidad no menor a ventas; informa salida/clase en conflicto. | ✅ Cumple | Salida seed `2026-10-05`: SQLite contó Economy=5 y Primera=2 (fixture Primera agregado con tickets). Capacidad N−1 dio 400 y conflicto con fecha/campo en ambas; capacidad N, aumento y restauración dieron 200. |
| US-08.5 | Advierte y confirma cambios de días/período que afectan ventas. | ✅ Cumple | `AR2001`: ventas 05/06/07-10; quitar domingo/acortar período dio 409, listó 07-10 y no cambió filas. Confirmado: salida vendida Cancelada, 3 tickets preservados; salidas sin ventas eliminadas; al reañadir domingo generó salidas Programadas. |
| US-08.6 | Historial por campo con fecha, usuario y valores anterior/nuevo. | ✅ Cumple | GET detalle `AR1450`=200; 10 entradas en API y SQL con fecha/usuario/campo/valores completos; historial consultable y cambios de precio, horario y capacidad. |
| US-09.1 | Cancelación total/puntual exige confirmación explícita. | ✅ Cumple | API: cancelación puntual y total sin `confirmed` dieron 409; ambas confirmadas dieron 200. |
| US-09.2 | Aviso informa pasajes vendidos afectados. | ✅ Cumple | Salida `AR1450`: API aviso=7 y tickets confirmados en SQL=7; flujo total sin ventas aviso=0. `frontend/src/Flights.tsx:588-590` presenta la cantidad devuelta en la confirmación. |
| US-09.3 | Estado Cancelado, no modificable; segunda cancelación controlada. | ✅ Cumple | GET de listado y detalle tras cancelar vuelo dieron `CANCELLED/CANCELLED`; PUT y segunda cancelación puntual dieron 400. Cancelación total dejó cero salidas futuras Programadas. |
| US-09.4 | Conserva filas y registra fecha/hora/usuario de cancelación. | ✅ Cumple | Conteos SQLite de vuelos/salidas/tickets iguales antes/después; fecha/hora y usuario admin registrados. Salida ya cancelada mantuvo metadatos originales al cancelar el vuelo. |
| US-09.5 | Rechaza cancelar una salida pasada. | ✅ Cumple | POST cancelando una salida pasada de `AR1450` devolvió HTTP 400. |
| US-09.6 | Solo administrador cancela. | ✅ Cumple | Matriz API `POST /flights/:id/cancel` y `DELETE /flights/:id`: `401/401/401/403/403/200`, sin celdas inesperadas. |
| US-10.1 | Listado de 20, campos, total/páginas y límites coherentes. | ✅ Cumple | API: tamaño 20, total 125, 7 páginas; última página=5 y página 8 vacía conservando total; campos requeridos presentes. |
| US-10.2 | Filtros/orden contrastados con SQL y estables entre páginas. | ✅ Cumple | Ocho filtros solos/combinados por estado/origen/destino concordaron con SQL; orden asc/desc por número, ruta y partida concordó en páginas 1–2, sin ids repetidos. |
| US-10.3 | Detalle completo, disponibilidad contrastada e historial. | ✅ Cumple | GET detalle=200; campos, tarifas, salidas e historial presentes. En 3 salidas, vendidos/disponibles por clase coincidieron con SQL y `capacidad − vendidos`. |
| US-10.4 | Acciones Modificar/Cancelar solo en vuelos Activos. | 👤 Requiere revisión manual | API: vuelo Activo consultable/cancelable (200), Cancelado no modificable (400); `frontend/src/Flights.tsx:627,636` condiciona acciones a `ACTIVE`. Falta comprobar controles visualmente en navegador. |
| US-10.5 | Con ≥100 vuelos listado <2 s; método e índices. | ✅ Cumple | 126 vuelos en BD; 10 peticiones secuenciales por caso con `performance.now()` cliente HTTP: sin filtros mediana 6.7 ms/máx 6.8 ms; estado+origen 7.0/7.4 ms. `PRAGMA index_list(flights)` mostró índices de estado/ruta y horario. |
| Extra | Documentación, secretos/lint y rutas fuera de alcance. | ✅ Cumple | README usado en copia limpia; `docs/DECISIONES.md` registra decisiones; API devolvió 404 para compras, pagos, búsqueda de pasajeros, reportes, notificaciones, mostrador y móvil. La cancelación puntual mantuvo estado del vuelo y otras salidas; la cancelación total preservó metadatos de una salida ya cancelada. Se conserva evidencia Parte A sobre `.env.example`, `.gitignore`, secretos y lint/formateador. |
| Invariantes | Integridad de BD y flujo API de demo. | ❌ No cumple | Script: capacidad excedida `0`, vuelo Cancelado con futuras Programadas `0`, calendario activo divergente `0`, huérfanas `0`, duplicados `0`, historial incompleto `0`. **Las 500 salidas Canceladas del seed carecen de fecha/hora o usuario**. El flujo E2E API pasó. |

### Matrices de autorización ejecutadas

Orden de celdas: **sin token / token inválido / token vencido / empleado / pasajero / admin**. La expectativa fue `401 / 401 / 401 / 403 / 403 / éxito`; no hubo celdas inesperadas.

| Superficie | Endpoint | Resultado observado |
|---|---|---|
| Aeropuertos | GET `/api/airports` | 401 / 401 / 401 / 403 / 403 / 200 |
| Aeropuertos | POST `/api/airports` | 401 / 401 / 401 / 403 / 403 / 201 |
| Aeropuertos | PUT `/api/airports/:id` | 401 / 401 / 401 / 403 / 403 / 200 |
| Aeropuertos | DELETE `/api/airports/:id` | 401 / 401 / 401 / 403 / 403 / 200 |
| Vuelos | GET `/api/flights` | 401 / 401 / 401 / 403 / 403 / 200 |
| Vuelos | POST `/api/flights` | 401 / 401 / 401 / 403 / 403 / 201 |
| Vuelos | GET `/api/flights/:id` | 401 / 401 / 401 / 403 / 403 / 200 |
| Vuelos | PUT `/api/flights/:id` | 401 / 401 / 401 / 403 / 403 / 200 |
| Vuelos | PATCH `/api/flights/:id` | 401 / 401 / 401 / 403 / 403 / 200 |
| Vuelos | POST `/api/flights/:id/cancel` | 401 / 401 / 401 / 403 / 403 / 200 |
| Vuelos | DELETE `/api/flights/:id` | 401 / 401 / 401 / 403 / 403 / 200 |

### Seed observado antes de las pruebas mutantes

Después del reset final de la copia temporal: **110 vuelos** (100 Activos, 10 Cancelados), **12 aeropuertos** (1 inactivo), **5.464 salidas**, 8 tickets confirmados de seed, 3 entradas de historial y 39 vuelos nocturnos. Hay una salida futura de `AR1450` con cinco tickets Economy y tres salidas futuras vendidas de `AR2001`. Las 500 salidas Canceladas de los 10 vuelos seed carecen de `cancelledAt` y `cancelledByUserId`; este es el defecto reportado abajo.

### Diferencias frente a `docs/CHECKLIST_CRITERIOS.md`

- US-02.1 y US-02.3 quedaron corregidos y contrastados contra SQLite, incluidas las tres restricciones de estado.
- US-03.5 y US-03.6 quedaron cubiertos con sesión revocable/deslizante, timeout, comparación de login genérica y casos de autorización.
- La evidencia citada para US-03.2/03.3 no prueba formato/sal en la base ni la UI; la comprobación independiente de hashes sí pasó, pero la revisión visual de roles sigue pendiente.
- Para US-03.4 y US-06.5, los tests citados no cubren las seis condiciones de la matriz ni cada endpoint. La matriz independiente completa sí pasó.
- Para US-06.2/03/04, los tests existentes no cubren minúsculas, desactivación de aeropuerto usado solo por vuelos cancelados ni modificación de vuelo con aeropuerto inactivo. Las pruebas independientes de esos casos pasaron.
- US-01.1 y US-01.5 permanecen sujetos a revisión humana; el Blueprint está preparado, pero el despliegue no se realizó.
- Las declaraciones de `docs/CHECKLIST_CRITERIOS.md` para US-07 a US-10 se contrastaron ahora contra la API real: los comportamientos funcionales probados coinciden. La UI de US-10.4 sigue pendiente de navegador, tal como el checklist anticipa.
- El checklist no incluye la invariante sobre salidas canceladas sin metadatos. La consulta independiente detectó 500 filas así; esto contradice la integridad requerida de las cancelaciones aunque no surja de los tests listados.

## Defectos

D-01 a D-08 corresponden a hallazgos del primer pase de Parte A y están consignados como corregidos; D-09 es el único defecto abierto de esta verificación.

| ID | Severidad | Cómo reproducir | Esperado vs obtenido | Archivo probable |
|---|---|---|---|---|
| D-01 | Bloqueante | Login; `POST /api/auth/logout`; repetir `GET /api/auth/me` con el mismo Bearer. | Corregido: logout 200 y el mismo token recibe 401. | `backend/src/app.ts`, `backend/src/auth.ts` |
| D-02 | Mayor | Ejecutar `npm run db:reset` y contar vuelos/tablas/pasajes en SQLite. | Corregido: seed tiene 110 vuelos (100 activos, 10 cancelados), salidas pasadas/futuras y tickets confirmados de prueba. | `backend/src/db/index.ts` |
| D-03 | Mayor | Ejecutar escrituras `INVALID_QA` sobre vuelo, salida y compra. | Corregido: SQLite rechaza las tres mediante triggers de estado. | `backend/src/db/index.ts` |
| D-04 | Mayor | Comparar cada `PRAGMA table_info` con el diccionario de `docs/modelo-datos.md`. | Corregido: diccionario actualizado con las tablas y columnas reales. | `docs/modelo-datos.md` |
| D-05 | Mayor | Revisar configuración y pasos de demo. | Preparado en `render.yaml` y README; cuenta, conexión, secreto y despliegue siguen pendientes de una persona. | `render.yaml`, `README.md` |
| D-06 | Mayor | Iniciar sin `JWT_SECRET`. | Corregido: no hay fallback; el servidor falla al iniciar. El ejemplo del `.env` es un placeholder falso. | `backend/src/config.ts`, `.env.example` |
| D-07 | Menor | Inspeccionar scripts y configuración. | Corregido: ESLint y Prettier configurados en ambos paquetes; lint agregado a CI. | `package.json`, `backend/eslint.config.js`, `frontend/eslint.config.js` |
| D-08 | Menor | Ejecutar tests de autenticación y CI. | Corregido para los casos solicitados: revocación, inactividad/renovación, login genérico y 401/403 por grupo. | `backend/src/tests/auth.test.ts` |
| D-09 | Bloqueante | Ejecutar `npm run db:reset`; consultar `SELECT COUNT(*) FROM departures WHERE status='CANCELLED' AND (cancelledAt IS NULL OR cancelledByUserId IS NULL)`. | Esperado: 0. Obtenido: 500 salidas del seed, de 500 canceladas, sin fecha/hora o usuario. `departureRows` asigna solo `status='CANCELLED'` para vuelos cancelados. | `backend/src/db/index.ts:679-686` |

## Revisión manual pendiente (👤)

- Confirmar en GitHub que `main` tiene protección activa, requiere al menos una aprobación y CI obligatorio.
- Abrir el frontend en navegador con admin, empleado y pasajero; revisar menús, rutas, restricciones y presentación visual.
- US-10.4: verificar visualmente en navegador que Modificar/Cancelar solo aparecen en vuelos Activos.
- Verificar que ambas comisiones pueden acceder al entorno de demo desplegado. La documentación actual indica que no hay despliegue público configurado.

## Qué ejecuté y duración

| Comando/acción | Resultado y duración observada |
|---|---|
| Copia temporal excluyendo `.git`, `node_modules`, `.env` y SQLite; instalación README `npm install --prefix backend` y `npm install --prefix frontend` | Instalación exitosa; duración no capturada. |
| `npm run ci` | Exit 0; 2 archivos, 45 tests; lint y builds backend/frontend exitosos. Vitest informó **29.76 s**; duración total de CI no capturada. |
| `npm run db:reset` ×2 consecutivas | Ambas exitosas (“Base de datos recreada y sembrada correctamente”); duración combinada no capturada. |
| `npm run backend:dev`; `GET http://127.0.0.1:3001/api/health` | API temporal respondió HTTP 200; duración no capturada. |
| `npm --prefix frontend run dev`; `curl.exe --silent --output NUL --write-out "HTTP %{http_code}" http://127.0.0.1:5173/` | Frontend temporal respondió HTTP 200; duración no capturada. |
| `node <repo>\verificacion\parte-a.mjs` | Evidencia de la pasada previa Parte A, conservada en este informe. |
| Desde la copia temporal: `node "C:\Users\User\Downloads\Administracion de  proyectos\Implementacion\SIGVA\verificacion\parte-b.mjs"` | API/SQLite reales; última corrida: 19/20 comprobaciones agrupadas pasaron. Se corrigieron supuestos erróneos y se amplió la cobertura; informe basado en la corrida final sobre DB limpia. Duración no capturada. |
| `npm run db:reset` final en copia temporal | Exit 0; **2.15 s**. Restauró el seed limpio; SQL final: 110 vuelos (100 Activos/10 Cancelados), 5.464 salidas y 500 canceladas sin metadatos. |

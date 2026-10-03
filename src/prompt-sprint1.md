# SIGVA — Implementar el Sprint #1

Proyecto: SIGVA, Sistema Integral de Gestión de Vuelos y Venta de Pasajes (materia Administración de Proyectos de Software, UNS).
Implementá **solo** el Sprint #1: no inventes requisitos ni implementes otros sprints. Este documento es el resumen operativo de la especificación; los documentos de `referencia/` son su fuente original (ver la sección siguiente).

**Objetivo:** un administrador inicia sesión en la plataforma web y gestiona la oferta de vuelos: registra aeropuertos y crea, modifica, cancela y consulta vuelos con sus salidas.

## Referencias y estructura de carpetas

Estás trabajando en esta carpeta:

```
SIGVA/
├── referencia/
│   ├── ENUNCIADO_SIGVA.txt
│   └── SPRINT_0_SIGVA.txt       (extracto del Sprint 0)
├── prompt-sprint1.md        ← este documento
└── (vacío: el proyecto lo creás vos acá, en la raíz)
```

- **Creá el proyecto en la raíz de esta carpeta**, junto a `referencia/`: `backend/`, `frontend/`, `docs/`, `.github/`, `README.md`, `CONTRIBUTING.md`, `.gitignore`. Esta raíz es la raíz del repositorio. Que existan `referencia/` y este prompt no significa que haya un proyecto previo.
- No modifiques, muevas ni borres `referencia/` ni este archivo. Excluí `referencia/` del linter, del formateador y de los tests.
- Los documentos de `referencia/` son la **fuente original**. Ante una diferencia entre este prompt y el Sprint 0, seguí el Sprint 0 para los requisitos funcionales y criterios de aceptación, y anotá la diferencia en `docs/DECISIONES.md`. Para decisiones técnicas y reglas de trabajo (stack, Git, ahorro de tokens) prevalece este prompt. El enunciado sirve solo como contexto del dominio: no implementes nada fuera del alcance de la sección 1.
- **No releas los documentos una y otra vez.** Consultá `SPRINT_0_SIGVA.txt` por sección y solo cuando haga falta (una duda, una discrepancia o para verificar criterios de la US que estás cerrando). `ENUNCIADO_SIGVA.txt` es corto: podés leerlo entero una vez.

| Qué necesitás | Dónde |
| --- | --- |
| Definiciones de dominio (vuelo/salida, período, vuelos nocturnos) | `SPRINT_0_SIGVA.txt`, apartado "Supuestos y aclaraciones" |
| Tareas y criterios de aceptación de las 8 US | `SPRINT_0_SIGVA.txt`, Parte 2, §2.1 (una subsección por US) |
| Definición de terminado | `SPRINT_0_SIGVA.txt`, §2.3 |
| Contexto del dominio | `ENUNCIADO_SIGVA.txt` (archivo completo) |

- En el extracto del Sprint 0 ignorá las horas estimadas por tarea.
- Si no podés abrir alguno de estos archivos, trabajá solo con este documento y anotá en `docs/DECISIONES.md` que no pudiste consultarlo.

## 0. Reglas de trabajo (priorizá gastar pocos tokens)

- No pidas confirmaciones. Decidí lo razonable y anotalo en `docs/DECISIONES.md` (una línea por decisión). Solo frená ante una decisión irreversible y realmente ambigua.
- Si no hay un proyecto existente (lo normal: solo `referencia/` y este prompt), usá este stack sin evaluar alternativas: Node.js + TypeScript + Express, SQLite con un ORM liviano con migraciones, React + Vite, Vitest + Supertest, GitHub Actions. Si ya existe un proyecto, respetá su stack.
- Inspección inicial acotada: listá la carpeta y, solo si hubiera un proyecto existente, revisá su estructura (2 niveles), `README`, manifest (`package.json` o equivalente) y archivos de configuración del proyecto, del testing y del CI. No leas lockfiles ni archivos de implementación que no sean relevantes para el Sprint 1.
- Implementá cada US de punta a punta y pasá a la siguiente. Evitá releer archivos recién escritos salvo que un test, la compilación o la integración indiquen un problema (en ese caso revisá solo los archivos involucrados). No pegues archivos completos en tus respuestas ni hagas resúmenes intermedios.
- Tests: mientras desarrollás corré solo los de la US actual; al cerrarla, la suite completa. Usá un reporter mínimo (solo fallos y totales) y, si algo falla, mostrá solo las líneas relevantes.
- Usá opciones silenciosas en instalaciones, builds y tests (ej. `--silent`, reporter mínimo) y recortá las salidas largas (`tail`).
- Si el mismo error persiste después de 2 intentos de corrección, no sigas reintentando: anotalo en 3 líneas en `docs/DECISIONES.md`, marcá el criterio afectado como no verificado en el checklist y pasá a lo siguiente.
- Generá los datos de prueba con un script (bucles), no a mano.
- Documentación breve, en tablas y bullets. Creá solo los documentos de la sección 11.
- Git: **no hagas commits, ramas, push ni pull requests**. Entregá el proyecto listo para commitear: con `.gitignore`, sin `node_modules`, sin `.env` reales y sin bases de datos generadas.
- Todo texto visible para el usuario (interfaz, errores, README) va en español.
- No afirmes que algo funciona, está protegido o está desplegado si no lo probaste.
- Orden: US-01 → 02 → 03 → 06 → 07 → 10 → 09 → 08 (el detalle de US-10 aloja las acciones de US-09 y US-08).

## 1. Alcance

- **Dentro:** US-01, US-02, US-03, US-06, US-07, US-08, US-09, US-10.
- **Fuera:** US-04, US-05 y US-11 a US-29 (registro de pasajeros, cuentas de empleados, búsqueda y compra de pasajes, pagos, tickets y facturas, reportes, notificaciones, mostrador, app móvil).
- Podés modelar `Pasajero`, `Compra`, `Pasaje`, `Pago` y `Factura` (tablas, enums y datos de prueba), pero sin pantallas ni flujos de compra o pago.

## 2. Dominio

- **Vuelo** = programación: número único, origen, destino, días de la semana, hora de partida y de llegada, período de disponibilidad (desde/hasta, inclusive), capacidad y precio por clase (Economy y Primera).
- **Salida** = operación concreta de un vuelo en una fecha. Disponibilidad y ocupación se calculan por vuelo, clase y fecha. No confundas vuelo con salida.
- Si hora de llegada ≤ hora de partida, llega al día siguiente: mostrar `+1` junto a la llegada (formulario, listado y detalle).
- Estados: Vuelo = Activo | Cancelado. Salida = Programada | Cancelada. Compra = Reservada | Confirmada | Vencida | Rechazada.
- Roles: Administrador, Empleado de mostrador, Pasajero.
- Decisión técnica (no viene del Sprint 0): manejá las fechas de salida como fechas de calendario en `America/Argentina/Buenos_Aires`, salvo que el proyecto existente ya documente otra convención.
- Validaciones, reglas de negocio y autorización se aplican en el backend; el frontend solo las refleja. Nunca elimines información histórica.

## 3. US-01 — Infraestructura

Hacer: estructura de carpetas, convenciones, linter, formateador, `.env.example` (sin secretos), README de instalación y ejecución, BD local, CI y mecanismo de demo.

Criterios:
1. La rama principal debe quedar protegida: solo admite cambios por pull request aprobado por al menos otro integrante, y exige que pase el CI. Se configura en GitHub: dejá los pasos exactos en `CONTRIBUTING.md` y en el README.
2. Un integrante puede clonar y ejecutar el proyecto en un equipo limpio siguiendo únicamente el README.
3. `.github/workflows/ci.yml` se ejecuta en cada pull request, compila, corre los tests y falla si algo falla. Comando local equivalente: `npm run ci`.
4. Stack documentado (frontend, backend, BD, testing y app móvil —solo selección y justificación, no se implementa—) con la justificación de cada elección.
5. Entorno de demostración accesible por ambas comisiones (implementadora y Análisis y Management) con la última versión de la rama principal: dejá configurado el despliegue y documentá variables y pasos exactos, marcando qué paso requiere intervención humana.

## 4. US-02 — Modelo de datos

Entidades mínimas: aeropuertos, vuelos, salidas, clases, tarifas/precios, usuarios, roles, pasajeros, compras, pasajes, pagos, facturas, historial de cambios de vuelo y registro de cancelaciones (fecha/hora y usuario).

Criterios:
1. El modelo representa esas entidades y los estados de la sección 2, y distingue vuelo de salida.
2. Un único comando recrea el esquema desde cero y carga los datos de prueba (ej. `npm run db:reset`).
3. `docs/modelo-datos.md` contiene: modelo conceptual, lógico y físico (índices, restricciones, scripts), diagrama ER en Mermaid, diccionario de datos y una sección `## Validación` con `Fecha:`, `Validador:` y `Observaciones:` **en blanco** (la completa Análisis y Management; no marques el modelo como validado).

Datos de prueba:
- ~10 aeropuertos argentinos reales, uno de ellos inactivo.
- Administrador, empleado de mostrador y pasajero (credenciales en el README).
- Al menos 100 vuelos Activos y Cancelados, incluidos nocturnos, con sus salidas. Generá las fechas del seed en relación al día de ejecución, de modo que siempre existan salidas pasadas (para probar que no se modifican ni se cancelan) y futuras.
- Pasajes vendidos artificiales (solo datos de prueba): una salida futura con N pasajes Economy vendidos (para probar el rechazo por capacidad), un vuelo con ventas en varias salidas futuras (para la advertencia por cambio de días/período) y algunos vuelos con historial de cambios.

## 5. US-03 — Login y control de acceso

- Login con email y contraseña; ante cualquier dato incorrecto, mensaje genérico que no indica cuál falló.
- Logout. Sesión/token que expira tras 30 minutos de inactividad.
- Contraseñas con hash y sal, nunca en texto plano. Administrador inicial.
- Backend: 401 sin sesión válida (o expirada), 403 con rol insuficiente.
- Frontend: menú y rutas protegidas según rol. Empleado y pasajero no tienen funcionalidades en este Sprint: tras autenticarse solo ven un mensaje "Disponible próximamente" (decisión de implementación; registrala en `docs/DECISIONES.md`).
- Tests: login correcto e incorrecto, mensaje genérico, 401, 403, acceso permitido y denegado por rol, logout y expiración.

## 6. US-06 — Aeropuertos (solo Administrador)

- Listar, crear, modificar y desactivar (baja lógica). Datos: código IATA, nombre, ciudad, provincia y estado.
- IATA de exactamente 3 letras y único: rechazar duplicado o formato inválido informando el error.
- No se puede desactivar un aeropuerto que sea origen o destino de un vuelo activo.
- Los inactivos se conservan y no se ofrecen al crear ni modificar vuelos.
- Tests: alta, modificación, IATA inválido, IATA duplicado, baja lógica, baja rechazada por vuelo activo, inactivo ausente en formularios de vuelo, 403 para otros roles.

## 7. US-07 — Crear vuelos (solo Administrador)

Antes de la pantalla, dejá un wireframe simple en `docs/prototipos/` (para que lo valide Análisis y Management; no digas que ya fue validado).

Campos: número de vuelo, días de la semana (selección múltiple), hora de partida, hora de llegada, origen y destino (solo aeropuertos activos), fecha desde, fecha hasta, asientos Economy y Primera, precio Economy y Primera.

Validaciones (backend y frontend):
- Todos los campos obligatorios completos; número de vuelo único.
- Origen distinto de destino.
- Al menos un día de operación.
- Fecha hasta ≥ fecha desde, y fecha desde ≥ día actual.
- Capacidad total > 0; toda clase con asientos tiene precio > 0.
- Ante error: no guardar, señalar el campo y el motivo.

Al guardar: estado Activo y se generan las salidas según días y período. Caso obligatorio, con test automático: lunes y viernes del 01/11/2026 al 30/11/2026 generan **9 salidas**.

Tests: creación válida, cada validación, vuelo nocturno (+1), generación de salidas y 403 para otros roles. Los tests no deben depender del día en que se ejecutan (el caso de noviembre de 2026 dejaría de ser válido después del 01/11): permití fijar o inyectar la fecha actual.

## 8. US-08 — Modificar vuelos (solo Administrador)

- Se modifica un vuelo **Activo**; todo dato menos el número (días, horarios, período, capacidad, precios, origen, destino). Todo cambio se guarda recién tras una confirmación explícita. Mismas validaciones que en US-07.
- Los cambios afectan solo a salidas futuras; las ya realizadas no se modifican.
- No se puede reducir la capacidad de una clase por debajo de los pasajes vendidos en alguna salida futura: indicar la salida en conflicto.
- Si un cambio de días o período deja sin efecto salidas futuras con pasajes vendidos: advertir, informar el conflicto y pedir confirmación; al confirmar, esas salidas pasan a Cancelada. Las salidas futuras sin ventas que dejan de corresponder se eliminan y se generan las nuevas que correspondan (documentalo en `docs/DECISIONES.md`).
- Historial: cada modificación registra fecha, hora, usuario, valor anterior y valor nuevo; se consulta desde el detalle del vuelo.
- Tests: modificación normal, validaciones, capacidad válida e inválida (con la salida en conflicto), cambio de días, cambio de período, conflicto con ventas más confirmación, historial y 403.

## 9. US-09 — Cancelar vuelos (solo Administrador)

- Cancelación completa (el vuelo y todas sus salidas futuras) o puntual (una única salida futura), siempre con confirmación explícita que informa cuántos pasajes vendidos se ven afectados.
- Después: estado Cancelado en listado y detalle, sin modificaciones posteriores, sin borrar registros, con fecha/hora y usuario responsable guardados.
- No se cancelan salidas cuya fecha ya pasó. Una cancelación completa no altera salidas que ya estaban canceladas.
- Tests: vuelo sin ventas, vuelo con ventas, salida puntual, cancelación completa, aviso de pasajes afectados, salida pasada rechazada, historial conservado y 403.

## 10. US-10 — Listado y consulta (solo Administrador)

- **Listado:** 20 por página, con número, origen, destino, partida, llegada (con `+1`), días, período y estado. Filtros por estado, origen y destino. Orden por número de vuelo, ruta u horario de partida.
- **Detalle:** todos los datos, capacidades y precios por clase, salidas con asientos vendidos y disponibles por clase, e historial. Acciones Modificar y Cancelar, solo si el vuelo está Activo.
- **Rendimiento:** con al menos 100 vuelos, el listado responde en menos de 2 segundos (agregá índices). Medilo y documentá en el checklist: cantidad de registros, endpoint, método de medición y resultado.
- Tests: paginación, filtros, orden, detalle, disponibilidad, rendimiento y 403.

## 11. Integración, documentación y cierre

Flujo de demo: debe estar cubierto por un test de integración automatizado y poder recorrerse a mano en la interfaz, con los datos de prueba, para la demo del 06/10: login de administrador → crear dos aeropuertos → crear vuelo → verificar salidas → consultar → modificar precio, horario y días → verificar historial → cancelar una salida → verificar estado → cancelar el vuelo → verificar salidas futuras canceladas.

Documentos (solo estos): `README.md`, `CONTRIBUTING.md`, `docs/modelo-datos.md`, `docs/DECISIONES.md`, `docs/prototipos/`, `docs/CHECKLIST_CRITERIOS.md`.

`docs/CHECKLIST_CRITERIOS.md`: una fila por cada criterio de aceptación de las 8 US tal como figura en `SPRINT_0_SIGVA.txt` (Parte 2, §2.1), con su misma numeración (ej. `US-07.5`) para que Análisis y Management pueda contrastarlo, con columnas `US | Criterio | Estado | Cómo verificarlo | Evidencia` (evidencia = nombre del test o paso de la demo). Estados posibles: *Cumplido y verificado*, *Implementado pero no verificable*, *No cumplido*, *Requiere intervención humana*.

Una US está terminada solo si: sus tareas están hechas, sus tests pasan, se cumplen y verificaron todos sus criterios, puede demostrarse en la demo del 06/10, la documentación está actualizada, el proyecto corre siguiendo el README y no rompe lo anterior. Que compile no alcanza.

Antes de finalizar: corré la suite completa, corré el flujo de demo, medí el rendimiento, completá el checklist y reportá en pocas líneas qué criterios no pudiste verificar.

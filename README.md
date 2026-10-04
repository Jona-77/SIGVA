# SIGVA

Sistema Integral de Gestión de Vuelos y Venta de Pasajes.

## Vuelos

Luego de ingresar como administrador, la opción **Vuelos** permite consultar, filtrar, ordenar y paginar la oferta, ver el detalle, crear vuelos, modificarlos y cancelarlos. El alta genera automáticamente las salidas dentro del período y la modificación y cancelación respetan validaciones de capacidad y confirmación explícita para salidas con ventas.

## Flujo de demo

| Rol | Email | Contraseña |
|---|---|---|
| Administrador | `admin@sigva.test` | `Admin123!` |
| Empleado | `empleado@sigva.test` | `Empleado123!` |
| Pasajero | `pasajero@sigva.test` | `Pasajero123!` |

1. Iniciar sesión como administrador con las credenciales de la tabla.
2. Crear dos aeropuertos (por ejemplo `AEP` y `COR`) desde la administración.
3. Crear un vuelo con un período de noviembre de 2026 y verificar que se generen 9 salidas para lunes y viernes.
4. Consultar el listado y el detalle del vuelo, comprobando horarios, salidas y disponibilidad por clase.
5. Modificar precio, horario y días de operación con confirmación; verificar el historial del vuelo.
6. Cancelar una salida puntual y confirmar el cambio de estado y el aviso de pasajes afectados.
7. Cancelar el vuelo completo para verificar que todas las salidas futuras quedan canceladas.

## Medición de rendimiento

La validación automatizada del listado con 100 vuelos activos ejecuta la consulta en menos de 2 segundos. Resultado observado en la suite de backend: `performance.now()` en el test `US-10 listado y consulta de vuelos > responde el listado de al menos cien vuelos en menos de dos segundos` permaneció bajo el umbral de 2000 ms.

## Stack

- Frontend: React + Vite + TypeScript para una UI rápida y modular.
- Backend: Node.js + TypeScript + Express para APIs REST, validación y control de acceso.
- Base de datos: SQLite con Sequelize para persistencia local, migraciones simples y pruebas reproducibles.
- Testing: Vitest + Supertest para validar backend y regresiones de API.
- App móvil: no se implementa en este sprint; para esta iteración se prioriza web y backend. La selección propuesta es React Native + Expo por su integración con React y despliegue ágil.

## Requisitos

- Node.js 20+
- npm 10+

## Instalación

1. Clonar el repositorio.
2. Crear un `.env` a partir de `.env.example` en la raíz.
3. Instalar dependencias del backend y del frontend.

```bash
npm install --prefix backend
npm install --prefix frontend
```

## Variables de entorno

Copia `./.env.example` y ajusta valores locales:

```bash
cp .env.example .env
```

| Variable | Uso | Valor local |
|---|---|---|
| `JWT_SECRET` | Firma de sesiones; obligatorio al iniciar la API. | Reemplazar el ejemplo por un secreto aleatorio propio. |
| `SESSION_TIMEOUT_MINUTES` | Minutos de inactividad antes de invalidar la sesión. | `30` |
| `PORT` | Puerto de la API. | `3001` |
| `CLIENT_URL` | Origen permitido por CORS. | `http://localhost:5173` |
| `DB_PATH` | Archivo SQLite. | `./backend/data/sigva.sqlite` |
| `VITE_API_URL` | URL de la API consumida por el frontend. | No definir para usar `http://localhost:3001`. |

## Ejecutar

Backend:

```bash
npm --prefix backend run dev
```

Frontend:

```bash
npm --prefix frontend run dev
```

## Comandos útiles

```bash
npm --prefix backend run db:reset
npm --prefix backend run test
npm --prefix frontend run build
npm run lint
npm run format
npm run ci
```

## CI y protección de rama principal

La rama `main` debe protegerse en GitHub:

1. En GitHub, ir a Settings > Branch protection rules.
2. Activar "Require a pull request before merging".
3. Configurar "Require approvals" con al menos 1 aprobación.
4. Activar "Require status checks to pass before merging" y seleccionar el workflow `CI`.
5. Guardar la regla.

## Entorno de demostración

El repositorio incluye `render.yaml` para preparar un frontend estático y una API de demostración. **No se afirma que exista un despliegue activo ni que la demo esté desplegada.**

1. Una persona crea una cuenta en Render y conecta este repositorio a su cuenta.
2. En Render, crea un Blueprint desde el repositorio y acepta los dos servicios definidos en `render.yaml`.
3. La persona carga el secreto `JWT_SECRET` en el servicio `sigva-api` desde el panel de Render. Debe generar un valor aleatorio privado; no reutilizar el texto de ejemplo.
4. Render construye ambos servicios. Si los nombres `sigva-api` o `sigva-demo` ya están ocupados, asignar nombres únicos en el Blueprint y actualizar `CLIENT_URL` con la URL pública real del frontend y `VITE_API_URL` con la URL pública real de la API antes de desplegar.
5. Compartir con ambas comisiones la URL pública del frontend que Render muestre. La API usa `DB_PATH=/tmp/sigva.sqlite`, un filesystem efímero: la base de datos se pierde al reiniciar el servicio y se vuelve a crear y sembrar con los datos demo. Este comportamiento es esperado y suficiente para la demo; no es almacenamiento persistente.

El sitio estático incluye una regla de rewrite `/*` → `/index.html` para que refrescar o abrir una ruta interna de React Router no devuelva 404.

Las otras variables están definidas en `render.yaml`: `SESSION_TIMEOUT_MINUTES`, `PORT`, `CLIENT_URL`, `DB_PATH` y `VITE_API_URL`. `JWT_SECRET` requiere carga manual en el panel; crear la cuenta, conectar el repositorio y entregar la URL también son pasos humanos.

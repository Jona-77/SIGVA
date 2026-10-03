# SIGVA

Sistema Integral de Gestión de Vuelos y Venta de Pasajes.

## Vuelos

Luego de ingresar como administrador, la opción **Vuelos** permite consultar, filtrar, ordenar y paginar la oferta, ver el detalle, crear vuelos, modificarlos y cancelarlos. El alta genera automáticamente las salidas dentro del período y la modificación y cancelación respetan validaciones de capacidad y confirmación explícita para salidas con ventas.

## Flujo de demo

1. Iniciar sesión como administrador con `admin@sigva.test` / `Admin123!`.
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

La demostración del sprint se ejecuta desde el entorno local de desarrollo configurado en la máquina de la comisón, o desde un despliegue estático del frontend y una instancia local del backend en un entorno compartido. En esta tanda se documenta la configuración de ejecución y no se asume un despliegue público habilitado.

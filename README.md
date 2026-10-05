# SIGVA

## Requisitos

- Node.js 20 o superior
- npm 10 o superior

## Instalación y configuración

Desde la raíz del repositorio:

```bash
npm install --prefix backend
npm install --prefix frontend
```

Crea `.env` desde `.env.example` y reemplaza `JWT_SECRET` por un secreto aleatorio:

```bash
cp .env.example .env
```

## Base de datos y ejecución

Al iniciar el backend por primera vez se crea `backend/data/sigva.sqlite` y se carga el seed de demo. Para borrar y volver a cargar la base:

```bash
npm run db:reset
```

El reset reemplaza los datos existentes. Inicia cada servicio en una terminal desde la raíz:

```bash
npm run backend:dev
npm run frontend:dev
```

Frontend: <http://localhost:5173>

API: <http://localhost:3001>

Estado de la API: <http://localhost:3001/api/health>

## Verificar compilación y tests del backend

Desde la raíz del repositorio, ejecuta:

```bash
npm --prefix backend run build
npm --prefix backend test
```

El primer comando verifica la compilación TypeScript del backend. El segundo ejecuta todas las suites de `backend/tests`; Vitest las corre en serie porque comparten la base de datos SQLite. La ejecución termina correctamente cuando todas las suites y sus tests aparecen como aprobados.

## Usuario de demo

- Administrador: `admin@sigva.test`
- Contraseña: `Admin123!`

## Render

El archivo `render.yaml` configura el Blueprint del frontend y la API. Crea el Blueprint desde Render y configura `JWT_SECRET` en el servicio `sigva-api`.

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

- Pasajero: `pasajero@sigva.test`
- Contraseña: `Pasajero123!`
- Administrador: `admin@sigva.test`
- Contraseña: `Admin123!`

## Recorrido de compra

1. Inicia sesión como pasajero o crea una cuenta, busca vuelos y selecciona una salida, clase y cantidad.
2. Completa los datos de quienes viajan; el titular aparece precargado. Al confirmar, se crea la reserva temporal.
3. En la reserva, revisa el contador y el total, y selecciona **Pagar**.
4. En modo `local-sandbox`, la pantalla indica **Sandbox local — no es un cobro real** y permite aprobar o rechazar la prueba. Para la demo con cobro sandbox externo, configura Mercado Pago.
5. Al regresar, SIGVA consulta el pago al servidor de la pasarela y muestra el resultado y los códigos `SIGVA-XXXXXX` emitidos.
6. Para probar asientos limitados, selecciona una salida con 2 asientos Economy disponibles y cotiza 3: la API debe rechazar la cotización. Para probar vencimiento, configura `RESERVATION_MINUTES=0.1`, reinicia backend, crea una reserva y espera a que llegue a cero.

### Mercado Pago sandbox

La integración `mercadopago` utiliza Checkout Pro y consulta el pago por su referencia en la API de Mercado Pago; nunca confía en el estado enviado por la URL de retorno. El token se mantiene en el backend y no se procesan ni guardan datos de tarjeta. El modo `local-sandbox` solo prueba el flujo y **no realiza cobros**; por eso, los criterios de integración externa del DoD 4 y 6 requieren `mercadopago`.

Pasos humanos pendientes para una demo real en sandbox:

- Crear una cuenta de desarrollador, una aplicación y las cuentas de prueba de vendedor y comprador de Mercado Pago.
- Configurar `PAYMENT_GATEWAY=mercadopago` y cargar `MP_ACCESS_TOKEN` como secreto en Render; nunca guardarlo en el repositorio.
- Usar las URLs públicas `CLIENT_URL=https://sigva-demo.onrender.com` y `VITE_API_URL=https://sigva-api.onrender.com`. Mercado Pago no acepta `localhost` en `back_urls`; para desarrollo local, usa `local-sandbox`.
- Desplegar ambos servicios y completar una compra con credenciales de prueba. No se afirma que esta prueba externa ni el despliegue se hayan realizado.

Referencias oficiales consultadas: [crear preferencia Checkout Pro](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/create-preference/post), [obtener un pago](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/get-payment/get) y [configurar URLs de retorno](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/configure-back-urls).

## Render

El archivo `render.yaml` configura el Blueprint del frontend y la API con `PAYMENT_GATEWAY=mercadopago`. Crea el Blueprint desde Render y configura `JWT_SECRET` y `MP_ACCESS_TOKEN` como secretos en el servicio `sigva-api`.

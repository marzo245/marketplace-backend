# Meshy 3D Worker

Backend Node.js que recibe fotos desde la app Flutter, crea trabajos de generacion 3D en Meshy AI, guarda fotos/modelos en Cloudinary y publica el producto cuando el modelo queda listo.

## Que hace hoy

1. Recibe `POST /api/v1/products/create` con fotos multipart.
2. Exige un token valido de Firebase Auth para crear productos.
3. Sube las fotos a Cloudinary.
4. Crea el documento del producto en Firestore con `model3d.status = queued`.
5. Encola un job en Redis con BullMQ.
6. El worker reserva creditos del mes y crea la tarea en Meshy.
7. Meshy llama `POST /webhooks/meshy` con firma HMAC.
8. El webhook descarga `.glb` y `.usdz`, los guarda en Cloudinary y marca el producto como `published`.
9. Si el vendedor tiene tokens FCM registrados en `users/{sellerId}.fcmTokens`, envia una notificacion.

## Estructura real

```text
src/
|-- server.js
|-- config/
|   `-- index.js
|-- middleware/
|   `-- auth.js
|-- routes/
|   |-- products.js
|   `-- webhooks.js
|-- services/
|   |-- credits.js
|   |-- firebase.js
|   |-- meshy.js
|   |-- notifications.js
|   |-- queue.js
|   `-- storage.js
|-- utils/
|   `-- logger.js
`-- workers/
    `-- processor.js
```

## Requisitos

- Node.js 20+
- Redis accesible desde `REDIS_URL`
- Firebase Admin SDK configurado con `GOOGLE_APPLICATION_CREDENTIALS`
- Credenciales de Cloudinary para fotos y modelos
- Una URL publica en `PUBLIC_BASE_URL` para recibir el webhook de Meshy

## Setup local

```bash
cp .env.example .env
# editar .env

npm install

# terminal 1: API
npm run dev

# terminal 2: worker
npm run worker

# terminal 3: redis
docker run --rm -p 6379:6379 redis
```

## Variables de entorno

```env
PORT=3000
NODE_ENV=development

MESHY_API_KEY=msy_xxxxxxxxxxxxxxxxxxxxxxx
MESHY_BASE_URL=https://api.meshy.ai/openapi/v1
MESHY_WEBHOOK_SECRET=genera_un_string_aleatorio_largo_aqui

FIREBASE_PROJECT_ID=tu-proyecto-firebase
FIREBASE_STORAGE_BUCKET=marketplace-e7d4e.firebasestorage.app
GOOGLE_APPLICATION_CREDENTIALS=../service-account.json

CLOUDINARY_CLOUD_NAME=tu_cloud_name
CLOUDINARY_API_KEY=tu_api_key
CLOUDINARY_API_SECRET=tu_api_secret

REDIS_URL=redis://localhost:6379
PUBLIC_BASE_URL=https://tu-api.run.app

MAX_CREDITS_PER_MONTH=200
```

## Endpoints

| Metodo | Ruta | Descripcion |
|---|---|---|
| POST | `/api/v1/products/create` | Sube fotos, crea producto y encola la generacion |
| GET | `/api/v1/products/:id/status` | Devuelve el estado del modelo 3D |
| GET | `/api/v1/admin/usage` | Devuelve uso mensual de creditos |
| POST | `/webhooks/meshy` | Recibe eventos firmados de Meshy |
| GET | `/health` | Healthcheck |

## Auth y notificaciones

- `POST /api/v1/products/create` y `GET /api/v1/admin/usage` requieren `Authorization: Bearer <firebase-id-token>`.
- El seller real sale del token (`req.user.uid`), no del body.
- Las notificaciones FCM usan `users/{sellerId}.fcmTokens`.
- `GET /api/v1/admin/usage` espera `req.user.admin === true`.

## Creditos

- Se reservan antes de llamar a Meshy.
- Si Meshy falla antes de aceptar la tarea, los creditos se reembolsan.
- Si no hay cupo mensual, el producto queda en `model3d.status = failed` con `error = insufficient_credits`.

## Docker

El `Dockerfile` levanta el API por defecto. En `docker-compose.yml` del repo raiz se usa el mismo build para:

- `api`: `npm run start`
- `worker`: `npm run worker`

## Notas

- El worker usa webhooks de Meshy; no hace polling contra Meshy en bucle.
- Los archivos subidos a Cloudinary se guardan como `secure_url`.
- Si quieres correr esto en Docker, monta o inyecta el `service-account.json`; no viene incluido en el repo.

# Contexto del proyecto Marketplace 3D + AR

## Qué estamos construyendo

Una app móvil tipo e-commerce (similar a Mercado Libre) con dos diferenciadores clave:

1. **Generación automática de modelos 3D** — cuando un vendedor publica un producto subiendo 2-4 fotos, un backend procesa esas fotos con la API de Meshy AI y genera automáticamente un modelo 3D (`.glb` para Android/web, `.usdz` para iOS).

2. **Visualización en realidad aumentada** — el comprador puede ver el producto proyectado en su espacio real (su sala, su cocina) usando la cámara del celular, con Google Scene Viewer en Android y AR Quick Look en iOS.

## Stack técnico elegido

- **Frontend móvil:** Flutter (Dart) con Material 3
- **Backend:** Node.js 20+ con Express, BullMQ para colas, Redis
- **Base de datos:** Firestore (Firebase)
- **Storage de archivos:** Firebase Storage (fotos y modelos 3D)
- **Auth:** Firebase Auth (aún no integrado, hay un `sellerId` hardcodeado)
- **Generación 3D:** Meshy AI (plan gratuito con 200 créditos/mes, endpoint multi-image-to-3d que cuesta ~10 créditos por modelo)
- **Visor 3D inline:** `model_viewer_plus` (WebView con `<model-viewer>` de Google)
- **AR:** deep links a Google Scene Viewer (Android) y AR Quick Look (iOS) — NO usamos `ar_flutter_plugin` por razones explicadas abajo

## Estructura del proyecto

El proyecto tiene DOS carpetas independientes:

### `meshy-worker/` (backend Node.js)

```
meshy-worker/
├── package.json                  deps: express, firebase-admin, axios, bullmq, ioredis, multer, zod, pino
├── .env.example                  variables a configurar
├── src/
│   ├── server.js                 entry point, monta rutas y middleware
│   ├── config/index.js           validación de env con zod
│   ├── routes/
│   │   ├── products.js           POST /api/v1/products/create, GET /api/v1/products/:id/status
│   │   └── webhooks.js           POST /webhooks/meshy con verificación HMAC
│   ├── services/
│   │   ├── meshy.js              cliente Meshy: createMultiImageTask, getTask, errores custom
│   │   ├── firebase.js           init Firebase Admin (Firestore + Storage)
│   │   ├── storage.js            uploadPhoto, downloadAndStoreModel
│   │   ├── queue.js              BullMQ + ioredis
│   │   └── credits.js            reserveCredits/refundCredits transaccional en Firestore
│   ├── workers/processor.js      consumer de cola, llama a Meshy, maneja retries
│   └── utils/logger.js           pino
```

### `marketplace_app/` (app Flutter)

```
marketplace_app/
├── pubspec.yaml                  deps: model_viewer_plus, url_launcher, device_info_plus,
│                                       cloud_firestore, firebase_core, image_picker, dio,
│                                       provider, permission_handler, intl, flutter_dotenv
├── .env.example
├── lib/
│   ├── main.dart                 init Firebase + dotenv, MultiProvider, RootShell con bottom nav
│   ├── theme/app_theme.dart      Material 3, color primary #3C3489 (purple)
│   ├── models/
│   │   ├── product.dart          ProductDraft (vendedor), ProductStatus, Model3DStatus enum,
│   │   │                         ProductCategory enum, UploadResult
│   │   └── product_listing.dart  ProductListing (catálogo), Model3D
│   ├── services/
│   │   ├── api_client.dart       Dio con FormData multipart, maneja progreso de upload
│   │   ├── photo_service.dart    image_picker con permission_handler
│   │   └── ar_service.dart       checkCapability + launchAR (Scene Viewer intent / Quick Look URL)
│   ├── providers/
│   │   └── seller_provider.dart  ChangeNotifier con polling cada 5s al backend
│   ├── widgets/
│   │   ├── photo_grid.dart       grid 4 slots con cámara/galería
│   │   ├── processing_steps.dart indicador de 3 pasos (upload, Meshy, publicado)
│   │   └── product_3d_viewer.dart ModelViewer inline + MediaCarousel + PhotoViewer
│   └── screens/
│       ├── catalog_screen.dart   StreamBuilder de Firestore con filtros
│       ├── product_detail_screen.dart detalle con 3D + botón "Ver en mi casa"
│       ├── sell_product_screen.dart  formulario del vendedor
│       └── processing_screen.dart    pantalla de progreso post-submit
├── android/app/src/main/AndroidManifest.xml  permisos cámara/fotos + queries AR
└── ios/Runner/Info.plist                      NSCameraUsageDescription y similares
```

## Flujo completo end-to-end

### Publicar (vendedor)

1. Usuario en tab "Vender" → toca "Empezar publicación" → abre `SellProductScreen`
2. Sube 2-4 fotos (cámara o galería), el `PhotoService` valida tamaño <10MB y comprime a 1600px/85%
3. Llena título, precio (con formato locale es_CO con puntos de miles), categoría, descripción opcional
4. `SellerProvider.submit()` manda `FormData` multipart a `POST /api/v1/products/create`
5. Backend guarda fotos en Firebase Storage, crea doc en Firestore con `status: 'queued'`, encola job BullMQ, responde 202 con productId
6. App navega a `ProcessingScreen`, empieza polling cada 5s a `GET /api/v1/products/:id/status`
7. Worker consume el job: `reserveCredits(10)` transaccional, llama a `POST /multi-image-to-3d` de Meshy con webhook URL, guarda `meshyTaskId` en Firestore con `status: 'processing'`
8. Meshy procesa 1-3 min, envía webhook a `POST /webhooks/meshy` con firma HMAC SHA256
9. Backend verifica firma, descarga `.glb` y `.usdz` de los URLs de Meshy, los guarda en Firebase Storage, actualiza Firestore con `status: 'ready'`, `glbUrl`, `usdzUrl`
10. El polling del vendedor detecta `ready`, muestra check verde, permite volver al home

### Comprar (comprador)

1. Usuario abre app → tab "Tienda" → `CatalogScreen` con StreamBuilder lee Firestore en tiempo real
2. Filtros: Todos / Con vista 3D / Muebles / Decoración / etc. El filtro "Con vista 3D" usa `.where('model3d.status', '==', 'ready')`
3. Productos con modelo 3D muestran badge "3D · AR" encima de la foto
4. Usuario toca un producto → `ProductDetailScreen`
5. `MediaCarousel` muestra primero el modelo 3D rotable (con `model_viewer_plus`) y luego las fotos originales
6. Usuario rota el modelo con el dedo, ve zoom, sombras, auto-rotate después de 3s de inactividad
7. Toca botón flotante "Ver en mi casa" → `ArService.launchAR()`
8. Servicio detecta plataforma:
   - **Android:** construye intent `intent://arvr.google.com/scene-viewer/1.0?file=URL.glb&mode=ar_preferred&title=...#Intent;scheme=https;package=com.google.android.googlequicksearchbox;...`
   - **iOS:** abre directamente la URL del `.usdz`, el sistema llama a Quick Look
9. El visor AR nativo del SO toma la cámara, detecta el piso, coloca el producto a escala real
10. Usuario vuelve a la app al cerrar el visor, decide si contacta al vendedor o compra

## Decisiones de arquitectura importantes

### Por qué NO usamos `ar_flutter_plugin`

Aparece en todos los tutoriales, pero tiene problemas serios:

- Requiere manejar manualmente detección de planos, anchors, gestos, iluminación, escalado
- Varios forks abandonados, mantenimiento inconsistente
- La experiencia AR es inferior a la nativa del SO
- Amazon, IKEA, Wayfair y Mercado Libre usan el enfoque de deep links nativos, no plugins custom

El trade-off es que el usuario sale momentáneamente de la app al visor nativo. Eso es aceptable a cambio de una experiencia AR de calidad profesional sin código propio que mantener.

### Por qué webhooks y no polling a Meshy

Meshy AI soporta webhooks con firma HMAC. Esto nos ahorra llamadas periódicas y hace el sistema más escalable. El flujo de polling existe solo entre el **app y nuestro backend** (cada 5s para actualizar UI), no entre backend y Meshy.

### Por qué BullMQ + Redis

Si el API se reinicia durante un deploy, los jobs pendientes no se pierden. Además, BullMQ da retries con backoff exponencial (3 intentos, 15s → 30s → 60s) automáticamente por si Meshy tiene rate limits temporales.

### Por qué reserva transaccional de créditos

Con 200 créditos gratis al mes, sin control podríamos agotarlos con múltiples vendedores simultáneos. La función `reserveCredits()` en `services/credits.js` hace una transacción de Firestore que decrementa el contador ANTES de llamar a Meshy. Si Meshy falla, `refundCredits()` lo devuelve. Si se acaban, el job falla con código `insufficient_credits` y la app puede mostrar "cupo mensual agotado".

## Esquema de Firestore

```
products/{productId}
  title: string
  description: string
  price: number
  category: string (slug: muebles, decoracion, electro, iluminacion, otros)
  sellerId: string
  sellerName?: string
  sellerRating?: number
  photos: string[]          URLs públicas de Firebase Storage
  status: 'draft' | 'published' | 'archived'
  model3d: {
    status: 'queued' | 'processing' | 'ready' | 'failed'
    meshyTaskId?: string
    glbUrl?: string
    usdzUrl?: string
    thumbnailUrl?: string
    progress?: number       0-100 durante processing
    creditsUsed?: number
    queuedAt, startedAt, completedAt, failedAt: timestamp
    error?: string          código: insufficient_credits, invalid_images, rate_limited, meshy_generation_failed
    errorDetail?: string
  }
  createdAt, updatedAt: timestamp

usage/{YYYY-MM}              contador mensual de créditos
  credits: number
  lastUpdate: timestamp
```

## Endpoints del backend

| Método | Ruta | Quién llama |
|--------|------|-------------|
| POST | `/api/v1/products/create` | App Flutter (vendedor) - multipart con fotos |
| GET | `/api/v1/products/:id/status` | App Flutter (polling post-upload) |
| GET | `/api/v1/admin/usage` | Admin - créditos del mes |
| POST | `/webhooks/meshy` | Meshy AI con firma HMAC |
| GET | `/health` | Healthcheck |

## Variables de entorno

### Backend (`meshy-worker/.env`)
```
PORT=3000
NODE_ENV=development
MESHY_API_KEY=msy_xxx              del dashboard de meshy.ai
MESHY_BASE_URL=https://api.meshy.ai/openapi/v1
MESHY_WEBHOOK_SECRET=xxx           generar con: openssl rand -hex 32
FIREBASE_PROJECT_ID=...
FIREBASE_STORAGE_BUCKET=...appspot.com
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
REDIS_URL=redis://localhost:6379
PUBLIC_BASE_URL=https://xxx.ngrok.io   debe ser accesible desde internet para los webhooks
MAX_CREDITS_PER_MONTH=200
```

### App (`marketplace_app/.env`)
```
API_BASE_URL=https://xxx.ngrok.io      misma URL que PUBLIC_BASE_URL del backend
API_TIMEOUT_SECONDS=30
```

## Estado actual del proyecto

**Completado y funcional:**
- Backend completo con validación, reserva de créditos, webhooks firmados, cola, worker
- App Flutter con flujo completo del vendedor (formulario + fotos + progreso)
- App Flutter con flujo completo del comprador (catálogo + detalle + visor 3D + lanzamiento AR)
- Manifiestos Android e iOS con permisos correctos (incluye READ_MEDIA_IMAGES para Android 13+)
- Bottom navigation con tabs Tienda / Vender / Perfil

**Pendiente (en orden de prioridad):**

1. **Reglas de seguridad de Firestore y Storage** — CRÍTICO antes de exponer la app. Sin esto cualquiera puede leer/borrar datos o subir archivos maliciosos. Necesitamos `firestore.rules` y `storage.rules` que valide que solo el vendedor pueda editar sus productos, que los archivos de productos sean solo lectura pública, que el tamaño de upload no exceda límites.

2. **Firebase Auth real** — reemplazar el `sellerId` hardcodeado `demo_seller_001` por un usuario autenticado. Recomendado: Google Sign-In + phone auth. El `sellerId` debe venir del token JWT verificado en el backend, no del body de la request.

3. **Dockerfile y deploy del backend** — Cloud Run o Railway con dos servicios: uno para el API Express (escalable por requests) y otro para el worker BullMQ (un solo replica, evita consumir créditos duplicados). Redis gratis en Upstash. Secrets en Secret Manager o env vars cifradas.

4. **Firestore indexes** — las queries del catálogo con múltiples `where` + `orderBy` necesitan índices compuestos. Firebase Console los sugiere automáticamente la primera vez que fallan.

5. **Push notifications con FCM** — avisar al vendedor cuando su modelo 3D quedó listo. Integra con el webhook de Meshy para disparar notificación al `sellerId`.

6. **Cache local de modelos 3D** — los `.glb` pesan 2-10MB, con `flutter_cache_manager` evitamos descargarlos cada vez que el comprador abre el mismo producto.

7. **Paginación del catálogo** — ahora trae 30 productos fijos, necesita infinite scroll con `startAfter()`.

8. **Chat comprador-vendedor** — nueva colección `chats/{chatId}/messages/{messageId}` con reglas de seguridad que solo los 2 participantes pueden leer/escribir.

9. **Checkout** — integración con Wompi o ePayco (Colombia) para pagos con tarjeta, PSE y Nequi.

10. **Analytics** — trackear qué productos se visualizan más en AR, tasa de conversión AR → compra.

## Instrucciones para Claude Code

Ahora que tienes todo este contexto, necesito que continúes el proyecto. Antes de escribir código:

1. **Explora la estructura actual** con `ls -R marketplace_app/lib` y `ls -R meshy-worker/src` para confirmar qué archivos existen
2. **Lee los archivos clave** relevantes a la tarea que te pida — no asumas contenido, siempre verifica
3. **Verifica versiones de paquetes** antes de sugerir cambios — algunos cambian rápido (Firebase, Meshy API)
4. **Respeta las decisiones arquitectónicas** listadas arriba, especialmente:
   - NO sugerir `ar_flutter_plugin` — usamos deep links nativos
   - NO eliminar la reserva transaccional de créditos
   - NO cambiar a polling directo a Meshy — usamos webhooks
   - Mantener la separación limpia: models / services / providers / widgets / screens

5. **Cuando integres algo nuevo**, asegúrate de que los errores se propaguen correctamente al usuario con mensajes claros en español (la app es para usuarios colombianos)

6. **Cuando toques Firestore**, considera las reglas de seguridad que faltan — todo código nuevo debe ser compatible con un esquema donde:
   - `products` se leen por cualquiera, se escriben solo por el `sellerId` owner
   - `usage` solo se lee/escribe desde el backend (Admin SDK bypasses rules)
   - Las fotos y modelos en Storage son lectura pública, escritura solo autenticada

7. **Testea mentalmente los edge cases** antes de entregar código:
   - ¿Qué pasa si Meshy devuelve 402 sin créditos?
   - ¿Qué pasa si el usuario pierde conexión durante el upload?
   - ¿Qué pasa si el dispositivo Android no tiene ARCore instalado?
   - ¿Qué pasa si el modelo 3D tarda más de 5 minutos?

## Tarea específica ahora

[AQUÍ ESCRIBE TU TAREA ESPECÍFICA, POR EJEMPLO:]

- "Crea las reglas de seguridad de Firestore y Storage"
- "Integra Firebase Auth con Google Sign-In"
- "Crea los Dockerfiles y el docker-compose para correr todo localmente"
- "Añade paginación con infinite scroll al catálogo"
- "Integra FCM para notificar al vendedor cuando el modelo esté listo"

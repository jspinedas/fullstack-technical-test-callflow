# Callflow

Gestión de llamadas entrantes con NestJS, React y contratos TypeScript compartidos. El webhook persiste en PostgreSQL y notifica mediante Redis Pub/Sub y SSE. La interfaz responsive permite consultar el historial paginado, ver recurrencia y grabaciones, y marcar una llamada como spam. `GET /api/health` verifica únicamente el proceso HTTP.

## Requisitos e instalación

Node.js 20.19+ o 22.12+, Corepack y Docker con Compose. Las imágenes usan Node 22.18.0. La versión de pnpm está fijada en `packageManager`; `corepack pnpm` permite ejecutarla sin instalación global.

```sh
corepack pnpm install
corepack pnpm prisma:generate
```

Copia `.env.example` a `.env` en la raíz. Los valores son de demostración local; reemplaza la contraseña cuando corresponda. No versiones `.env`.

## Desarrollo local

```sh
corepack pnpm infra:up
corepack pnpm db:migrate
corepack pnpm dev
```

Abre http://localhost:5173. La API responde en http://localhost:3000/api/health. Vite reenvía `/api` al puerto local de la API. También puedes ejecutar las aplicaciones por separado:

```sh
corepack pnpm --filter @callflow/contracts build
corepack pnpm --filter @callflow/api dev
corepack pnpm --filter @callflow/web dev
```

Los dos últimos comandos requieren terminales separadas. Ctrl+C detiene los procesos. `corepack pnpm infra:stop` detiene la infraestructura conservando sus datos.

## Docker completo

```sh
docker compose config --quiet
docker compose up --build -d
docker compose ps
docker compose logs --tail 50
```

Abre http://localhost:5173 y verifica http://localhost:5173/api/health. Nginx sirve React y reenvía `/api` a `api:3000` dentro de Docker. El navegador utiliza el mismo origen. Los builds generan Prisma Client y usan el lockfile sin montajes de código. La API aplica las migraciones pendientes antes de arrancar; si la migración falla, no inicia el servidor. `docker compose stop` detiene los servicios sin eliminar el volumen PostgreSQL.

También puedes aplicar migraciones explícitamente con `docker compose run --rm --no-deps api node apps/api/node_modules/prisma/build/index.js migrate deploy --schema apps/api/prisma/schema.prisma` cuando PostgreSQL ya esté disponible y la imagen API construida.

## Variables

| Variable                                                  | Uso y ejemplo                                                               |
| --------------------------------------------------------- | --------------------------------------------------------------------------- |
| `API_PORT`                                              | Puerto local y publicado de API: `3000`; internamente Docker usa `3000` |
| `WEB_PORT`                                              | Puerto local y publicado de web: `5173`                                   |
| `CORS_ORIGIN`                                           | Origen permitido: `http://localhost:5173`, sin barra final                |
| `VITE_API_BASE_URL`                                     | URL pública de API: `/api`; se incorpora al build web                    |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Configuración de PostgreSQL; contraseña obligatoria                       |
| `POSTGRES_PORT`                                         | Puerto publicado PostgreSQL: `5432`                                       |
| `REDIS_PORT`                                            | Puerto publicado Redis: `6379`                                            |
| `REDIS_URL` | Conexión local Redis: `redis://localhost:6379`; ajustar si cambia el puerto publicado |
| `REDIS_CHANNEL` | Canal compartido entre instancias API: `callflow.calls` |
| `TEST_REDIS_URL` | Redis real para integración; las pruebas utilizan un canal aislado por ejecución |
| `DATABASE_URL` | Conexión Prisma local: `postgresql://callflow:local_demo_change_me@localhost:5432/callflow?schema=public` |
| `TEST_DATABASE_URL` | Conexión para integración PostgreSQL; el runner crea un esquema aislado por ejecución |

Solo las variables `VITE_*` son públicas. Cambiar `WEB_PORT` requiere ajustar `CORS_ORIGIN` para consultar directamente la API. Los puertos se publican en `127.0.0.1`. Dentro de Docker, PostgreSQL se encuentra en `postgres:5432` y Redis en `redis:6379`; Compose fija ambas URLs internas independientemente de los puertos publicados. Cambiar credenciales no reconfigura un volumen PostgreSQL ya inicializado. Añade las variables nuevas a tu `.env` existente sin reemplazarlo.

Si tu `.env` ya existe, añade las dos URLs sin reemplazar el archivo. Con `POSTGRES_PORT=5433`, ambas URLs locales deben usar `localhost:5433`, mientras Docker mantiene `postgres:5432`. Codifica los caracteres reservados en las credenciales de las URLs locales. La URL interna de Compose interpola las credenciales de demostración; para credenciales con caracteres reservados, adapta esa URL con codificación porcentual antes de iniciar el stack.

## Persistencia y pruebas PostgreSQL

```sh
corepack pnpm prisma:generate
corepack pnpm db:migrate
corepack pnpm test:integration
```

`db:migrate` usa migraciones versionadas con `prisma migrate deploy`; no usa `db push` ni reinicializa datos. Las pruebas de integración exigen PostgreSQL y Redis reales, crean un esquema `callflow_test_<uuid>` y un canal Redis aislado, y aplican la migración existente. Se conserva ese esquema para inspección y no se eliminan datos ni volúmenes automáticamente. Usa una base de desarrollo o pruebas cuyo usuario pueda crear esquemas. `pnpm test` ejecuta las pruebas unitarias, HTTP y React sin requerir servicios externos.

El registro usa un bloqueo transaccional PostgreSQL por número internacional normalizado y una restricción única para `call_id`. La recurrencia se calcula con `EXISTS` sobre llamadas anteriores según `registration_order`, sin guardar un booleano ni hacer una consulta por cada resultado. El orden es consistente por número; una secuencia no garantiza el orden global de commit entre números diferentes. El listado usa páginas de 1 a 100 registros y orden descendente; las páginas pueden desplazarse si hay nuevas inserciones entre peticiones.

## Calidad y estructura

```sh
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

`apps/api/src/calls` separa dominio, aplicación, infraestructura y presentación; sus casos de uso se resuelven mediante providers NestJS. El controlador del webhook reutiliza el registro existente. `libphonenumber-js` normaliza y valida números con prefijo `+` explícito, sin país predeterminado; entradas nacionales ambiguas y extensiones se rechazan. `packages/contracts` expone payload y respuesta del webhook sin DTOs NestJS ni modelos Prisma. Swagger/OpenAPI es la documentación principal de los endpoints.

## Swagger / OpenAPI

Con la API iniciada, abre http://localhost:3000/api/docs. En Docker también está disponible mediante Nginx en http://localhost:5173/api/docs; el proxy de Vite permite la misma ruta durante desarrollo local. Los recursos de Swagger UI se sirven desde la API y no requieren un CDN.

El documento OpenAPI JSON está en http://localhost:3000/api/docs-json o http://localhost:5173/api/docs-json. Las rutas de la especificación ya incluyen `/api` y utilizan el mismo origen, de modo que Try it out funciona tanto con acceso directo como mediante proxy. Los ejemplos emplean datos ficticios; Try it out ejecuta operaciones reales y puede crear llamadas o marcarlas como spam.

Se documentan los cinco endpoints, DTOs, parámetros, límites, respuestas y errores actuales. El webhook admite `recordingUrl` omitido pero no `null`; el listado siempre incluye ese campo y puede devolver `null`. La documentación no añade autenticación: siguen pendientes la firma y el contrato del proveedor del webhook. No introduzcas credenciales reales en ejemplos ni publiques esta API como si estuviera autenticada.

Swagger UI no es un cliente SSE completo: la operación puede permanecer abierta sin mostrar cada frame. La descripción de `GET /api/calls/events` incluye los cuatro tipos de eventos y un ejemplo EventSource. Para observarlos desde la consola del navegador en el mismo origen:

```javascript
const events = new EventSource('/api/calls/events');
for (const type of ['call.created', 'call.updated', 'stream.status', 'heartbeat']) {
  events.addEventListener(type, event => console.log(type, JSON.parse(event.data)));
}
```

Ejecuta `events.close()` para finalizar. EventSource reconecta automáticamente, pero no hay replay; recupera el estado mediante `GET /api/calls` al conectar o reconectar. Las pruebas de `corepack pnpm test` verifican UI, recursos estáticos, JSON OpenAPI, rutas, parámetros, esquemas, referencias y ejemplos de respuesta. Las pruebas de navegador también comprueban Swagger UI sin ejecutar escrituras desde la documentación.

## Webhook de llamadas

`POST /api/webhooks/calls` requiere `Content-Type: application/json` y un objeto JSON de hasta 16 KiB, sin compresión. No convierte strings o booleanos a números ni acepta propiedades adicionales, incluidos campos internos como `id`, `createdAt`, `registrationOrder`, `isSpam` o `isRecurrent`.

| Campo | Regla |
| --- | --- |
| `callId` | String obligatorio no vacío, máximo 100 caracteres; clave de idempotencia |
| `phoneNumber` | String obligatorio con número internacional válido y prefijo `+` |
| `agent` | String obligatorio no vacío, máximo 150 caracteres |
| `duration` | Número entero entre 0 y 2147483647, en segundos |
| `recordingUrl` | URL HTTP/HTTPS opcional sin credenciales; omitir si no existe, no enviar `null` |

Ejemplo PowerShell para ejecución local o API publicada por Docker:

```powershell
$body = @{
  callId = "call-$([guid]::NewGuid())"
  phoneNumber = '+573001234567'
  agent = 'Agente 01'
  duration = 120
  recordingUrl = 'https://example.com/recordings/call.mp3'
} | ConvertTo-Json

Invoke-WebRequest -Uri 'http://localhost:3000/api/webhooks/calls' -Method Post -ContentType 'application/json' -Body $body | Select-Object StatusCode, Content
Invoke-WebRequest -Uri 'http://localhost:3000/api/webhooks/calls' -Method Post -ContentType 'application/json' -Body $body | Select-Object StatusCode, Content
```

La primera solicitud devuelve **201** con `{"callId":"…","inserted":true,"isRecurrent":false}`; el reintento devuelve **200** con `inserted:false`. `isRecurrent` será `true` si existe una llamada anterior del mismo número: corresponde al registro original y permanece estable aunque el reintento envíe otro número. Un duplicado válido conserva todos los datos originales, incluso si el payload es diferente. La unicidad y concurrencia siguen garantizadas en PostgreSQL. Solo una inserción nueva confirmada publica `call.created`.

| Estado | Motivo |
| --- | --- |
| `400` | JSON malformado, propiedades adicionales, DTO inválido o invariantes del dominio |
| `413` | Body superior a 16 KiB |
| `415` | Content-Type distinto de JSON o codificación no soportada |
| `500` | Fallo inesperado, sin detalles internos en la respuesta |
| `503` | Indisponibilidad de persistencia identificada mediante errores Prisma de conexión o timeout |

No se registran payloads completos y las respuestas de error no incluyen SQL, credenciales ni stack traces. La verificación de firma o autenticación del webhook queda pendiente de conocer el contrato del proveedor; esta fase no incorpora un mecanismo ficticio.

`corepack pnpm test` incluye validación HTTP y traducción de errores con dobles de aplicación. `corepack pnpm test:integration` mantiene las pruebas previas y añade E2E HTTP contra PostgreSQL real: respuestas 201/200, payloads distintos, números distintos, concurrencia, recurrencia y ausencia de escritura ante errores. La prueba de indisponibilidad utiliza un cliente Prisma aislado conectado a un puerto que rechaza conexiones de base de datos; no detiene PostgreSQL ni afecta al stack. Los esquemas de pruebas existentes se conservan.

## REST, SSE e interfaz

| Endpoint | Comportamiento |
| --- | --- |
| `GET /api/calls?page=1&pageSize=20` | Historial descendente por orden de registro, con `items`, `page`, `pageSize` y `total`; tamaño máximo 100 |
| `PATCH /api/calls/:id/spam` | UUID interno; devuelve `{id,isSpam:true,changed}`. Repetir devuelve `changed:false`; inexistente: 404, UUID inválido: 400 |
| `GET /api/calls/events` | SSE con `call.created`, `call.updated`, `stream.status` y heartbeat cada 15 segundos |

Las llamadas públicas incluyen identificadores, teléfono normalizado, agente, duración, URL nullable, `isSpam`, `isRecurrent` y `createdAt` ISO 8601. No exponen tipos Prisma ni el BIGINT interno. `call.updated` solo se publica cuando el marcado cambia efectivamente el estado; no afecta otras llamadas del mismo número.

La API utiliza una conexión Redis para publicar y otra para suscribirse por instancia, compartidas por todos los clientes SSE. Las notificaciones contienen únicamente tipo, UUID y `callId`. SSE agrupa ráfagas, mantiene un solo aviso pendiente por cliente y desconecta clientes con buffers de escritura excesivos. Nginx desactiva buffering y caché para `/api`, con timeout de lectura de una hora; los heartbeats mantienen activa la conexión.

React consulta REST al montar, al establecer o recuperar SSE y al recibir notificaciones; agrupa avisos cercanos y reconcilia por identificador. El estado `En vivo` requiere conexión con el canal Redis. Durante una desconexión utiliza recuperación REST cada 15 segundos, además del botón Actualizar; no hace consultas periódicas mientras el tiempo real funciona. EventSource reconecta automáticamente. La interfaz ofrece estados de carga, vacío y error, paginación y confirmación de spam, con diseño de tabla en escritorio y tarjetas en móvil.

PostgreSQL es la fuente de verdad. Redis Pub/Sub no es durable ni atómico con PostgreSQL: una caída o la terminación del proceso entre commit y publicación puede perder un aviso. No hay Outbox, replay ni garantía de entrega exactamente una vez. La publicación tiene timeout de un segundo, no acumula comandos fuera de línea y no revierte la llamada si Redis falla. Las conexiones se recuperan en segundo plano y la disponibilidad restaurada provoca reconciliación REST.

## Validación en navegador

Con el stack iniciado en una base de desarrollo:

```sh
corepack pnpm exec playwright install chromium
corepack pnpm test:e2e
```

Las pruebas Playwright usan `http://127.0.0.1:5173`; configura `E2E_BASE_URL` para otra dirección. En Windows puedes usar Edge instalado con `$env:PLAYWRIGHT_CHANNEL='msedge'` y ejecutar `corepack pnpm test:e2e`, sin descargar Chromium. Verifican webhook → Redis → SSE → React, actualización de spam entre sesiones, reconexión y diseño móvil. Conservan las llamadas sintéticas creadas, y guardan capturas en `test-results/` (excluido de Git).

Las pruebas de integración incluyen dos instancias NestJS, SSE HTTP y Redis real, cambios concurrentes de spam y fallos/reconexión TCP aislados sin detener los servicios existentes. La interfaz no incluye filtros avanzados, edición, eliminación ni estadísticas.

Si Docker no conecta con su motor, inicia Docker Desktop con contenedores Linux. Si un puerto está ocupado, ajusta `.env`. Ante un error web, verifica `/api/health` y usa Actualizar para recuperar el historial. Evita `docker compose down -v` para conservar datos.

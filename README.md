# Callflow

Base técnica de un flujo de llamadas entrantes con NestJS, React y contratos TypeScript compartidos. Esta fase incluye únicamente `GET /api/health` y una pantalla de conexión. La salud verifica el proceso HTTP; no comprueba PostgreSQL ni Redis.

## Requisitos e instalación

Node.js 20.19+ o 22.12+, Corepack y Docker con Compose. Las imágenes usan Node 22.18.0. La versión de pnpm está fijada en `packageManager`; `corepack pnpm` permite ejecutarla sin instalación global.

```sh
corepack pnpm install
```

Copia `.env.example` a `.env` en la raíz. Los valores son de demostración local; reemplaza la contraseña cuando corresponda. No versiones `.env`.

## Desarrollo local

```sh
corepack pnpm infra:up
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

Abre http://localhost:5173 y verifica http://localhost:5173/api/health. Nginx sirve React y reenvía `/api` a `api:3000` dentro de Docker. El navegador utiliza el mismo origen. Los builds usan el lockfile y no requieren montajes de código. `docker compose stop` detiene los servicios sin eliminar el volumen PostgreSQL.

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

Solo las variables `VITE_*` son públicas. Cambiar `WEB_PORT` requiere ajustar `CORS_ORIGIN` para consultar directamente la API. Los puertos se publican en `127.0.0.1`. Dentro de Docker, la infraestructura se encuentra en `postgres:5432` y `redis:6379`; esta fase no incorpora adaptadores que la consuman. Cambiar credenciales no reconfigura un volumen PostgreSQL ya inicializado.

## Calidad y estructura

```sh
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Las pruebas verifican el endpoint HTTP real, validaciones de arranque y estados de conexión de React. `apps/api` contiene NestJS; `apps/web` organiza la UI por `features`; `packages/contracts` exporta tipos públicos sin dependencias de frameworks. Los futuros módulos de negocio separarán dominio, aplicación, infraestructura y presentación. Swagger se incorporará con los endpoints funcionales en fases posteriores.

Si Docker no conecta con su motor, inicia Docker Desktop con contenedores Linux. Si un puerto está ocupado, ajusta `.env`. Ante un error de conexión web, verifica `/api/health`; la consulta tiene un límite de cinco segundos. Evita `docker compose down -v` para conservar datos.

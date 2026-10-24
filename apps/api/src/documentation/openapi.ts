import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HttpErrorDto } from './api-error';
import { CallEventDto, StreamStatusDto } from './response.dto';

export function setupOpenApi(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Callflow API')
    .setVersion('1.0.0')
    .setDescription('Registro idempotente de llamadas, historial, marcado individual de spam y notificaciones SSE. PostgreSQL es la fuente de verdad; Redis Pub/Sub no es durable ni atómico con PostgreSQL. La autenticación y la verificación de firma del webhook están pendientes de definir según el proveedor; no hay autenticación implementada. Swagger UI permite invocar operaciones reales que pueden crear llamadas o marcar spam. Para SSE utiliza EventSource: Swagger UI no es un cliente SSE completo.')
    .addServer('/')
    .addTag('Salud', 'Disponibilidad del proceso HTTP.')
    .addTag('Webhooks', 'Registro idempotente por callId.')
    .addTag('Llamadas', 'Consulta y marcado individual de spam.')
    .addTag('Tiempo real', 'Notificaciones no durables para reconciliar mediante REST.')
    .build();
  const document = SwaggerModule.createDocument(app, config, { autoTagControllers: false, extraModels: [HttpErrorDto, CallEventDto, StreamStatusDto] });
  const webhook = document.components?.schemas?.CallWebhookDto;
  if (webhook && !('$ref' in webhook)) webhook.additionalProperties = false;
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
    raw: ['json'],
    customSiteTitle: 'Callflow · API',
    swaggerOptions: { validatorUrl: null, displayRequestDuration: true },
  });
  return document;
}

import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject, ParameterObject, ReferenceObject, ResponseObject, SchemaObject } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app';
import { loadConfig } from '../src/config';
import { PrismaService } from '../src/calls/infrastructure/prisma.service';
import { CALL_EVENTS } from '../src/calls/application/call-events';
import { MemoryEventBus } from './event-bus.stub';

let app: INestApplication;
let base: string;
let document: OpenAPIObject;

before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService).useValue({})
    .overrideProvider(CALL_EVENTS).useValue(new MemoryEventBus()).compile();
  app = module.createNestApplication();
  configureApp(app, loadConfig({}));
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  const response = await fetch(`${base}/api/docs-json`);
  assert.equal(response.status, 200);
  document = await response.json() as OpenAPIObject;
});
after(async () => { await app?.close(); });

function schema(name: string): SchemaObject {
  const value = document.components?.schemas?.[name];
  assert.ok(value && !('$ref' in value), `Esquema ausente: ${name}`);
  return value;
}

function response(value: ResponseObject | ReferenceObject | undefined): ResponseObject {
  assert.ok(value && !('$ref' in value));
  return value;
}

test('Swagger UI y sus recursos están disponibles sin PostgreSQL ni Redis', async () => {
  const ui = await fetch(`${base}/api/docs`);
  assert.equal(ui.status, 200);
  assert.match(ui.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await ui.text(), /swagger-ui/);
  for (const file of ['swagger-ui.css', 'swagger-ui-bundle.js', 'swagger-ui-standalone-preset.js', 'swagger-ui-init.js']) {
    const asset = await fetch(`${base}/api/docs/${file}`);
    assert.equal(asset.status, 200, file);
  }
});

test('OpenAPI incluye exactamente los cinco endpoints y métodos reales sin duplicar el prefijo', () => {
  assert.match(document.openapi, /^3\.0\./);
  assert.equal(document.info.title, 'Callflow API');
  assert.equal(document.info.version, '1.0.0');
  assert.deepEqual(document.servers, [{ url: '/' }]);
  const methods = Object.fromEntries(Object.entries(document.paths).map(([path, item]) => [path, Object.keys(item)]));
  assert.deepEqual(methods, {
    '/api/health': ['get'], '/api/webhooks/calls': ['post'], '/api/calls': ['get'],
    '/api/calls/{id}/spam': ['patch'], '/api/calls/events': ['get'],
  });
  assert.deepEqual(document.components?.securitySchemes ?? {}, {});
  assert.equal(document.security, undefined);
  const operationIds = Object.values(document.paths).flatMap((item) => Object.values(item).map((operation: unknown) => {
    assert.ok(typeof operation === 'object' && operation !== null && 'operationId' in operation);
    return operation.operationId;
  }));
  assert.equal(new Set(operationIds).size, 5);
  assert.deepEqual(document.paths['/api/calls']!.get!.tags, ['Llamadas']);
  assert.deepEqual(document.paths['/api/calls/events']!.get!.tags, ['Tiempo real']);
});

test('request del webhook documenta obligatoriedad, límites, campos prohibidos y URL opcional no nullable', () => {
  const dto = schema('CallWebhookDto');
  assert.deepEqual(dto.required, ['callId', 'phoneNumber', 'agent', 'duration']);
  assert.equal(dto.additionalProperties, false);
  assert.deepEqual(Object.keys(dto.properties ?? {}), ['callId', 'phoneNumber', 'agent', 'duration', 'recordingUrl']);
  assert.equal((dto.properties?.callId as SchemaObject).maxLength, 100);
  assert.equal((dto.properties?.agent as SchemaObject).maxLength, 150);
  assert.equal((dto.properties?.duration as SchemaObject).type, 'integer');
  assert.equal((dto.properties?.duration as SchemaObject).minimum, 0);
  assert.equal((dto.properties?.duration as SchemaObject).maximum, 2147483647);
  assert.equal((dto.properties?.recordingUrl as SchemaObject).nullable, false);
  assert.equal((dto.properties?.recordingUrl as SchemaObject).format, 'uri');
  const body = document.paths['/api/webhooks/calls']!.post!.requestBody;
  assert.ok(body && !('$ref' in body));
  assert.equal(body.required, true);
  assert.deepEqual(Object.keys(body.content), ['application/json']);
  assert.deepEqual(body.content['application/json']?.schema, { $ref: '#/components/schemas/CallWebhookDto' });
  assert.equal(Object.keys(body.content['application/json']?.examples ?? {}).length, 2);
  assert.match(document.paths['/api/webhooks/calls']!.post!.description ?? '', /16 KiB/);
});

test('respuestas y parámetros conservan los contratos y estados de cada operación', () => {
  const webhook = document.paths['/api/webhooks/calls']!.post!;
  assert.deepEqual(Object.keys(webhook.responses).sort(), ['200', '201', '400', '413', '415', '500', '503']);
  assert.deepEqual(response(webhook.responses['201']).content?.['application/json']?.example, { callId: 'call-demo-001', inserted: true, isRecurrent: false });
  assert.deepEqual(response(webhook.responses['200']).content?.['application/json']?.example, { callId: 'call-demo-001', inserted: false, isRecurrent: false });
  const list = document.paths['/api/calls']!.get!;
  const parameters = list.parameters?.filter((parameter): parameter is ParameterObject => !('$ref' in parameter));
  const page = parameters?.find((parameter) => parameter.name === 'page');
  const pageSize = parameters?.find((parameter) => parameter.name === 'pageSize');
  assert.equal(page?.in, 'query'); assert.equal(page?.required, false);
  assert.equal((page?.schema as SchemaObject).default, 1);
  assert.equal((pageSize?.schema as SchemaObject).default, 20);
  assert.equal((pageSize?.schema as SchemaObject).maximum, 100);
  assert.deepEqual(response(list.responses['200']).content?.['application/json']?.schema, { $ref: '#/components/schemas/CallsPageDto' });
  const spam = document.paths['/api/calls/{id}/spam']!.patch!;
  const id = spam.parameters?.find((parameter) => !('$ref' in parameter) && parameter.name === 'id');
  assert.ok(id && !('$ref' in id)); assert.equal(id.in, 'path'); assert.equal(id.required, true);
  assert.equal((id.schema as SchemaObject).format, 'uuid');
  assert.equal(spam.requestBody, undefined);
  assert.deepEqual(Object.keys(spam.responses).sort(), ['200', '400', '404', '500', '503']);
  assert.deepEqual((schema('MarkSpamResponseDto').properties?.isSpam as SchemaObject).enum, [true]);
  const call = schema('CallSummaryDto');
  assert.equal((call.properties?.recordingUrl as SchemaObject).nullable, true);
  assert.ok(call.required?.includes('recordingUrl'));
  assert.equal((call.properties?.createdAt as SchemaObject).format, 'date-time');
});

test('SSE se representa como flujo de texto y documenta los cuatro tipos de frames reales', () => {
  const operation = document.paths['/api/calls/events']!.get!;
  const content = response(operation.responses['200']).content;
  assert.deepEqual(Object.keys(content ?? {}), ['text/event-stream']);
  assert.equal((content?.['text/event-stream']?.schema as SchemaObject).type, 'string');
  const example: unknown = content?.['text/event-stream']?.example;
  assert.equal(typeof example, 'string');
  for (const event of ['call.created', 'call.updated', 'stream.status', 'heartbeat']) assert.ok(String(example).includes(`event: ${event}`));
  assert.match(operation.description ?? '', /Swagger UI no es un cliente SSE completo/);
  assert.match(operation.description ?? '', /EventSource/);
  assert.deepEqual(schema('CallEventDto').required, ['type', 'id', 'callId']);
  assert.deepEqual(schema('StreamStatusDto').required, ['connected']);
});

test('los ejemplos documentados de salud y errores coinciden con las respuestas HTTP reales', async () => {
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.deepEqual(health, response(document.paths['/api/health']!.get!.responses['200']).content?.['application/json']?.example);
  for (const [path, init, status, key, operation] of [
    ['/api/calls?page=0', {}, '400', 'paginacion', document.paths['/api/calls']!.get!],
    ['/api/calls/not-uuid/spam', { method: 'PATCH' }, '400', 'uuid', document.paths['/api/calls/{id}/spam']!.patch!],
    ['/api/webhooks/calls', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' }, '415', 'formato', document.paths['/api/webhooks/calls']!.post!],
    ['/api/webhooks/calls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' }, '400', 'json', document.paths['/api/webhooks/calls']!.post!],
  ] as const) {
    const actual = await fetch(`${base}${path}`, init);
    assert.equal(actual.status, Number(status));
    const expected = response(operation.responses[status]).content?.['application/json']?.examples?.[key];
    assert.ok(expected && !('$ref' in expected));
    assert.deepEqual(await actual.json(), expected.value);
  }
});

test('todas las referencias locales resuelven y los esquemas públicos excluyen detalles de persistencia', () => {
  const walk = (value: unknown) => {
    if (typeof value !== 'object' || value === null) return;
    if ('$ref' in value) {
      assert.equal(typeof value.$ref, 'string');
      assert.ok(String(value.$ref).startsWith('#/components/schemas/'));
      assert.ok(document.components?.schemas?.[String(value.$ref).split('/').at(-1)!]);
    }
    if ('properties' in value && typeof value.properties === 'object' && value.properties !== null) {
      for (const key of ['registrationOrder', 'registration_order', 'call_id', 'phone_number', 'is_spam', 'created_at', 'password', 'DATABASE_URL']) {
        assert.equal(Object.hasOwn(value.properties, key), false, key);
      }
    }
    for (const child of Object.values(value)) walk(child);
  };
  walk(document);
  const publicCall = schema('CallSummaryDto');
  assert.deepEqual(Object.keys(publicCall.properties ?? {}).sort(), ['id', 'callId', 'phoneNumber', 'agent', 'duration', 'recordingUrl', 'isSpam', 'isRecurrent', 'createdAt'].sort());
});

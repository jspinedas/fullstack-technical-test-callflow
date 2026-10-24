import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import type { CallWebhookPayload, CallWebhookResponse } from '@callflow/contracts';
import { AppModule } from '../src/app.module';
import { configureApp, createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { PrismaService } from '../src/calls/infrastructure/prisma.service';

if (!process.env.CALLFLOW_TEST_SCHEMA?.startsWith('callflow_test_') ||
  new URL(process.env.DATABASE_URL ?? '').searchParams.get('schema') !== process.env.CALLFLOW_TEST_SCHEMA) {
  throw new Error('Ejecuta estas pruebas mediante test:integration en un esquema aislado');
}

const prisma = new PrismaClient();
let app: INestApplication;
let base: string;
const data = (phoneNumber: string): CallWebhookPayload => ({ callId: randomUUID(), phoneNumber, agent: 'Agente HTTP', duration: 120 });

before(async () => {
  app = await createApp(loadConfig({}));
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/api/webhooks/calls`;
});
after(async () => { await app?.close(); await prisma.$disconnect(); });

async function post(payload: unknown) {
  const response = await fetch(base, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const body = await response.json() as CallWebhookResponse;
  return { status: response.status, body };
}

test('HTTP 201/200 conserva la llamada original incluso con otro número o payload', async () => {
  const payload = data('+12025550100');
  const first = await post(payload);
  assert.equal(first.status, 201);
  assert.deepEqual(first.body, { callId: payload.callId, inserted: true, isRecurrent: false });
  const stored = await prisma.call.findUniqueOrThrow({ where: { callId: payload.callId } });
  assert.equal(stored.recordingUrl, null);
  for (const change of [{}, { agent: 'Cambió', duration: 999, recordingUrl: 'https://example.com/changed.mp3' }, { phoneNumber: '+12025550101' }]) {
    const duplicate = await post({ ...payload, ...change });
    assert.equal(duplicate.status, 200);
    assert.deepEqual(duplicate.body, { ...first.body, inserted: false });
    assert.deepEqual(await prisma.call.findUniqueOrThrow({ where: { callId: payload.callId } }), stored);
  }
  assert.equal(await prisma.call.count({ where: { callId: payload.callId } }), 1);
});

test('recurrencia HTTP corresponde a la llamada persistida y permanece estable en reintentos', async () => {
  const payload = data('+1 (202) 555-0105');
  const first = await post(payload);
  const secondPayload = { ...data('+12025550105'), recordingUrl: 'https://example.com/recording.mp3' };
  const second = await post(secondPayload);
  assert.equal(first.status, 201);
  assert.equal(first.body.isRecurrent, false);
  assert.equal(second.status, 201);
  assert.equal(second.body.isRecurrent, true);
  await post(data('+12025550105'));
  const firstRetry = await post({ ...payload, phoneNumber: '+12025550106' });
  const secondRetry = await post({ ...secondPayload, phoneNumber: '+12025550106' });
  assert.deepEqual(firstRetry, { status: 200, body: { ...first.body, inserted: false } });
  assert.deepEqual(secondRetry, { status: 200, body: { ...second.body, inserted: false } });
});

test('20 solicitudes HTTP duplicadas concurrentes producen un 201 y diecinueve 200', async () => {
  const payload = data('+12025550102');
  const results = await Promise.all(Array.from({ length: 20 }, () => post(payload)));
  assert.equal(results.filter((result) => result.status === 201).length, 1);
  assert.equal(results.filter((result) => result.status === 200).length, 19);
  for (const result of results) {
    assert.deepEqual(result.body, { callId: payload.callId, inserted: result.status === 201, isRecurrent: false });
  }
  assert.equal(await prisma.call.count({ where: { callId: payload.callId } }), 1);
});

test('concurrencia HTTP con el mismo callId y distintos números preserva exactamente al ganador', async () => {
  const payload = data('+12025550103');
  const inputs = Array.from({ length: 20 }, (_, index) => ({
    ...payload, phoneNumber: index % 2 ? '+12025550103' : '+12025550104', agent: `Agente ${index}`, duration: index,
  }));
  const results = await Promise.all(inputs.map(post));
  const winner = results.findIndex((result) => result.status === 201);
  assert.ok(winner >= 0);
  assert.equal(results.filter((result) => result.status === 201).length, 1);
  assert.equal(results.filter((result) => result.status === 200).length, 19);
  assert.ok(results.every((result) => result.body.callId === payload.callId && !result.body.isRecurrent));
  const stored = await prisma.call.findUniqueOrThrow({ where: { callId: payload.callId } });
  assert.equal(stored.phoneNumber, inputs[winner]!.phoneNumber);
  assert.equal(stored.agent, inputs[winner]!.agent);
  assert.equal(stored.duration, inputs[winner]!.duration);
  assert.equal(await prisma.call.count({ where: { callId: payload.callId } }), 1);
});

test('llamadas nuevas concurrentes del mismo teléfono responden con una sola primera llamada', async () => {
  const inputs = Array.from({ length: 12 }, () => data('+12025550107'));
  const results = await Promise.all(inputs.map(post));
  assert.ok(results.every((result) => result.status === 201));
  assert.equal(results.filter((result) => !result.body.isRecurrent).length, 1);
  const stored = await prisma.call.findMany({ where: { phoneNumber: '+12025550107' }, orderBy: { registrationOrder: 'asc' } });
  assert.equal(stored.length, 12);
  assert.equal(stored[0]!.callId, results.find((result) => !result.body.isRecurrent)!.body.callId);
});

test('payloads inválidos y teléfono inválido devuelven 400 sin crear filas', async () => {
  const beforeCount = await prisma.call.count();
  const payload = data('+12025550108');
  const missing = ['callId', 'phoneNumber', 'agent', 'duration'].map((key) => Object.fromEntries(Object.entries(payload).filter(([name]) => name !== key)));
  for (const value of [
    ...missing, { ...payload, duration: -1 }, { ...payload, duration: 1.5 }, { ...payload, duration: '120' },
    { ...payload, phoneNumber: '3001234567' }, { ...payload, phoneNumber: '+999123456789' },
    { ...payload, agent: ' ' }, { ...payload, callId: 'x\0y' }, { ...payload, recordingUrl: null },
    { ...payload, isSpam: true }, { ...payload, registrationOrder: '1' },
  ]) {
    assert.equal((await post(value)).status, 400, JSON.stringify(value));
  }
  const malformed = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid' });
  assert.equal(malformed.status, 400);
  assert.equal(await prisma.call.count(), beforeCount);
});

test('un cliente Prisma sin servidor PostgreSQL devuelve 503 de forma aislada y sin detalles', async () => {
  const rejectingServer = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => rejectingServer.listen(0, '127.0.0.1', resolve));
  const address = rejectingServer.address();
  if (!address || typeof address === 'string') throw new Error('Puerto de prueba no disponible');
  const url = new URL(process.env.DATABASE_URL!);
  url.hostname = '127.0.0.1';
  url.port = String(address.port);
  url.searchParams.set('connect_timeout', '1');
  const unavailablePrisma = new PrismaClient({ datasources: { db: { url: url.href } } });
  let isolatedApp: INestApplication | undefined;
  try {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(unavailablePrisma).compile();
    isolatedApp = module.createNestApplication();
    isolatedApp.useLogger(false);
    configureApp(isolatedApp, loadConfig({}));
    await isolatedApp.listen(0, '127.0.0.1');
    const response = await fetch(`${await isolatedApp.getUrl()}/api/webhooks/calls`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data('+12025550109')),
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { statusCode: 503, message: 'El servicio de persistencia no está disponible', error: 'Service Unavailable' });
    assert.equal((await fetch(`${await isolatedApp.getUrl()}/api/health`)).status, 200);
  } finally {
    await isolatedApp?.close();
    await unavailablePrisma.$disconnect();
    await new Promise<void>((resolve, reject) => rejectingServer.close((error) => error ? reject(error) : resolve()));
  }
});

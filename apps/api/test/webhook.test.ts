import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app';
import { loadConfig } from '../src/config';
import { PrismaService } from '../src/calls/infrastructure/prisma.service';
import { RegisterCallUseCase } from '../src/calls/application/register-call.use-case';
import { InvalidCallError } from '../src/calls/application/invalid-call.error';
import { prepareCall, type RegisterCallInput } from '../src/calls/domain/call';
import { CALL_EVENTS } from '../src/calls/application/call-events';
import { MemoryEventBus } from './event-bus.stub';

const payload = { callId: 'webhook-unit', phoneNumber: '+12025550100', agent: 'Agente', duration: 120 };
let app: INestApplication;
let base: string;
let failure: unknown;
let inserted = true;
let received: RegisterCallInput[] = [];

before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService).useValue({})
    .overrideProvider(CALL_EVENTS).useValue(new MemoryEventBus())
    .overrideProvider(RegisterCallUseCase).useValue({
      execute(input: RegisterCallInput) {
        received.push(input);
        if (failure) throw failure;
        return Promise.resolve({
          inserted, isRecurrent: false,
          call: { ...prepareCall(input), id: 'internal-id', isSpam: false, createdAt: new Date(), registrationOrder: 1n },
        });
      },
    }).compile();
  app = module.createNestApplication();
  app.useLogger(false);
  configureApp(app, loadConfig({}));
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/api/webhooks/calls`;
});

beforeEach(() => { failure = undefined; inserted = true; received = []; });
after(async () => { await app?.close(); });

function post(body: unknown, headers: Record<string, string> = { 'Content-Type': 'application/json' }) {
  return fetch(base, { method: 'POST', headers, body: JSON.stringify(body) });
}

test('controlador con doble de aplicación selecciona 201/200 y expone solo el contrato público', async () => {
  const first = await post(payload);
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { callId: payload.callId, inserted: true, isRecurrent: false });
  inserted = false;
  const duplicate = await post(payload);
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), { callId: payload.callId, inserted: false, isRecurrent: false });
  assert.equal(received.length, 2);
});

test('validación HTTP rechaza campos ausentes, tipos incorrectos, límites y propiedades adicionales', async () => {
  const missing = ['callId', 'phoneNumber', 'agent', 'duration'].map((key) => Object.fromEntries(Object.entries(payload).filter(([name]) => name !== key)));
  const invalid: unknown[] = [
    ...missing, {}, [], null, 'texto', 42,
    { ...payload, callId: '' }, { ...payload, callId: ' ' }, { ...payload, callId: 'x'.repeat(101) },
    { ...payload, agent: ' ' }, { ...payload, agent: 'x'.repeat(151) }, { ...payload, phoneNumber: '' },
    { ...payload, duration: -1 }, { ...payload, duration: 0.5 }, { ...payload, duration: '120' },
    { ...payload, duration: true }, { ...payload, duration: null }, { ...payload, duration: 2147483648 },
    { ...payload, callId: 123 }, { ...payload, agent: ['Agente'] }, { ...payload, phoneNumber: {} },
    { ...payload, recordingUrl: null }, { ...payload, recordingUrl: '' },
    { ...payload, recordingUrl: 'ftp://example.com/audio' }, { ...payload, recordingUrl: 'not-url' },
    { ...payload, recordingUrl: 'https://user:password@example.com/audio' },
    ...['id', 'createdAt', 'registrationOrder', 'isSpam', 'isRecurrent', 'extra'].map((key) => ({ ...payload, [key]: true })),
    ...['__proto__', 'constructor', 'prototype'].map((key) => Object.fromEntries([...Object.entries(payload), [key, { extra: true }]])),
  ];
  for (const body of invalid) {
    const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.equal(received.length, 0);
});

test('URL opcional admite ausencia y HTTP/HTTPS sin conversión implícita', async () => {
  assert.equal((await post({ ...payload, duration: 0 })).status, 201);
  for (const recordingUrl of ['https://example.com/audio.mp3', 'http://example.com/audio.mp3']) {
    assert.equal((await post({ ...payload, recordingUrl })).status, 201);
  }
  assert.equal(received.length, 3);
});

test('solo acepta JSON y rechaza JSON malformado sin reflejar contenido sensible', async () => {
  for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'application/xml']) {
    assert.equal((await post(payload, { 'Content-Type': type })).status, 415);
  }
  const noType = await fetch(base, { method: 'POST', body: new Uint8Array([123, 125]) });
  assert.equal(noType.status, 415);
  const malformed = await fetch(base, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"phoneNumber":"private-phone",bad',
  });
  assert.equal(malformed.status, 400);
  assert.ok(!(await malformed.text()).includes('private-phone'));
  const oversized = await post({ ...payload, recordingUrl: `https://example.com/${'x'.repeat(17000)}` });
  assert.equal(oversized.status, 413);
  assert.equal(received.length, 0);
});

test('traduce errores de dominio a 400 y fallos inesperados a 500 sin detalles internos', async () => {
  failure = new InvalidCallError('Número privado');
  const invalid = await post(payload);
  assert.equal(invalid.status, 400);
  failure = new Error('Prisma SQL password=secret stacktrace');
  const unexpected = await post(payload);
  assert.equal(unexpected.status, 500);
  assert.deepEqual(await unexpected.json(), { statusCode: 500, message: 'No se pudo registrar la llamada', error: 'Internal Server Error' });
});

test('errores Prisma identificables se traducen a 503 y otros permanecen en 500', async () => {
  for (const code of ['P1001', 'P1002', 'P1017', 'P2024']) {
    failure = new Prisma.PrismaClientKnownRequestError('Datos internos', { code, clientVersion: '6.19.3' });
    const response = await post(payload);
    assert.equal(response.status, 503, code);
    assert.deepEqual(await response.json(), { statusCode: 503, message: 'El servicio de persistencia no está disponible', error: 'Service Unavailable' });
  }
  failure = new Prisma.PrismaClientInitializationError('Credenciales privadas', '6.19.3', 'P1001');
  assert.equal((await post(payload)).status, 503);
  failure = new Prisma.PrismaClientKnownRequestError('Restricción interna', { code: 'P2002', clientVersion: '6.19.3' });
  assert.equal((await post(payload)).status, 500);
});

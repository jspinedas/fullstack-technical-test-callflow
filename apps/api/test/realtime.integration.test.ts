import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { after, before, test } from 'node:test';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import type { CallEvent, CallsPage, MarkSpamResponse } from '@callflow/contracts';
import { AppModule } from '../src/app.module';
import { createApp, configureApp } from '../src/app';
import { loadConfig } from '../src/config';
import { CALL_EVENTS } from '../src/calls/application/call-events';
import { RedisCallEvents } from '../src/calls/infrastructure/redis-call-events';

if (!process.env.CALLFLOW_TEST_SCHEMA?.startsWith('callflow_test_') ||
  new URL(process.env.DATABASE_URL ?? '').searchParams.get('schema') !== process.env.CALLFLOW_TEST_SCHEMA) {
  throw new Error('Ejecuta estas pruebas mediante test:integration en un esquema aislado');
}

const prisma = new PrismaClient();
const apps: INestApplication[] = [];
const messages: CallEvent[] = [];
let observer: Redis;
let base: string;
let secondBase: string;

async function until(predicate: () => boolean, timeout = 5000) {
  const end = Date.now() + timeout;
  while (!predicate() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(predicate(), 'No se cumplió la condición antes del timeout');
}

async function openStream(url: string) {
  const controller = new AbortController();
  const response = await fetch(`${url}/api/calls/events`, { signal: controller.signal });
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
  const frames: { type: string; data: Record<string, unknown> }[] = [];
  const reader = response.body!.getReader();
  const done = (async () => {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true }).replaceAll('\r\n', '\n');
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const lines = frame.split('\n');
          const data = lines.find((line) => line.startsWith('data:'))?.slice(5).trim();
          if (data) frames.push({ type: lines.find((line) => line.startsWith('event:'))?.slice(6).trim() ?? 'message', data: JSON.parse(data) as Record<string, unknown> });
        }
      }
    } catch (error: unknown) { if (!controller.signal.aborted) throw error; }
    finally { reader.releaseLock(); }
  })();
  return { frames, close: async () => { controller.abort(); await done; } };
}

before(async () => {
  observer = new Redis(process.env.REDIS_URL!, { lazyConnect: true, retryStrategy: () => null, maxRetriesPerRequest: 0 });
  await observer.connect();
  await observer.subscribe(process.env.REDIS_CHANNEL!);
  observer.on('message', (_channel: string, message: string) => messages.push(JSON.parse(message) as CallEvent));
  for (let index = 0; index < 2; index++) {
    const app = await createApp(loadConfig({}));
    apps.push(app); await app.listen(0, '127.0.0.1');
  }
  base = await apps[0]!.getUrl(); secondBase = await apps[1]!.getUrl();
});
after(async () => { await Promise.all(apps.map((app) => app.close())); observer?.disconnect(); await prisma.$disconnect(); });

const payload = (phoneNumber = '+12025550160') => ({ callId: randomUUID(), phoneNumber, agent: 'Agente tiempo real', duration: 60 });
const webhook = (input: ReturnType<typeof payload>, url = base) => fetch(`${url}/api/webhooks/calls`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });

test('PostgreSQL → Redis real → SSE en dos instancias, sin eventos por duplicados', async () => {
  const one = await openStream(base); const two = await openStream(secondBase);
  try {
    await until(() => one.frames.some((frame) => frame.type === 'stream.status' && frame.data.connected === true) && two.frames.some((frame) => frame.type === 'stream.status' && frame.data.connected === true));
    const input = payload();
    assert.equal((await webhook(input)).status, 201);
    await until(() => one.frames.some((frame) => frame.type === 'call.created' && frame.data.callId === input.callId) && two.frames.some((frame) => frame.type === 'call.created' && frame.data.callId === input.callId));
    const stored = await prisma.call.findUniqueOrThrow({ where: { callId: input.callId } });
    const published = messages.filter((event) => event.callId === input.callId);
    assert.deepEqual(published, [{ type: 'call.created', id: stored.id, callId: input.callId }]);
    assert.equal((await webhook({ ...input, phoneNumber: '+12025550161' })).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(messages.filter((event) => event.callId === input.callId).length, 1);
    const response = await fetch(`${base}/api/calls?pageSize=1`);
    const list = await response.json() as CallsPage;
    assert.equal(list.items[0]?.id, stored.id);
    assert.equal(list.items[0]?.isRecurrent, false);
    assert.equal(list.items[0]?.createdAt, stored.createdAt.toISOString());
    assert.equal((await fetch(`${base}/api/calls?pageSize=101`)).status, 400);
  } finally { await one.close(); await two.close(); }
});

test('spam concurrente publica una única actualización efectiva y respeta otras llamadas', async () => {
  const first = payload('+12025550162'); const second = payload('+12025550162');
  await webhook(first); await webhook(second);
  const stored = await prisma.call.findUniqueOrThrow({ where: { callId: second.callId } });
  const stream = await openStream(base);
  try {
    const responses = await Promise.all(Array.from({ length: 8 }, () => fetch(`${base}/api/calls/${stored.id}/spam`, { method: 'PATCH' })));
    const results = await Promise.all(responses.map((response) => response.json() as Promise<MarkSpamResponse>));
    assert.ok(responses.every((response) => response.status === 200));
    assert.equal(results.filter((result) => result.changed).length, 1);
    await until(() => stream.frames.some((frame) => frame.type === 'call.updated' && frame.data.id === stored.id));
    assert.equal(messages.filter((event) => event.type === 'call.updated' && event.id === stored.id).length, 1);
    assert.equal((await prisma.call.findUniqueOrThrow({ where: { callId: first.callId } })).isSpam, false);
    const list = await (await fetch(`${base}/api/calls?pageSize=2`)).json() as CallsPage;
    assert.equal(list.items[0]?.isSpam, true); assert.equal(list.items[0]?.isRecurrent, true);
    assert.equal(list.items[1]?.isRecurrent, false);
    assert.equal((await fetch(`${base}/api/calls/${randomUUID()}/spam`, { method: 'PATCH' })).status, 404);
    assert.equal((await fetch(`${base}/api/calls/not-uuid/spam`, { method: 'PATCH' })).status, 400);
  } finally { await stream.close(); }
});

test('Redis indisponible no pierde la inserción PostgreSQL ni bloquea indefinidamente el webhook', async () => {
  const rejecting = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => rejecting.listen(0, '127.0.0.1', resolve));
  const address = rejecting.address();
  if (!address || typeof address === 'string') throw new Error('Puerto no disponible');
  const relay = new RedisCallEvents(`redis://127.0.0.1:${address.port}`, process.env.REDIS_CHANNEL!);
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CALL_EVENTS).useValue(relay).compile();
  const isolated = module.createNestApplication(); isolated.useLogger(false); configureApp(isolated, loadConfig({}));
  try {
    await isolated.listen(0, '127.0.0.1');
    const input = payload('+12025550163');
    const started = Date.now();
    assert.equal((await webhook(input, await isolated.getUrl())).status, 201);
    assert.ok(Date.now() - started < 3000);
    const stored = await prisma.call.findUniqueOrThrow({ where: { callId: input.callId } });
    const list = await (await fetch(`${await isolated.getUrl()}/api/calls?pageSize=1`)).json() as CallsPage;
    assert.equal(list.items[0]?.id, stored.id);
  } finally {
    await isolated.close();
    await new Promise<void>((resolve, reject) => rejecting.close((error) => error ? reject(error) : resolve()));
  }
});

test('el adaptador recupera conexiones y suscripción después de una interrupción TCP aislada', async () => {
  const { createConnection } = await import('node:net');
  const target = new URL(process.env.REDIS_URL!);
  const sockets = new Set<import('node:net').Socket>();
  let available = true;
  const proxy = createServer((socket) => {
    if (!available) { socket.destroy(); return; }
    const upstream = createConnection({ host: target.hostname, port: Number(target.port || 6379) });
    sockets.add(socket); sockets.add(upstream);
    socket.pipe(upstream); upstream.pipe(socket);
    socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy());
    socket.on('close', () => { sockets.delete(socket); upstream.destroy(); }); upstream.on('close', () => { sockets.delete(upstream); socket.destroy(); });
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address(); if (!address || typeof address === 'string') throw new Error('Puerto no disponible');
  const relay = new RedisCallEvents(`redis://127.0.0.1:${address.port}`, `${process.env.REDIS_CHANNEL}_reconnect`);
  let connected = false; const received: CallEvent[] = [];
  const off = relay.onAvailability((value) => { connected = value; }); const stop = relay.subscribe((event) => received.push(event));
  relay.onModuleInit();
  try {
    await until(() => connected);
    available = false; for (const socket of sockets) socket.destroy();
    const started = Date.now();
    await relay.publish({ type: 'call.created', id: randomUUID(), callId: 'during-interruption' });
    assert.ok(Date.now() - started < 2000);
    await until(() => !connected);
    available = true;
    await until(() => connected);
    await relay.publish({ type: 'call.created', id: randomUUID(), callId: 'recovered' });
    await until(() => received.some((event) => event.callId === 'recovered'));
  } finally { off(); stop(); relay.onModuleDestroy(); for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve) => proxy.close(() => resolve())); }
});

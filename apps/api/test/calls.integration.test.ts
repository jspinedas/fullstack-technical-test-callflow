import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { PrismaCallRepository } from '../src/calls/infrastructure/prisma-call.repository';
import { RegisterCallUseCase } from '../src/calls/application/register-call.use-case';
import { ListCallsUseCase } from '../src/calls/application/list-calls.use-case';
import { MarkCallAsSpamUseCase } from '../src/calls/application/mark-call-as-spam.use-case';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';

if (!process.env.CALLFLOW_TEST_SCHEMA?.startsWith('callflow_test_') ||
  new URL(process.env.DATABASE_URL ?? '').searchParams.get('schema') !== process.env.CALLFLOW_TEST_SCHEMA) {
  throw new Error('Ejecuta estas pruebas mediante test:integration en un esquema aislado');
}

const prisma = new PrismaClient();
const repository = new PrismaCallRepository(prisma);
const register = new RegisterCallUseCase(repository);
const list = new ListCallsUseCase(repository);
const markSpam = new MarkCallAsSpamUseCase(repository);
const data = (phoneNumber = '+12025550123') => ({
  callId: randomUUID(), phoneNumber, agent: 'Agente integración', duration: 120,
  recordingUrl: 'https://example.com/audio.mp3',
});

before(async () => { await prisma.$connect(); });
after(async () => { await prisma.$disconnect(); });

test('PostgreSQL registra, recupera y conserva campos ante duplicados', async () => {
  const input = data();
  const first = await register.execute(input);
  assert.equal(first.inserted, true);
  assert.equal(first.isRecurrent, false);
  assert.equal(first.call.isSpam, false);
  assert.ok(first.call.createdAt instanceof Date);
  assert.equal(typeof first.call.registrationOrder, 'bigint');
  const duplicate = await register.execute({ ...input, duration: 999, phoneNumber: '+442079460018', agent: 'Cambió' });
  assert.equal(duplicate.inserted, false);
  assert.deepEqual(duplicate.call, first.call);
  assert.deepEqual(await repository.findById(first.call.id), { call: first.call, isRecurrent: false });
  assert.equal(await repository.findById(randomUUID()), null);
});

test('duplicados concurrentes con el mismo callId insertan exactamente una fila', async () => {
  const input = data('+34612345678');
  const results = await Promise.all(Array.from({ length: 20 }, () => register.execute(input)));
  assert.equal(results.filter((result) => result.inserted).length, 1);
  assert.equal(new Set(results.map((result) => result.call.id)).size, 1);
  assert.ok(results.every((result) => !result.isRecurrent));
  assert.equal(await prisma.call.count({ where: { callId: input.callId } }), 1);
});

test('duplicados concurrentes con números diferentes también respetan call_id único', async () => {
  const input = data('+14155552671');
  const results = await Promise.all(Array.from({ length: 12 }, (_, index) => register.execute({
    ...input, phoneNumber: index % 2 ? '+442079460018' : '+14155552671', agent: `Agente ${index}`,
  })));
  assert.equal(results.filter((result) => result.inserted).length, 1);
  for (const result of results) assert.deepEqual(result.call, results[0]?.call);
});

test('registros concurrentes del mismo número coordinan orden y recurrencia', async () => {
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => register.execute({
    ...data(index % 2 ? '+57 (300) 123-4567' : '+573001234567'),
  })));
  const ordered = [...results].sort((a, b) => a.call.registrationOrder < b.call.registrationOrder ? -1 : 1);
  assert.ok(results.every((result) => result.inserted));
  assert.equal(ordered[0]?.isRecurrent, false);
  assert.ok(ordered.slice(1).every((result) => result.isRecurrent));
  assert.equal(new Set(ordered.map((result) => result.call.registrationOrder)).size, 20);
  const page = await list.execute({ pageSize: 5 });
  assert.equal(page.items.length, 5);
  assert.ok(page.items.every((result) => result.isRecurrent));
  for (let index = 1; index < page.items.length; index++) {
    assert.ok(page.items[index - 1]!.call.registrationOrder > page.items[index]!.call.registrationOrder);
  }
  const secondPage = await list.execute({ page: 2, pageSize: 5 });
  assert.equal(secondPage.total, page.total);
  assert.ok(secondPage.items.every((item) => !page.items.some((other) => other.call.id === item.call.id)));
  assert.equal((await repository.findById(ordered[0]!.call.id))?.isRecurrent, false);
  assert.equal((await repository.findById(ordered[1]!.call.id))?.isRecurrent, true);
});

test('el bloqueo por número se mantiene hasta el commit y otros números avanzan', async () => {
  const phone = '+33142345678';
  let release: () => void = () => {};
  let locked: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { locked = resolve; });
  const holder = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${phone}, 0)) IS NULL AS locked`;
    await tx.call.create({ data: data(phone) });
    locked();
    await gate;
  }, { timeout: 10000 });
  let waiter: ReturnType<RegisterCallUseCase['execute']> | undefined;
  try {
    await ready;
    waiter = register.execute(data(phone));
    const unrelated = await register.execute(data('+4930123456'));
    assert.equal(unrelated.inserted, true);
    let waiting = false;
    for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
      const rows = await prisma.$queryRaw<{ waiting: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted) AS waiting`;
      waiting = rows[0]?.waiting === true;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(waiting, true);
    release();
    await holder;
    assert.equal((await waiter).isRecurrent, true);
  } finally {
    release();
    await holder;
    await waiter;
  }
});

test('spam modifica solo una llamada y conserva datos al repetirse', async () => {
  const first = await register.execute(data());
  const second = await register.execute(data());
  const marked = await markSpam.execute(first.call.id);
  assert.equal(marked.found, true);
  if (!marked.found) throw new Error('No se encontró la llamada');
  assert.deepEqual(marked.call, { ...first.call, isSpam: true });
  assert.deepEqual(await markSpam.execute(first.call.id), marked);
  assert.equal((await repository.findById(second.call.id))?.call.isSpam, false);
  assert.deepEqual(await markSpam.execute(randomUUID()), { found: false });
});

test('PostgreSQL aplica UNIQUE y CHECK incluso sin pasar por el dominio', async () => {
  const input = data();
  await prisma.call.create({ data: input });
  await assert.rejects(prisma.call.create({ data: input }), { code: 'P2002' });
  for (const change of [{ duration: -1 }, { callId: ' ' }, { agent: '' }, { phoneNumber: '3001234567' }, { callId: 'x'.repeat(101) }]) {
    await assert.rejects(prisma.call.create({ data: { ...data(), ...change } }));
  }
  await assert.rejects(prisma.$executeRaw`
    INSERT INTO calls (call_id, phone_number, agent, duration)
    VALUES (${randomUUID()}, ${'+12025550123'}, ${'Agente'}, NULL)`);
});

test('Nest resuelve los casos de uso con PostgreSQL real y no expone endpoints de negocio', async () => {
  const app = await createApp(loadConfig({}));
  try {
    await app.listen(0, '127.0.0.1');
    const useCase = app.get(RegisterCallUseCase);
    const result = await useCase.execute(data());
    assert.equal(result.inserted, true);
    assert.equal((await app.get(MarkCallAsSpamUseCase).execute(result.call.id)).found, true);
    assert.ok((await app.get(ListCallsUseCase).execute()).total > 0);
    const base = await app.getUrl();
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal((await fetch(`${base}/api/calls`)).status, 404);
  } finally {
    await app.close();
  }
});

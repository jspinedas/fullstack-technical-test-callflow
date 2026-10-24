import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app';
import { loadConfig } from '../src/config';
import { CALL_EVENTS } from '../src/calls/application/call-events';
import { CALL_REPOSITORY, type CallRepository, type RegisterCallResult } from '../src/calls/application/call.repository';
import { RegisterCallUseCase } from '../src/calls/application/register-call.use-case';
import { MarkCallAsSpamUseCase } from '../src/calls/application/mark-call-as-spam.use-case';
import { PrismaService } from '../src/calls/infrastructure/prisma.service';
import { prepareCall } from '../src/calls/domain/call';
import { MemoryEventBus } from './event-bus.stub';

const input = { callId: 'unit-event', phoneNumber: '+12025550100', agent: 'Agente', duration: 0 };
const call = { ...prepareCall(input), id: randomUUID(), isSpam: false, createdAt: new Date(), registrationOrder: 1n };

function stubRepository(overrides: Partial<CallRepository>): CallRepository {
  return {
    register: async () => { throw new Error('Registro no configurado'); },
    list: async (page) => ({ ...page, total: 0, items: [] }),
    findById: async () => null,
    markAsSpam: async () => ({ found: false }),
    ...overrides,
  };
}

test('publica solo después de resolver la persistencia nueva, nunca para duplicados o fallos', async () => {
  const bus = new MemoryEventBus();
  let release: (result: RegisterCallResult) => void = () => {};
  const repository = stubRepository({ register: () => new Promise<RegisterCallResult>((resolve) => { release = resolve; }) });
  const useCase = new RegisterCallUseCase(repository, bus);
  const pending = useCase.execute(input);
  assert.equal(bus.published.length, 0);
  release({ call, inserted: true, isRecurrent: false });
  await pending;
  assert.deepEqual(bus.published, [{ type: 'call.created', id: call.id, callId: call.callId }]);
  const duplicate = useCase.execute(input);
  release({ call, inserted: false, isRecurrent: false });
  await duplicate;
  assert.equal(bus.published.length, 1);
  repository.register = async () => { throw new Error('PostgreSQL'); };
  await assert.rejects(useCase.execute(input));
  assert.equal(bus.published.length, 1);
});

test('solo publica spam cuando el repositorio confirma un cambio efectivo', async () => {
  const bus = new MemoryEventBus();
  let changed = true;
  const repository = stubRepository({ markAsSpam: async () => ({ found: true, call: { ...call, isSpam: true }, changed }) });
  const useCase = new MarkCallAsSpamUseCase(repository, bus);
  await useCase.execute(call.id);
  changed = false;
  await useCase.execute(call.id);
  repository.markAsSpam = async () => ({ found: false });
  await useCase.execute(randomUUID());
  assert.deepEqual(bus.published, [{ type: 'call.updated', id: call.id, callId: call.callId }]);
});

test('SSE HTTP comparte el bus y limpia las suscripciones al desconectar clientes', async () => {
  const bus = new MemoryEventBus();
  const repository = {
    list: async ({ page, pageSize }: { page: number; pageSize: number }) => ({ page, pageSize, total: 1, items: [{ call, isRecurrent: false }] }),
    markAsSpam: async () => ({ found: false }),
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService).useValue({})
    .overrideProvider(CALL_EVENTS).useValue(bus)
    .overrideProvider(CALL_REPOSITORY).useValue(repository).compile();
  const app = module.createNestApplication();
  configureApp(app, loadConfig({}));
  const controller = new AbortController();
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const response = await fetch(`${base}/api/calls/events`, { signal: controller.signal });
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
    assert.equal(bus.listeners.size, 1);
    controller.abort();
    for (let attempt = 0; attempt < 100 && bus.listeners.size; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(bus.listeners.size, 0);
    assert.equal(bus.availability.size, 0);
    const list = await fetch(`${base}/api/calls?page=1&pageSize=10`);
    assert.equal(list.status, 200);
    const body = await list.json() as { items: { createdAt: string; registrationOrder?: unknown }[] };
    assert.equal(body.items[0]?.createdAt, call.createdAt.toISOString());
    assert.equal(body.items[0]?.registrationOrder, undefined);
    for (const query of ['page=0', 'page=-1', 'page=1.5', 'pageSize=101', 'page=1&page=2', 'extra=1']) {
      assert.equal((await fetch(`${base}/api/calls?${query}`)).status, 400);
    }
    assert.equal((await fetch(`${base}/api/calls/${randomUUID()}/spam`, { method: 'PATCH' })).status, 404);
    assert.equal((await fetch(`${base}/api/calls/no-uuid/spam`, { method: 'PATCH' })).status, 400);
  } finally { controller.abort(); await app.close(); }
});

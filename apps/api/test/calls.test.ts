import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { prepareCall, type Call, type NewCall, type RegisterCallInput } from '../src/calls/domain/call';
import { normalizePhoneNumber } from '../src/calls/domain/phone-number';
import type { CallRepository, CallWithRecurrence, PageRequest, MarkSpamResult } from '../src/calls/application/call.repository';
import { RegisterCallUseCase } from '../src/calls/application/register-call.use-case';
import { ListCallsUseCase } from '../src/calls/application/list-calls.use-case';
import { MarkCallAsSpamUseCase } from '../src/calls/application/mark-call-as-spam.use-case';
import { loadDatabaseUrl } from '../src/config';
import { InvalidCallError } from '../src/calls/application/invalid-call.error';

const input: RegisterCallInput = {
  callId: 'call-unit', phoneNumber: '+57 (300) 123-4567', agent: 'Agente 01', duration: 120,
};

class MemoryRepository implements CallRepository {
  readonly calls: Call[] = [];

  private result(call: Call): CallWithRecurrence {
    return { call, isRecurrent: this.calls.some((other) => other.phoneNumber === call.phoneNumber && other.registrationOrder < call.registrationOrder) };
  }

  async register(data: NewCall) {
    const existing = this.calls.find((call) => call.callId === data.callId);
    if (existing) return { ...this.result(existing), inserted: false };
    const call: Call = { ...data, id: randomUUID(), isSpam: false, createdAt: new Date(), registrationOrder: BigInt(this.calls.length + 1) };
    this.calls.push(call);
    return { ...this.result(call), inserted: true };
  }

  async list(page: PageRequest) {
    return { ...page, total: this.calls.length, items: [...this.calls].reverse()
      .slice((page.page - 1) * page.pageSize, page.page * page.pageSize).map((call) => this.result(call)) };
  }

  async findById(id: string) {
    const call = this.calls.find((call) => call.id === id);
    return call ? this.result(call) : null;
  }

  async markAsSpam(id: string): Promise<MarkSpamResult> {
    const index = this.calls.findIndex((call) => call.id === id);
    const existing = this.calls[index];
    if (!existing) return { found: false };
    const call = { ...existing, isSpam: true };
    this.calls[index] = call;
    return { found: true, call, changed: !existing.isSpam };
  }
}

test('normaliza teléfonos internacionales sin asumir un país', () => {
  assert.equal(normalizePhoneNumber(input.phoneNumber), '+573001234567');
  assert.equal(normalizePhoneNumber('+1 (202) 555-0123'), '+12025550123');
  assert.equal(normalizePhoneNumber('+44 20 7946 0018'), '+442079460018');
  assert.equal(normalizePhoneNumber('+34 612 34 56 78'), '+34612345678');
  for (const value of ['', '3001234567', '00573001234567', '+999123456789', '+123', '+1 202 555 0123 ext 9', 'texto +12025550123', '+12025550123/+442079460018']) {
    assert.throws(() => normalizePhoneNumber(value));
  }
});

test('protege invariantes y límites de persistencia antes de llamar al repositorio', () => {
  const invalid: Partial<RegisterCallInput>[] = [
    { callId: '' }, { callId: ' ' }, { callId: 'x'.repeat(101) }, { callId: 'x\0y' },
    { agent: '' }, { agent: ' '.repeat(3) }, { agent: 'x'.repeat(151) },
    { phoneNumber: '' }, { duration: -1 }, { duration: 1.5 }, { duration: NaN },
    { duration: Infinity }, { duration: 2147483648 },
    { recordingUrl: '' }, { recordingUrl: 'not-url' }, { recordingUrl: 'file:///audio' },
    { recordingUrl: 'https://user:pass@example.com/audio' },
  ];
  const repository = new MemoryRepository();
  const useCase = new RegisterCallUseCase(repository);
  for (const change of invalid) assert.throws(() => useCase.execute({ ...input, ...change }), InvalidCallError);
  assert.equal(repository.calls.length, 0);
  assert.equal(prepareCall({ ...input, duration: 0 }).duration, 0);
  assert.equal(prepareCall({ ...input, recordingUrl: null }).recordingUrl, null);
  assert.equal(prepareCall({ ...input, recordingUrl: 'https://example.com/audio.mp3' }).recordingUrl, 'https://example.com/audio.mp3');
});

test('registro no clasifica fallos de persistencia como errores de validación', async () => {
  const repository = new MemoryRepository();
  const failure = new Error('Fallo de persistencia');
  repository.register = async () => { throw failure; };
  await assert.rejects(new RegisterCallUseCase(repository).execute(input), (error: unknown) => error === failure);
});

test('registro distingue inserción de duplicado sin sobrescribir datos', async () => {
  const repository = new MemoryRepository();
  const useCase = new RegisterCallUseCase(repository);
  const first = await useCase.execute(input);
  const duplicate = await useCase.execute({ ...input, agent: 'Otro agente', duration: 999 });
  assert.equal(first.inserted, true);
  assert.equal(first.isRecurrent, false);
  assert.equal(duplicate.inserted, false);
  assert.deepEqual(duplicate.call, first.call);
  assert.equal(repository.calls.length, 1);
});

test('listado pagina en orden descendente y conserva recurrencia del historial', async () => {
  const repository = new MemoryRepository();
  const register = new RegisterCallUseCase(repository);
  const first = await register.execute(input);
  const second = await register.execute({ ...input, callId: 'call-unit-2', phoneNumber: '+573001234567' });
  assert.equal(second.isRecurrent, true);
  const list = new ListCallsUseCase(repository);
  const page = await list.execute({ page: 1, pageSize: 1 });
  assert.equal(page.total, 2);
  assert.equal(page.items[0]?.call.id, second.call.id);
  assert.equal(page.items[0]?.isRecurrent, true);
  assert.equal((await list.execute({ page: 2, pageSize: 1 })).items[0]?.call.id, first.call.id);
  for (const value of [{ page: 0 }, { page: 1.5 }, { pageSize: 0 }, { pageSize: 101 }, { page: Number.MAX_VALUE }]) {
    assert.throws(() => list.execute(value));
  }
});

test('spam es individual, idempotente y distingue registros inexistentes', async () => {
  const repository = new MemoryRepository();
  const register = new RegisterCallUseCase(repository);
  const first = await register.execute(input);
  const second = await register.execute({ ...input, callId: 'call-unit-2' });
  const mark = new MarkCallAsSpamUseCase(repository);
  const marked = await mark.execute(first.call.id);
  assert.equal(marked.found, true);
  assert.deepEqual(await mark.execute(first.call.id), { ...marked, changed: false });
  assert.equal((await repository.findById(second.call.id))?.call.isSpam, false);
  assert.deepEqual(await mark.execute(randomUUID()), { found: false });
  assert.throws(() => mark.execute('not-uuid'));
});

test('valida DATABASE_URL sin revelar sus credenciales', () => {
  for (const value of [undefined, '', 'https://example.com/db', 'postgresql://localhost']) {
    assert.throws(() => loadDatabaseUrl(value), /DATABASE_URL/);
  }
  assert.equal(loadDatabaseUrl('postgresql://localhost:5433/callflow'), 'postgresql://localhost:5433/callflow');
});

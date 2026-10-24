import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/calls/infrastructure/prisma.service';
import { configureApp } from '../src/app';
import { loadConfig } from '../src/config';
import { CALL_EVENTS } from '../src/calls/application/call-events';
import { MemoryEventBus } from './event-bus.stub';

test('GET /api/health devuelve el estado HTTP y aplica CORS', async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService).useValue({})
    .overrideProvider(CALL_EVENTS).useValue(new MemoryEventBus()).compile();
  const app = module.createNestApplication();
  configureApp(app, loadConfig({}));
  try {
    await app.listen(0, '127.0.0.1');
    const response = await fetch(`${await app.getUrl()}/api/health`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.deepEqual(await response.json(), { status: 'ok', service: 'callflow-api' });
  } finally {
    await app.close();
  }
});

test('rechaza configuración de arranque inválida', () => {
  for (const API_PORT of ['0', '65536', 'abc', '1.5']) {
    assert.throws(() => loadConfig({ API_PORT }));
  }
  assert.throws(() => loadConfig({ CORS_ORIGIN: 'https://example.com/path' }));
  assert.throws(() => loadConfig({ CORS_ORIGIN: 'ftp://example.com' }));
});

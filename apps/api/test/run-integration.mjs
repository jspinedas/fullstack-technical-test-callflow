import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Configura TEST_DATABASE_URL para ejecutar las pruebas PostgreSQL');
}
const url = new URL(process.env.TEST_DATABASE_URL);
const schema = `callflow_test_${randomUUID().replaceAll('-', '')}`;
url.searchParams.set('schema', schema);
const env = { ...process.env, DATABASE_URL: url.href, CALLFLOW_TEST_SCHEMA: schema };
console.log(`Pruebas PostgreSQL en esquema aislado: ${schema}`);
for (const args of [
  [fileURLToPath(import.meta.resolve('prisma/build/index.js')), 'migrate', 'deploy'],
  ['-r', 'ts-node/register', '--test', 'test/calls.integration.test.ts'],
]) {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}

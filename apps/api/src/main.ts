import { Logger } from '@nestjs/common';
import { createApp } from './app';
import { loadConfig } from './config';

async function bootstrap() {
  const config = loadConfig(process.env);
  const app = await createApp(config);
  try {
    await app.listen(config.port, '0.0.0.0');
  } catch (error: unknown) {
    await app.close();
    throw error;
  }
}

void bootstrap().catch((error: unknown) => {
  Logger.error(error instanceof Error ? error.message : 'Error de arranque', 'Bootstrap');
  process.exitCode = 1;
});

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from './config';

export async function createApp(config: ReturnType<typeof loadConfig>) {
  const app = await NestFactory.create(AppModule, { abortOnError: false });
  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.corsOrigin });
  app.enableShutdownHooks();
  return app;
}

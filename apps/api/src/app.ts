import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module';
import { loadConfig } from './config';

export async function createApp(config: ReturnType<typeof loadConfig>) {
  const app = await NestFactory.create(AppModule, { abortOnError: false });
  configureApp(app, config);
  return app;
}

export function configureApp(app: INestApplication, config: ReturnType<typeof loadConfig>) {
  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.corsOrigin });
  app.enableShutdownHooks();
}

import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { CallsModule } from './calls/calls.module';

@Module({ imports: [CallsModule], controllers: [HealthController] })
export class AppModule {}

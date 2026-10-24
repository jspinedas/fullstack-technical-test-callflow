import { Module } from '@nestjs/common';
import { loadDatabaseUrl } from '../config';
import { CALL_REPOSITORY, type CallRepository } from './application/call.repository';
import { RegisterCallUseCase } from './application/register-call.use-case';
import { ListCallsUseCase } from './application/list-calls.use-case';
import { MarkCallAsSpamUseCase } from './application/mark-call-as-spam.use-case';
import { PrismaCallRepository } from './infrastructure/prisma-call.repository';
import { PrismaService } from './infrastructure/prisma.service';
import { CallWebhookController } from './presentation/call-webhook.controller';
import { CallsController } from './presentation/calls.controller';
import { CALL_EVENTS, type CallEventBus } from './application/call-events';
import { RedisCallEvents } from './infrastructure/redis-call-events';

@Module({
  controllers: [CallWebhookController, CallsController],
  providers: [
    { provide: CALL_EVENTS, useFactory: () => new RedisCallEvents(process.env.REDIS_URL ?? `redis://127.0.0.1:${process.env.REDIS_PORT ?? 6379}`, process.env.REDIS_CHANNEL ?? 'callflow.calls') },
    { provide: PrismaService, useFactory: () => new PrismaService(loadDatabaseUrl(process.env.DATABASE_URL)) },
    { provide: CALL_REPOSITORY, useFactory: (prisma: PrismaService) => new PrismaCallRepository(prisma), inject: [PrismaService] },
    { provide: RegisterCallUseCase, useFactory: (repository: CallRepository, events: CallEventBus) => new RegisterCallUseCase(repository, events), inject: [CALL_REPOSITORY, CALL_EVENTS] },
    { provide: ListCallsUseCase, useFactory: (repository: CallRepository) => new ListCallsUseCase(repository), inject: [CALL_REPOSITORY] },
    { provide: MarkCallAsSpamUseCase, useFactory: (repository: CallRepository, events: CallEventBus) => new MarkCallAsSpamUseCase(repository, events), inject: [CALL_REPOSITORY, CALL_EVENTS] },
  ],
  exports: [RegisterCallUseCase, ListCallsUseCase, MarkCallAsSpamUseCase],
})
export class CallsModule {}

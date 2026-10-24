import { Module } from '@nestjs/common';
import { loadDatabaseUrl } from '../config';
import { CALL_REPOSITORY, type CallRepository } from './application/call.repository';
import { RegisterCallUseCase } from './application/register-call.use-case';
import { ListCallsUseCase } from './application/list-calls.use-case';
import { MarkCallAsSpamUseCase } from './application/mark-call-as-spam.use-case';
import { PrismaCallRepository } from './infrastructure/prisma-call.repository';
import { PrismaService } from './infrastructure/prisma.service';

@Module({
  providers: [
    { provide: PrismaService, useFactory: () => new PrismaService(loadDatabaseUrl(process.env.DATABASE_URL)) },
    { provide: CALL_REPOSITORY, useFactory: (prisma: PrismaService) => new PrismaCallRepository(prisma), inject: [PrismaService] },
    { provide: RegisterCallUseCase, useFactory: (repository: CallRepository) => new RegisterCallUseCase(repository), inject: [CALL_REPOSITORY] },
    { provide: ListCallsUseCase, useFactory: (repository: CallRepository) => new ListCallsUseCase(repository), inject: [CALL_REPOSITORY] },
    { provide: MarkCallAsSpamUseCase, useFactory: (repository: CallRepository) => new MarkCallAsSpamUseCase(repository), inject: [CALL_REPOSITORY] },
  ],
  exports: [RegisterCallUseCase, ListCallsUseCase, MarkCallAsSpamUseCase],
})
export class CallsModule {}

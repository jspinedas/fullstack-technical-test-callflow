import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(databaseUrl: string) {
    super({ datasources: { db: { url: databaseUrl } } });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

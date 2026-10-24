import { Prisma } from '@prisma/client';

export function isDatabaseUnavailable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return ['P1001', 'P1002', 'P1017'].includes(error.errorCode ?? '');
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(error.code)) return true;
    const sqlState = error.meta?.code;
    return error.code === 'P2010' && typeof sqlState === 'string' &&
      (sqlState.startsWith('08') || ['57P01', '57P02', '57P03'].includes(sqlState));
  }
  return false;
}

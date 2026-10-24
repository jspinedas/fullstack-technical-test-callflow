import { Prisma, type Call as CallRow, type PrismaClient } from '@prisma/client';
import type { Call, NewCall } from '../domain/call';
import type { CallRepository, CallWithRecurrence, PageRequest, RegisterCallResult, CallPage, MarkSpamResult } from '../application/call.repository';

type QueryRow = CallRow & { isRecurrent: boolean };

const projection = Prisma.sql`
  c.id, c.call_id AS "callId", c.phone_number AS "phoneNumber", c.agent,
  c.duration, c.recording_url AS "recordingUrl", c.is_spam AS "isSpam",
  c.created_at AS "createdAt", c.registration_order AS "registrationOrder",
  EXISTS (
    SELECT 1 FROM calls previous
    WHERE previous.phone_number = c.phone_number
      AND previous.registration_order < c.registration_order
  ) AS "isRecurrent"`;

function toCall(row: CallRow): Call {
  return {
    id: row.id, callId: row.callId, phoneNumber: row.phoneNumber,
    agent: row.agent, duration: row.duration, recordingUrl: row.recordingUrl,
    isSpam: row.isSpam, createdAt: row.createdAt, registrationOrder: row.registrationOrder,
  };
}

function toResult(row: QueryRow): CallWithRecurrence {
  return { call: toCall(row), isRecurrent: row.isRecurrent };
}

export class PrismaCallRepository implements CallRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async register(call: NewCall): Promise<RegisterCallResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${call.phoneNumber}, 0)) IS NULL AS locked`;
      const inserted = await tx.call.createMany({ data: [call], skipDuplicates: true });
      const rows = await tx.$queryRaw<QueryRow[]>`
        SELECT ${projection} FROM calls c WHERE c.call_id = ${call.callId}`;
      const row = rows[0];
      if (!row) throw new Error('No se encontró la llamada después del registro');
      return { ...toResult(row), inserted: inserted.count === 1 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 15000 });
  }

  async list(page: PageRequest): Promise<CallPage> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<QueryRow[]>`
        SELECT ${projection} FROM calls c ORDER BY c.registration_order DESC
        LIMIT ${page.pageSize} OFFSET ${(page.page - 1) * page.pageSize}`;
      const total = await tx.call.count();
      return { ...page, items: rows.map(toResult), total };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 15000 });
  }

  async findById(id: string): Promise<CallWithRecurrence | null> {
    const rows = await this.prisma.$queryRaw<QueryRow[]>`
      SELECT ${projection} FROM calls c WHERE c.id = CAST(${id} AS uuid)`;
    return rows[0] ? toResult(rows[0]) : null;
  }

  async markAsSpam(id: string): Promise<MarkSpamResult> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.call.updateMany({ where: { id, isSpam: false }, data: { isSpam: true } });
      const row = await tx.call.findUnique({ where: { id } });
      if (!row) return { found: false };
      return { found: true, call: toCall(row), changed: updated.count === 1 };
    }, { maxWait: 10000, timeout: 15000 });
  }
}

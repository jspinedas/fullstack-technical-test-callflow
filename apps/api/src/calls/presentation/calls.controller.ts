import { BadRequestException, Controller, Get, Header, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Query, Res, Sse, UseFilters, type MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Response } from 'express';
import type { CallsPage, MarkSpamResponse } from '@callflow/contracts';
import { CALL_EVENTS, type CallEventBus } from '../application/call-events';
import { ListCallsUseCase } from '../application/list-calls.use-case';
import { MarkCallAsSpamUseCase } from '../application/mark-call-as-spam.use-case';
import { WebhookExceptionFilter } from './webhook-exception.filter';

@Controller('calls')
@UseFilters(WebhookExceptionFilter)
export class CallsController {
  constructor(
    private readonly listCalls: ListCallsUseCase,
    private readonly markSpam: MarkCallAsSpamUseCase,
    @Inject(CALL_EVENTS) private readonly events: CallEventBus,
  ) {}

  @Get()
  async list(@Query() query: Record<string, unknown>): Promise<CallsPage> {
    if (Object.keys(query).some((key) => !['page', 'pageSize'].includes(key))) throw new BadRequestException('Paginación inválida');
    const parse = (value: unknown, fallback: number) => {
      if (value === undefined) return fallback;
      if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new BadRequestException('Paginación inválida');
      return Number(value);
    };
    const page = parse(query.page, 1);
    const pageSize = parse(query.pageSize, 20);
    if (!Number.isSafeInteger(page) || pageSize > 100 || !Number.isSafeInteger((page - 1) * pageSize)) throw new BadRequestException('Paginación inválida');
    const result = await this.listCalls.execute({ page, pageSize });
    return { ...result, items: result.items.map(({ call, isRecurrent }) => ({
      id: call.id, callId: call.callId, phoneNumber: call.phoneNumber, agent: call.agent,
      duration: call.duration, recordingUrl: call.recordingUrl, isSpam: call.isSpam,
      createdAt: call.createdAt.toISOString(), isRecurrent,
    })) };
  }

  @Patch(':id/spam')
  async spam(@Param('id', new ParseUUIDPipe()) id: string): Promise<MarkSpamResponse> {
    const result = await this.markSpam.execute(id);
    if (!result.found) throw new NotFoundException('La llamada no existe');
    return { id: result.call.id, isSpam: true, changed: result.changed };
  }

  @Sse('events')
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('X-Accel-Buffering', 'no')
  stream(@Res({ passthrough: true }) response: Response): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let pending: MessageEvent | undefined;
      let delivery: ReturnType<typeof setTimeout> | undefined;
      const unsubscribe = this.events.subscribe((event) => {
        pending = { type: event.type, data: event };
        delivery ??= setTimeout(() => { delivery = undefined; if (pending) subscriber.next(pending); pending = undefined; }, 100);
      });
      const unavailable = this.events.onAvailability((connected) => subscriber.next({ type: 'stream.status', data: { connected } }));
      let ticks = 0;
      const timer = setInterval(() => {
        if (response.writableNeedDrain || response.socket?.writableNeedDrain || response.writableLength > 65536 || (response.socket?.writableLength ?? 0) > 65536) {
          response.destroy();
          subscriber.complete();
        } else if (++ticks % 15 === 0) subscriber.next({ type: 'heartbeat', data: {} });
      }, 1000);
      return () => { clearInterval(timer); clearTimeout(delivery); unsubscribe(); unavailable(); };
    });
  }
}

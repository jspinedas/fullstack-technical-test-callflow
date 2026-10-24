import { BadRequestException, Controller, Get, Header, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Query, Res, Sse, UseFilters, type MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Response } from 'express';
import type { CallsPage, MarkSpamResponse } from '@callflow/contracts';
import { CALL_EVENTS, type CallEventBus } from '../application/call-events';
import { ListCallsUseCase } from '../application/list-calls.use-case';
import { MarkCallAsSpamUseCase } from '../application/mark-call-as-spam.use-case';
import { WebhookExceptionFilter } from './webhook-exception.filter';
import { ApiOkResponse, ApiOperation, ApiParam, ApiProduces, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CallsPageDto, MarkSpamResponseDto } from '../../documentation/response.dto';
import { ApiError } from '../../documentation/api-error';
import { sseDescription, sseExample } from '../../documentation/sse.openapi';

@Controller('calls')
@ApiProduces('application/json')
@UseFilters(WebhookExceptionFilter)
export class CallsController {
  constructor(
    private readonly listCalls: ListCallsUseCase,
    private readonly markSpam: MarkCallAsSpamUseCase,
    @Inject(CALL_EVENTS) private readonly events: CallEventBus,
  ) {}

  @Get()
  @ApiTags('Llamadas')
  @ApiOperation({ summary: 'Consultar el historial paginado', description: 'Orden descendente determinista por orden persistente de registro. La recurrencia se calcula desde llamadas anteriores del mismo número, sin consultas N+1. Las páginas pueden desplazarse si se insertan llamadas entre peticiones. Solo se admiten page y pageSize, una vez cada uno, como dígitos positivos sin signo, espacios, decimales ni ceros iniciales. page y (page - 1) × pageSize deben ser enteros seguros de JavaScript, como máximo 9007199254740991.' })
  @ApiQuery({ name: 'page', required: false, description: 'Página basada en uno.', schema: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER, default: 1 } })
  @ApiQuery({ name: 'pageSize', required: false, description: 'Cantidad de llamadas por página.', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } })
  @ApiOkResponse({ type: CallsPageDto, description: 'Página del historial persistido; una página sin resultados tiene items vacío.', example: { items: [{ id: '4fce7c53-c3af-4c77-a4dc-e690b54e5ba8', callId: 'call-demo-001', phoneNumber: '+12025550123', agent: 'Agente de demostración', duration: 120, recordingUrl: null, isSpam: false, isRecurrent: false, createdAt: '2026-10-24T12:00:00.000Z' }], page: 1, pageSize: 20, total: 1 } })
  @ApiError(400, 'Parámetros desconocidos o paginación inválida.', { paginacion: 'Paginación inválida' })
  @ApiError(500, 'Fallo inesperado. Se conserva el mensaje actual del filtro HTTP compartido.', { inesperado: 'No se pudo registrar la llamada' })
  @ApiError(503, 'Indisponibilidad identificada de persistencia.', { persistencia: 'El servicio de persistencia no está disponible' })
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
  @ApiTags('Llamadas')
  @ApiOperation({ summary: 'Marcar una llamada como spam', description: 'Utiliza el UUID de la llamada, no callId ni el teléfono. No requiere body. Solo modifica el registro seleccionado, sin afectar otras llamadas del mismo número. Es idempotente: un marcado repetido devuelve changed:false y no publica otro call.updated.' })
  @ApiParam({ name: 'id', required: true, format: 'uuid', example: '4fce7c53-c3af-4c77-a4dc-e690b54e5ba8', description: 'UUID interno de la llamada mostrado en el listado.' })
  @ApiOkResponse({ type: MarkSpamResponseDto, description: 'Estado confirmado de spam.', examples: { cambio: { summary: 'Primer marcado', value: { id: '4fce7c53-c3af-4c77-a4dc-e690b54e5ba8', isSpam: true, changed: true } }, repetido: { summary: 'Reintento idempotente', value: { id: '4fce7c53-c3af-4c77-a4dc-e690b54e5ba8', isSpam: true, changed: false } } } })
  @ApiError(400, 'El parámetro id no es un UUID válido.', { uuid: 'Validation failed (uuid is expected)' })
  @ApiError(404, 'No existe una llamada con ese UUID.', { inexistente: 'La llamada no existe' })
  @ApiError(500, 'Fallo inesperado. Se conserva el mensaje actual del filtro HTTP compartido.', { inesperado: 'No se pudo registrar la llamada' })
  @ApiError(503, 'Indisponibilidad identificada de persistencia.', { persistencia: 'El servicio de persistencia no está disponible' })
  async spam(@Param('id', new ParseUUIDPipe()) id: string): Promise<MarkSpamResponse> {
    const result = await this.markSpam.execute(id);
    if (!result.found) throw new NotFoundException('La llamada no existe');
    return { id: result.call.id, isSpam: true, changed: result.changed };
  }

  @Sse('events')
  @ApiTags('Tiempo real')
  @ApiProduces('text/event-stream')
  @ApiOperation({ summary: 'Escuchar notificaciones de llamadas mediante SSE', description: sseDescription })
  @ApiResponse({ status: 200, description: 'Flujo de frames SSE, no un objeto JSON ni una lista de eventos completa.', headers: { 'Cache-Control': { description: 'El flujo no debe almacenarse en caché.', schema: { type: 'string' } }, 'X-Accel-Buffering': { schema: { type: 'string', enum: ['no'] } } }, content: { 'text/event-stream': { schema: { type: 'string' }, example: sseExample } } })
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

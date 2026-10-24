import { BadRequestException, Body, Controller, Post, Res, UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
import type { Response } from 'express';
import type { CallWebhookResponse } from '@callflow/contracts';
import { RegisterCallUseCase } from '../application/register-call.use-case';
import { CallWebhookDto } from './call-webhook.dto';
import { WebhookExceptionFilter } from './webhook-exception.filter';
import { ApiBody, ApiConsumes, ApiCreatedResponse, ApiExtraModels, ApiOkResponse, ApiOperation, ApiProduces, ApiTags, getSchemaPath } from '@nestjs/swagger';
import { CallWebhookResponseDto } from '../../documentation/response.dto';
import { ApiError } from '../../documentation/api-error';

@Controller('webhooks/calls')
@ApiTags('Webhooks')
@ApiConsumes('application/json')
@ApiProduces('application/json')
@ApiExtraModels(CallWebhookDto)
@UseFilters(WebhookExceptionFilter)
@UsePipes(new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
  validationError: { target: false, value: false },
  exceptionFactory: () => new BadRequestException('El payload del webhook no es válido'),
}))
export class CallWebhookController {
  constructor(private readonly registerCall: RegisterCallUseCase) {}

  @Post()
  @ApiOperation({ summary: 'Registrar una llamada entrante de forma idempotente', description: 'Requiere un objeto JSON de hasta 16 KiB (16384 bytes), sin compresión. Rechaza propiedades adicionales, campos internos y conversiones implícitas. La clave de idempotencia es callId. Un duplicado válido conserva los datos originales aunque envíe otro número y no publica un evento adicional. Solo una inserción confirmada publica call.created. Si Redis falla, la persistencia se conserva y la respuesta sigue siendo exitosa; una notificación puede perderse. La firma y autenticación del proveedor todavía no están definidas.' })
  @ApiBody({ required: true, schema: { $ref: getSchemaPath(CallWebhookDto) }, examples: {
    completa: { summary: 'Llamada con grabación', value: { callId: 'call-demo-001', phoneNumber: '+1 (202) 555-0123', agent: 'Agente de demostración', duration: 120, recordingUrl: 'https://example.com/recordings/call-demo-001.mp3' } },
    sinGrabacion: { summary: 'Llamada sin grabación, también válida con duración cero', value: { callId: 'call-demo-002', phoneNumber: '+442079460018', agent: 'Agente de demostración', duration: 0 } },
  } })
  @ApiCreatedResponse({ type: CallWebhookResponseDto, description: 'Se insertó una llamada nueva y confirmó la transacción PostgreSQL.', example: { callId: 'call-demo-001', inserted: true, isRecurrent: false } })
  @ApiOkResponse({ type: CallWebhookResponseDto, description: 'callId ya existe; no se modifica la llamada ni se publica otro evento.', example: { callId: 'call-demo-001', inserted: false, isRecurrent: false } })
  @ApiError(400, 'Objeto JSON malformado, DTO inválido o invariantes del dominio incumplidas.', { validacion: 'El payload del webhook no es válido', dominio: 'Los datos de la llamada no son válidos', json: 'El body debe ser un objeto JSON válido' })
  @ApiError(413, 'Body superior a 16 KiB.', { limite: 'El body supera el límite de 16 KiB' })
  @ApiError(415, 'Content-Type distinto de application/json o codificación del body no soportada.', { formato: 'El webhook requiere application/json', codificacion: 'La codificación del body no está soportada' })
  @ApiError(500, 'Fallo inesperado; la respuesta no revela detalles internos.', { inesperado: 'No se pudo registrar la llamada' })
  @ApiError(503, 'Indisponibilidad de PostgreSQL identificada de forma fiable; una caída de Redis por sí sola no genera este estado.', { persistencia: 'El servicio de persistencia no está disponible' })
  async register(@Body() payload: CallWebhookDto, @Res({ passthrough: true }) response: Response): Promise<CallWebhookResponse> {
    const result = await this.registerCall.execute(payload);
    response.status(result.inserted ? 201 : 200);
    return { callId: result.call.callId, inserted: result.inserted, isRecurrent: result.isRecurrent };
  }
}

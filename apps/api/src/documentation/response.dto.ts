import { ApiProperty } from '@nestjs/swagger';
import type { CallEvent, CallsPage, CallSummary, CallWebhookResponse, HealthResponse, MarkSpamResponse, StreamStatus } from '@callflow/contracts';

export class HealthResponseDto implements HealthResponse {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status!: 'ok';

  @ApiProperty({ enum: ['callflow-api'], example: 'callflow-api' })
  service!: 'callflow-api';
}

export class CallWebhookResponseDto implements CallWebhookResponse {
  @ApiProperty({ example: 'call-demo-001', description: 'Identificador externo de la llamada persistida, normalizado por el dominio.' })
  callId!: string;

  @ApiProperty({ example: true, description: 'true solo si esta solicitud creó la llamada; false si callId ya existía.' })
  inserted!: boolean;

  @ApiProperty({ example: false, description: 'Existe una llamada anterior del mismo número según el orden persistente. Corresponde al registro original, incluso si el reintento cambia el número.' })
  isRecurrent!: boolean;
}

export class CallSummaryDto implements CallSummary {
  @ApiProperty({ format: 'uuid', example: '4fce7c53-c3af-4c77-a4dc-e690b54e5ba8', description: 'UUID de la llamada; utilizarlo en el marcado de spam.' })
  id!: string;

  @ApiProperty({ maxLength: 100, example: 'call-demo-001' })
  callId!: string;

  @ApiProperty({ pattern: '^\\+[1-9][0-9]{1,14}$', example: '+12025550123', description: 'Número internacional normalizado, sin país predeterminado.' })
  phoneNumber!: string;

  @ApiProperty({ maxLength: 150, example: 'Agente de demostración' })
  agent!: string;

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 2147483647, example: 120, description: 'Duración en segundos.' })
  duration!: number;

  @ApiProperty({ type: String, format: 'uri', nullable: true, example: null, description: 'Campo siempre presente: URL HTTP/HTTPS o null cuando no hay grabación.' })
  recordingUrl!: string | null;

  @ApiProperty({ example: false, description: 'Estado de spam de esta llamada, no de todo el número.' })
  isSpam!: boolean;

  @ApiProperty({ example: false, description: 'Calculado desde el historial del mismo número y el orden persistente; no es un booleano almacenado.' })
  isRecurrent!: boolean;

  @ApiProperty({ format: 'date-time', example: '2026-10-24T12:00:00.000Z', description: 'Fecha de registro en ISO 8601, UTC.' })
  createdAt!: string;
}

export class CallsPageDto implements CallsPage {
  @ApiProperty({ type: [CallSummaryDto], description: 'Orden descendente determinista por orden persistente de registro.' })
  items!: CallSummaryDto[];

  @ApiProperty({ type: 'integer', minimum: 1, example: 1 })
  page!: number;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100, example: 20 })
  pageSize!: number;

  @ApiProperty({ type: 'integer', minimum: 0, example: 1, description: 'Total de llamadas, no solo las de esta página.' })
  total!: number;
}

export class MarkSpamResponseDto implements MarkSpamResponse {
  @ApiProperty({ format: 'uuid', example: '4fce7c53-c3af-4c77-a4dc-e690b54e5ba8' })
  id!: string;

  @ApiProperty({ type: Boolean, enum: [true], example: true })
  isSpam!: true;

  @ApiProperty({ example: true, description: 'true si cambió de no spam a spam; false si ya estaba marcada. Solo un cambio efectivo publica call.updated.' })
  changed!: boolean;
}

export class CallEventDto implements CallEvent {
  @ApiProperty({ enum: ['call.created', 'call.updated'], example: 'call.created', description: 'Coincide con el nombre del evento SSE.' })
  type!: CallEvent['type'];

  @ApiProperty({ format: 'uuid', example: '4fce7c53-c3af-4c77-a4dc-e690b54e5ba8', description: 'UUID de la llamada; no es el id efímero del frame SSE.' })
  id!: string;

  @ApiProperty({ example: 'call-demo-001' })
  callId!: string;
}

export class StreamStatusDto implements StreamStatus {
  @ApiProperty({ example: true, description: 'Disponibilidad del canal Redis de la instancia, no una comprobación de PostgreSQL.' })
  connected!: boolean;
}

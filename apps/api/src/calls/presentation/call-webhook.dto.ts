import type { CallWebhookPayload } from '@callflow/contracts';
import { IsInt, IsNotEmpty, IsString, IsUrl, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CallWebhookDto implements CallWebhookPayload {
  @ApiProperty({ minLength: 1, maxLength: 100, pattern: '\\S', example: 'call-demo-001', description: 'Identificador externo de idempotencia. No puede ser vacío, contener solo espacios ni incluir NUL. El dominio elimina espacios de los extremos.' })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(100)
  callId!: string;

  @ApiProperty({ minLength: 1, pattern: '\\S', example: '+1 (202) 555-0123', description: 'Número internacional válido con prefijo + explícito. Puede contener separadores; el dominio normaliza y valida sin asumir un país. No admite extensiones.' })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  phoneNumber!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(150)
  @ApiProperty({ minLength: 1, maxLength: 150, pattern: '\\S', example: 'Agente de demostración', description: 'Agente obligatorio, sin valores vacíos, solo espacios o NUL. Se eliminan espacios de los extremos.' })
  agent!: string;

  @IsInt()
  @Min(0)
  @Max(2147483647)
  @ApiProperty({ type: 'integer', minimum: 0, maximum: 2147483647, example: 120, description: 'Segundos; no admite strings, booleanos, fracciones ni conversiones implícitas.' })
  duration!: number;

  @ValidateIf((_object: object, value: unknown) => value !== undefined)
  @ApiPropertyOptional({ type: String, format: 'uri', pattern: '^[Hh][Tt][Tt][Pp][Ss]?://', nullable: false, example: 'https://example.com/recordings/call-demo-001.mp3', description: 'URL HTTP/HTTPS sin credenciales. Omitir cuando no exista; null y string vacío son inválidos.' })
  @IsString()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false, disallow_auth: true })
  recordingUrl?: string;
}

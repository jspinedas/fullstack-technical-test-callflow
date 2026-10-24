import type { CallWebhookPayload } from '@callflow/contracts';
import { IsInt, IsNotEmpty, IsString, IsUrl, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class CallWebhookDto implements CallWebhookPayload {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(100)
  callId!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  phoneNumber!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(150)
  agent!: string;

  @IsInt()
  @Min(0)
  @Max(2147483647)
  duration!: number;

  @ValidateIf((_object: object, value: unknown) => value !== undefined)
  @IsString()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false, disallow_auth: true })
  recordingUrl?: string;
}

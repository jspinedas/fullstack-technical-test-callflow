import { BadRequestException, Body, Controller, Post, Res, UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
import type { Response } from 'express';
import type { CallWebhookResponse } from '@callflow/contracts';
import { RegisterCallUseCase } from '../application/register-call.use-case';
import { CallWebhookDto } from './call-webhook.dto';
import { WebhookExceptionFilter } from './webhook-exception.filter';

@Controller('webhooks/calls')
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
  async register(@Body() payload: CallWebhookDto, @Res({ passthrough: true }) response: Response): Promise<CallWebhookResponse> {
    const result = await this.registerCall.execute(payload);
    response.status(result.inserted ? 201 : 200);
    return { callId: result.call.callId, inserted: result.inserted, isRecurrent: result.isRecurrent };
  }
}

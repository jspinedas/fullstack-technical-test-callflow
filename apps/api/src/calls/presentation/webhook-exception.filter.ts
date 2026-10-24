import { BadRequestException, Catch, HttpException, InternalServerErrorException, Logger, ServiceUnavailableException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { InvalidCallError } from '../application/invalid-call.error';
import { isDatabaseUnavailable } from '../infrastructure/is-database-unavailable';

@Catch()
export class WebhookExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(WebhookExceptionFilter.name);

  catch(error: unknown, host: ArgumentsHost) {
    let exception: HttpException;
    if (error instanceof HttpException) {
      exception = error;
    } else if (error instanceof InvalidCallError) {
      exception = new BadRequestException('Los datos de la llamada no son válidos');
    } else if (isDatabaseUnavailable(error)) {
      this.logger.error('PostgreSQL no está disponible para registrar la llamada');
      exception = new ServiceUnavailableException('El servicio de persistencia no está disponible');
    } else {
      this.logger.error('Fallo inesperado al registrar la llamada');
      exception = new InternalServerErrorException('No se pudo registrar la llamada');
    }
    host.switchToHttp().getResponse<Response>().status(exception.getStatus()).json(exception.getResponse());
  }
}

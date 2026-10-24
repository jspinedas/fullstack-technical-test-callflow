import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@callflow/contracts';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthResponseDto } from '../documentation/response.dto';

@Controller('health')
@ApiTags('Salud')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Comprobar el proceso HTTP', description: 'No comprueba conectividad con PostgreSQL ni Redis y no garantiza su disponibilidad.' })
  @ApiOkResponse({ type: HealthResponseDto, description: 'El servidor HTTP está operativo.', example: { status: 'ok', service: 'callflow-api' } })
  getHealth(): HealthResponse {
    return { status: 'ok', service: 'callflow-api' };
  }
}

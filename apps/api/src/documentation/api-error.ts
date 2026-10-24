import { ApiProperty, ApiResponse, getSchemaPath } from '@nestjs/swagger';

export class HttpErrorDto {
  @ApiProperty({ type: 'integer', minimum: 400, maximum: 599, example: 400 })
  statusCode!: number;

  @ApiProperty({ example: 'El payload del webhook no es válido' })
  message!: string;

  @ApiProperty({ example: 'Bad Request' })
  error!: string;
}

const labels = { 400: 'Bad Request', 404: 'Not Found', 413: 'Payload Too Large', 415: 'Unsupported Media Type', 500: 'Internal Server Error', 503: 'Service Unavailable' } as const;

export function ApiError(status: keyof typeof labels, description: string, examples: Record<string, string>) {
  return ApiResponse({
    status,
    description,
    content: { 'application/json': {
      schema: { $ref: getSchemaPath(HttpErrorDto) },
      examples: Object.fromEntries(Object.entries(examples).map(([name, message]) => [name, { value: { statusCode: status, message, error: labels[status] } }])),
    } },
  });
}

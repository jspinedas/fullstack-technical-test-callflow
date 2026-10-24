import { json, type RequestHandler } from 'express';

const parseJson = json({ limit: '16kb', inflate: false, strict: true });

export const webhookBody: RequestHandler = (request, response, next) => {
  if (request.method !== 'POST') return next();
  if (!request.is('application/json')) {
    response.status(415).json({ statusCode: 415, message: 'El webhook requiere application/json', error: 'Unsupported Media Type' });
    return;
  }
  parseJson(request, response, (error: unknown) => {
    if (error) {
      const status = typeof error === 'object' && 'status' in error ? error.status : undefined;
      const statusCode = status === 413 ? 413 : status === 415 ? 415 : 400;
      response.status(statusCode).json({
        statusCode,
        message: statusCode === 413 ? 'El body supera el límite de 16 KiB' : statusCode === 415 ? 'La codificación del body no está soportada' : 'El body debe ser un objeto JSON válido',
        error: statusCode === 413 ? 'Payload Too Large' : statusCode === 415 ? 'Unsupported Media Type' : 'Bad Request',
      });
      return;
    }
    if (typeof request.body !== 'object' || request.body === null || Array.isArray(request.body)) {
      response.status(400).json({ statusCode: 400, message: 'El body debe ser un objeto JSON válido', error: 'Bad Request' });
      return;
    }
    if (['__proto__', 'constructor', 'prototype'].some((key) => Object.hasOwn(request.body, key))) {
      response.status(400).json({ statusCode: 400, message: 'El payload del webhook no es válido', error: 'Bad Request' });
      return;
    }
    next();
  });
};

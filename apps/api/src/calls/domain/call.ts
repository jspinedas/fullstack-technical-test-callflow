import { normalizePhoneNumber } from './phone-number';

export interface RegisterCallInput {
  readonly callId: string;
  readonly phoneNumber: string;
  readonly agent: string;
  readonly duration: number;
  readonly recordingUrl?: string | null;
}

export interface NewCall {
  readonly callId: string;
  readonly phoneNumber: string;
  readonly agent: string;
  readonly duration: number;
  readonly recordingUrl: string | null;
}

export interface Call extends NewCall {
  readonly id: string;
  readonly isSpam: boolean;
  readonly createdAt: Date;
  readonly registrationOrder: bigint;
}

function requiredText(value: string, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || [...value.trim()].length > max) {
    throw new Error(`${name} debe contener entre 1 y ${max} caracteres válidos`);
  }
  return value.trim();
}

export function prepareCall(input: RegisterCallInput): NewCall {
  const callId = requiredText(input.callId, 'callId', 100);
  const agent = requiredText(input.agent, 'agent', 150);
  const phoneNumber = normalizePhoneNumber(input.phoneNumber);
  if (!Number.isInteger(input.duration) || input.duration < 0 || input.duration > 2147483647) {
    throw new Error('La duración debe ser un entero entre 0 y 2147483647');
  }
  let recordingUrl: string | null = null;
  if (input.recordingUrl !== undefined && input.recordingUrl !== null) {
    if (typeof input.recordingUrl !== 'string' || input.recordingUrl.includes('\0')) {
      throw new Error('La URL de grabación no es válida');
    }
    const url = new URL(input.recordingUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('La URL de grabación debe usar HTTP o HTTPS sin credenciales');
    }
    recordingUrl = url.href;
  }
  return { callId, phoneNumber, agent, duration: input.duration, recordingUrl };
}

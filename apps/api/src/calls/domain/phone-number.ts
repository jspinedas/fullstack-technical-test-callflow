import { parsePhoneNumberWithError } from 'libphonenumber-js/max';

export function normalizePhoneNumber(input: string): string {
  if (typeof input !== 'string' || !/^\+[\d\s().-]+$/.test(input.trim())) {
    throw new Error('El teléfono debe incluir un prefijo internacional explícito');
  }
  try {
    const phone = parsePhoneNumberWithError(input.trim(), { extract: false });
    if (!phone.isValid()) throw new Error('Número inválido');
    return phone.number;
  } catch {
    throw new Error('El teléfono internacional no es válido');
  }
}

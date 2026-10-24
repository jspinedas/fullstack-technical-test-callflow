import { prepareCall, type NewCall, type RegisterCallInput } from '../domain/call';
import type { CallRepository } from './call.repository';
import { InvalidCallError } from './invalid-call.error';

export class RegisterCallUseCase {
  constructor(private readonly repository: CallRepository) {}

  execute(input: RegisterCallInput) {
    let call: NewCall;
    try {
      call = prepareCall(input);
    } catch (error: unknown) {
      throw new InvalidCallError('Los datos de la llamada no son válidos', { cause: error });
    }
    return this.repository.register(call);
  }
}

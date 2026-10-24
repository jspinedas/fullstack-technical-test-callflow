import { prepareCall, type NewCall, type RegisterCallInput } from '../domain/call';
import type { CallRepository } from './call.repository';
import { InvalidCallError } from './invalid-call.error';
import type { CallEventPublisher } from './call-events';

export class RegisterCallUseCase {
  constructor(private readonly repository: CallRepository, private readonly events?: CallEventPublisher) {}

  execute(input: RegisterCallInput) {
    let call: NewCall;
    try {
      call = prepareCall(input);
    } catch (error: unknown) {
      throw new InvalidCallError('Los datos de la llamada no son válidos', { cause: error });
    }
    return this.register(call);
  }

  private async register(call: NewCall) {
    const result = await this.repository.register(call);
    if (result.inserted) {
      await this.events?.publish({ type: 'call.created', id: result.call.id, callId: result.call.callId });
    }
    return result;
  }
}

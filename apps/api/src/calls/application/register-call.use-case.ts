import { prepareCall, type RegisterCallInput } from '../domain/call';
import type { CallRepository } from './call.repository';

export class RegisterCallUseCase {
  constructor(private readonly repository: CallRepository) {}

  execute(input: RegisterCallInput) {
    return this.repository.register(prepareCall(input));
  }
}

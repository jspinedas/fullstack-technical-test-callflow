import type { CallRepository } from './call.repository';

export class MarkCallAsSpamUseCase {
  constructor(private readonly repository: CallRepository) {}

  execute(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error('El identificador debe ser un UUID');
    }
    return this.repository.markAsSpam(id);
  }
}

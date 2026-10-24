import type { CallRepository } from './call.repository';
import type { CallEventPublisher } from './call-events';

export class MarkCallAsSpamUseCase {
  constructor(private readonly repository: CallRepository, private readonly events?: CallEventPublisher) {}

  execute(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error('El identificador debe ser un UUID');
    }
    return this.mark(id);
  }

  private async mark(id: string) {
    const result = await this.repository.markAsSpam(id);
    if (result.found && result.changed) {
      await this.events?.publish({ type: 'call.updated', id: result.call.id, callId: result.call.callId });
    }
    return result;
  }
}

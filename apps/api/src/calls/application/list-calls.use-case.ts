import type { CallRepository, PageRequest } from './call.repository';

export class ListCallsUseCase {
  constructor(private readonly repository: CallRepository) {}

  execute({ page = 1, pageSize = 20 }: Partial<PageRequest> = {}) {
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
      !Number.isSafeInteger((page - 1) * pageSize)) {
      throw new Error('Paginación inválida: page debe ser positivo y pageSize debe estar entre 1 y 100');
    }
    return this.repository.list({ page, pageSize });
  }
}

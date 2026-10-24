import type { Call, NewCall } from '../domain/call';

export const CALL_REPOSITORY = Symbol('CALL_REPOSITORY');

export interface CallWithRecurrence {
  readonly call: Call;
  readonly isRecurrent: boolean;
}

export interface RegisterCallResult extends CallWithRecurrence {
  readonly inserted: boolean;
}

export interface PageRequest {
  readonly page: number;
  readonly pageSize: number;
}

export interface CallPage extends PageRequest {
  readonly items: readonly CallWithRecurrence[];
  readonly total: number;
}

export type MarkSpamResult = { readonly found: false } | { readonly found: true; readonly call: Call; readonly changed: boolean };

export interface CallRepository {
  register(call: NewCall): Promise<RegisterCallResult>;
  list(page: PageRequest): Promise<CallPage>;
  findById(id: string): Promise<CallWithRecurrence | null>;
  markAsSpam(id: string): Promise<MarkSpamResult>;
}

import type { CallEvent } from '@callflow/contracts';

export const CALL_EVENTS = Symbol('CALL_EVENTS');

export interface CallEventPublisher {
  publish(event: CallEvent): Promise<void>;
}

export interface CallEventBus extends CallEventPublisher {
  subscribe(listener: (event: CallEvent) => void): () => void;
  onAvailability(listener: (connected: boolean) => void): () => void;
}

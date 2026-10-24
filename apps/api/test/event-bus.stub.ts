import type { CallEvent } from '@callflow/contracts';
import type { CallEventBus } from '../src/calls/application/call-events';

export class MemoryEventBus implements CallEventBus {
  readonly published: CallEvent[] = [];
  readonly listeners = new Set<(event: CallEvent) => void>();
  readonly availability = new Set<(connected: boolean) => void>();

  async publish(event: CallEvent) { this.published.push(event); for (const listener of this.listeners) listener(event); }
  subscribe(listener: (event: CallEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onAvailability(listener: (connected: boolean) => void) { this.availability.add(listener); listener(true); return () => { this.availability.delete(listener); }; }
}

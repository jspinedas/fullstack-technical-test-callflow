import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import type { CallEvent } from '@callflow/contracts';
import type { CallEventBus } from '../application/call-events';

export class RedisCallEvents implements CallEventBus, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisCallEvents.name);
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly listeners = new Set<(event: CallEvent) => void>();
  private readonly availability = new Set<(connected: boolean) => void>();
  private connected = false;
  private subscribed = false;

  constructor(url: string, private readonly channel: string) {
    const options = { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0, commandTimeout: 1000, connectTimeout: 1000, retryStrategy: (attempt: number) => Math.min(attempt * 200, 2000) };
    this.publisher = new Redis(url, options);
    this.subscriber = new Redis(url, options);
    this.publisher.on('error', () => this.reportUnavailable());
    this.publisher.on('ready', () => { if (this.subscribed) this.setConnected(true); });
    this.subscriber.on('error', () => this.reportUnavailable());
    this.subscriber.on('close', () => { this.subscribed = false; this.setConnected(false); });
    this.subscriber.on('ready', () => {
      void this.subscriber.subscribe(this.channel).then(() => {
        this.subscribed = true;
        this.setConnected(this.publisher.status === 'ready');
      }).catch(() => this.reportUnavailable());
    });
    this.subscriber.on('message', (_channel: string, message: string) => {
      try {
        const value: unknown = JSON.parse(message);
        if (typeof value !== 'object' || value === null || !('type' in value) ||
          !['call.created', 'call.updated'].includes(String(value.type)) ||
          !('id' in value) || typeof value.id !== 'string' || !('callId' in value) || typeof value.callId !== 'string') return;
        const event: CallEvent = { type: value.type as CallEvent['type'], id: value.id, callId: value.callId };
        for (const listener of this.listeners) listener(event);
      } catch {
        this.logger.warn('Notificación Redis inválida descartada');
      }
    });
  }

  onModuleInit() {
    void this.publisher.connect().catch(() => this.reportUnavailable());
    void this.subscriber.connect().catch(() => this.reportUnavailable());
  }

  async publish(event: CallEvent) {
    try {
      if (this.publisher.status !== 'ready') throw new Error('Redis no disponible');
      await this.publisher.publish(this.channel, JSON.stringify(event));
    } catch {
      this.logger.warn('Llamada persistida; no se pudo publicar la notificación Redis');
      this.reportUnavailable();
      if (this.publisher.status === 'ready') this.publisher.disconnect(true);
    }
  }

  subscribe(listener: (event: CallEvent) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  onAvailability(listener: (connected: boolean) => void) {
    this.availability.add(listener);
    listener(this.connected);
    return () => { this.availability.delete(listener); };
  }

  private setConnected(connected: boolean) {
    if (this.connected === connected) return;
    this.connected = connected;
    for (const listener of this.availability) listener(connected);
  }

  private reportUnavailable() {
    if (this.connected) this.logger.warn('Tiempo real no disponible; PostgreSQL conserva el estado');
    this.setConnected(false);
  }

  onModuleDestroy() {
    this.publisher.disconnect();
    this.subscriber.disconnect();
    this.listeners.clear();
    this.availability.clear();
  }
}

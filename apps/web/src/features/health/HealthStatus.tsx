import { useEffect, useState } from 'react';
import type { HealthResponse } from '@callflow/contracts';

type ConnectionState = 'loading' | 'connected' | 'error';

function isHealthy(value: unknown): value is HealthResponse {
  return typeof value === 'object' && value !== null &&
    'status' in value && value.status === 'ok' &&
    'service' in value && value.service === 'callflow-api';
}

export function HealthStatus() {
  const [state, setState] = useState<ConnectionState>('loading');
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let active = true;
    async function check() {
      try {
        const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
        const response = await fetch(`${baseUrl}/health`, { signal: controller.signal });
        const body: unknown = await response.json();
        if (!response.ok || !isHealthy(body)) throw new Error('Respuesta de salud inválida');
        if (active) setState('connected');
      } catch {
        if (active) setState('error');
      } finally {
        clearTimeout(timeout);
      }
    }
    void check();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, []);

  const messages: Record<ConnectionState, string> = {
    loading: 'Conectando con la API…',
    connected: 'API conectada',
    error: 'No se pudo conectar con la API. Verifica el servicio y recarga la página.',
  };
  return <p role="status" data-state={state}>{messages[state]}</p>;
}

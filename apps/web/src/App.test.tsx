import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { HealthStatus } from './features/health/HealthStatus';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('pantalla inicial', () => {
  it('muestra el estado de carga de salud', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<HealthStatus />);
    expect(screen.getByRole('status').textContent).toContain('Conectando');
  });

  it('consulta la API y muestra la conexión', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ok', service: 'callflow-api' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<HealthStatus />);
    expect(await screen.findByText('API conectada')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('muestra un error si la API no responde', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Sin conexión')));
    render(<HealthStatus />);
    expect(await screen.findByText(/No se pudo conectar/)).toBeTruthy();
  });

  it('rechaza respuestas con un contrato inválido', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) }));
    render(<HealthStatus />);
    expect(await screen.findByText(/No se pudo conectar/)).toBeTruthy();
  });
});

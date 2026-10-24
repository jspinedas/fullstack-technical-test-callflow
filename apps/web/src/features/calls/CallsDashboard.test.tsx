import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CallSummary } from '@callflow/contracts';
import { App } from '../../App';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly listeners = new Map<string, EventListener>();
  closed = false;
  constructor() { FakeEventSource.instances.push(this); }
  addEventListener(type: string, listener: EventListener) { this.listeners.set(type, listener); }
  close() { this.closed = true; }
  emit(type: string, data = {}) { this.listeners.get(type)?.(new MessageEvent(type, { data: JSON.stringify(data) })); }
}

const call: CallSummary = { id: 'test-id', callId: 'call-visible', phoneNumber: '+12025550100', agent: 'Agente 01', duration: 120, recordingUrl: 'https://example.com/audio.mp3', isSpam: false, isRecurrent: true, createdAt: '2026-10-24T05:00:00.000Z' };
let items: CallSummary[];
let total: number;
let failList: boolean;
let failSpam: boolean;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  items = [call]; total = 1; failList = false; failSpam = false; FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/health')) return { ok: true, json: async () => ({ status: 'ok', service: 'callflow-api' }) };
    if (init?.method === 'PATCH') {
      if (failSpam) return { ok: false };
      items = items.map((item) => ({ ...item, isSpam: true }));
      return { ok: true, json: async () => ({ id: call.id, isSpam: true, changed: true }) };
    }
    if (failList) return { ok: false };
    return { ok: true, json: async () => ({ items, page: 1, pageSize: 10, total }) };
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('historial de llamadas', () => {
  it('renderiza campos, recurrencia, enlaces y estado de conexión', async () => {
    render(<App />);
    expect(await screen.findByText(call.phoneNumber)).toBeTruthy();
    expect(screen.getByText('Agente 01')).toBeTruthy();
    expect(screen.getByText('2 min 00 s')).toBeTruthy();
    expect(screen.getByText('Recurrente')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Abrir enlace/ }).getAttribute('href')).toBe(call.recordingUrl);
    act(() => FakeEventSource.instances[0]!.emit('stream.status', { connected: true }));
    expect(screen.getByText('En vivo')).toBeTruthy();
  });

  it('muestra carga, estado vacío y errores con reintento', async () => {
    items = [];
    const view = render(<App />);
    expect(screen.getByText('Cargando llamadas…')).toBeTruthy();
    expect(await screen.findByText('Todo listo para tu próxima llamada')).toBeTruthy();
    failList = true;
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar historial' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    failList = false;
    items = [call];
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText(call.phoneNumber)).toBeTruthy();
    view.unmount();
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
  });

  it('confirma spam con el servidor y evita reenvíos mientras está pendiente', async () => {
    render(<App />);
    const button = await screen.findByRole('button', { name: /Marcar .* como spam/ });
    fireEvent.click(button); fireEvent.click(button);
    expect(await screen.findByText('Llamada marcada como spam.')).toBeTruthy();
    expect(screen.getByText('Spam')).toBeTruthy();
    expect(screen.getByText('✓ Spam marcado')).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
  });

  it('no marca spam cuando PATCH falla y permite volver a intentar', async () => {
    failSpam = true;
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Marcar .* como spam/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Spam')).toBeNull();
    expect((screen.getByRole('button', { name: /Marcar .* como spam/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('agrupa eventos, reconcilia por REST sin duplicados y recupera tras reconexión', async () => {
    render(<App />);
    await screen.findByText(call.phoneNumber);
    const source = FakeEventSource.instances[0]!;
    const before = fetchMock.mock.calls.length;
    items = [call, call];
    act(() => { for (let index = 0; index < 20; index++) source.emit('call.created'); });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(before + 1));
    expect(screen.getAllByText(call.phoneNumber)).toHaveLength(1);
    act(() => source.onerror?.());
    expect(screen.getByText('Reconectando')).toBeTruthy();
    items = [{ ...call, agent: 'Agente tras reconexión' }];
    act(() => { source.onopen?.(); source.emit('stream.status', { connected: true }); });
    expect(await screen.findByText('Agente tras reconexión')).toBeTruthy();
    expect(screen.getByText('En vivo')).toBeTruthy();
  });

  it('pagina mediante REST y cierra la conexión anterior', async () => {
    total = 11;
    render(<App />);
    await screen.findByText(call.phoneNumber);
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('page=2'))).toBe(true));
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
    expect(screen.getByText('Página 2 de 2')).toBeTruthy();
  });

  it('usa respaldo REST solo cuando el tiempo real está degradado', async () => {
    vi.useFakeTimers();
    render(<App />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const source = FakeEventSource.instances[0]!;
    act(() => source.emit('stream.status', { connected: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    const count = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(fetchMock.mock.calls.length).toBe(count);
    act(() => source.emit('stream.status', { connected: false }));
    await act(async () => { await vi.advanceTimersByTimeAsync(15200); });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(count);
  });
});

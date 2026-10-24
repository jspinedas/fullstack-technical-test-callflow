import { useCallback, useEffect, useRef, useState } from 'react';
import type { CallsPage } from '@callflow/contracts';
import { apiBase, listCalls, markSpam } from './api';

export type Connection = 'connecting' | 'live' | 'reconnecting' | 'degraded';

export function useCalls() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CallsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState<Connection>('connecting');
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [feedback, setFeedback] = useState('');
  const [feedbackError, setFeedbackError] = useState(false);
  const mounted = useRef(true);
  const busy = useRef(new Set<string>());
  const actions = useRef(new Set<AbortController>());
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let running = false;
    let dirty = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polling: ReturnType<typeof setInterval> | undefined;
    let controller: AbortController | undefined;
    let source: EventSource | undefined;
    setLoading(true);
    setError('');

    function reconcile() {
      dirty = true;
      timer ??= setTimeout(() => { timer = undefined; void load(); }, 180);
    }

    async function load() {
      if (disposed) return;
      if (running) { dirty = true; return; }
      running = true;
      dirty = false;
      controller = new AbortController();
      const deadline = setTimeout(() => controller?.abort(), 8000);
      try {
        const next = await listCalls(page, controller.signal);
        if (disposed) return;
        const lastPage = Math.max(1, Math.ceil(next.total / next.pageSize));
        if (page > lastPage) { setPage(lastPage); return; }
        setData({ ...next, items: [...new Map(next.items.map((call) => [call.id, call])).values()] });
        setError('');
      } catch {
        if (!disposed) setError('No se pudo cargar el historial');
      } finally {
        clearTimeout(deadline);
        running = false;
        if (!disposed) { setLoading(false); if (dirty) reconcile(); }
      }
    }

    function availability(live: boolean, state: Connection) {
      if (disposed) return;
      setConnection(state);
      if (live) { clearInterval(polling); polling = undefined; }
      else polling ??= setInterval(reconcile, 15000);
    }

    refreshRef.current = reconcile;
    availability(false, 'connecting');
    if (typeof EventSource !== 'undefined') {
      source = new EventSource(`${apiBase}/calls/events`);
      source.onopen = () => { availability(false, 'connecting'); reconcile(); };
      source.onerror = () => availability(false, 'reconnecting');
      source.addEventListener('stream.status', (event) => {
        try {
          const status: unknown = JSON.parse((event as MessageEvent<string>).data);
          const live = typeof status === 'object' && status !== null && 'connected' in status && status.connected === true;
          availability(live, live ? 'live' : 'degraded');
          reconcile();
        } catch { availability(false, 'degraded'); }
      });
      source.addEventListener('call.created', reconcile);
      source.addEventListener('call.updated', reconcile);
    } else availability(false, 'degraded');
    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(polling);
      controller?.abort();
      source?.close();
    };
  }, [page]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; for (const controller of actions.current) controller.abort(); };
  }, []);

  const flag = useCallback(async (id: string) => {
    if (busy.current.has(id)) return;
    busy.current.add(id);
    setPending(new Set(busy.current));
    setFeedback('');
    setFeedbackError(false);
    const controller = new AbortController();
    actions.current.add(controller);
    const deadline = setTimeout(() => controller.abort(), 8000);
    try {
      const result = await markSpam(id, controller.signal);
      if (controller.signal.aborted) return;
      if (result.id !== id || result.isSpam !== true) throw new Error('Respuesta de spam inválida');
      setData((current) => current ? { ...current, items: current.items.map((call) => call.id === id ? { ...call, isSpam: true } : call) } : current);
      setFeedback('Llamada marcada como spam.');
      refreshRef.current();
    } catch {
      if (mounted.current) { setFeedbackError(true); setFeedback('No se pudo confirmar el marcado. Actualiza el historial e inténtalo de nuevo.'); }
    } finally {
      clearTimeout(deadline);
      actions.current.delete(controller);
      busy.current.delete(id);
      if (mounted.current) setPending(new Set(busy.current));
    }
  }, []);

  return { page, setPage, data, loading, error, connection, pending, feedback, feedbackError, flag, refresh: () => refreshRef.current() };
}

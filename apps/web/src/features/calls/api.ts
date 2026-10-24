import type { CallsPage, MarkSpamResponse } from '@callflow/contracts';

export const apiBase = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, init);
  if (!response.ok) throw new Error('No se pudo completar la solicitud');
  return response.json() as Promise<T>;
}

export const listCalls = (page: number, signal: AbortSignal) => request<CallsPage>(`/calls?page=${page}&pageSize=10`, { signal });
export const markSpam = (id: string, signal: AbortSignal) => request<MarkSpamResponse>(`/calls/${encodeURIComponent(id)}/spam`, { method: 'PATCH', signal });

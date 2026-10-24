import { useCalls, type Connection } from './use-calls';
import { HealthStatus } from '../health/HealthStatus';

const connectionText: Record<Connection, string> = { connecting: 'Conectando', live: 'En vivo', reconnecting: 'Reconectando', degraded: 'Actualización de respaldo' };
const formatDate = (value: string) => new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const duration = (value: number) => `${Math.floor(value / 60)} min ${String(value % 60).padStart(2, '0')} s`;

export function CallsDashboard() {
  const calls = useCalls();
  const pageCount = Math.max(1, Math.ceil((calls.data?.total ?? 0) / 10));
  return <>
    <header className="topbar"><a className="brand" href="/" aria-label="Callflow, inicio"><span className="brand-mark" aria-hidden="true">↗</span>Callflow<span className="brand-divider" /><span className="workspace-name">Espacio de llamadas</span></a><span className="workspace-tag">OPERACIONES</span></header>
    <main className="dashboard">
      <div className="page-heading"><div><p className="eyebrow">CENTRO DE LLAMADAS</p><h1>Llamadas entrantes</h1><p className="subtitle">El contexto de cada conversación, en un solo lugar.</p></div><button className="refresh-button" aria-label="Actualizar historial" onClick={calls.refresh} disabled={calls.loading}><span aria-hidden="true">↻</span> Actualizar</button></div>
      <section className="calls-panel" aria-labelledby="history-title">
        <div className="panel-heading"><div><h2 id="history-title">Historial de llamadas</h2><p>{calls.data ? `${calls.data.total} llamadas registradas` : 'Consultando el historial'}</p></div><span className={`connection ${calls.connection}`} role="status" aria-label="Conexión en tiempo real"><span className="connection-dot" />{connectionText[calls.connection]}</span></div>
        {calls.feedback && <p className={`feedback ${calls.feedbackError ? 'feedback-error' : ''}`} role={calls.feedbackError ? 'alert' : 'status'}>{calls.feedback}</p>}
        {calls.error && <div className="notice error" role="alert"><strong>No pudimos actualizar el historial.</strong><span>Verifica tu conexión e inténtalo de nuevo.</span><button onClick={calls.refresh}>Reintentar</button></div>}
        {calls.loading && <div className="empty-state" role="status"><span className="loading-ring" aria-hidden="true" /><h3>Cargando llamadas…</h3><p>Estamos preparando tu historial.</p></div>}
        {!calls.loading && !calls.error && calls.data?.items.length === 0 && <div className="empty-state"><span className="empty-symbol" aria-hidden="true">↙</span><h3>Todo listo para tu próxima llamada</h3><p>Las llamadas entrantes aparecerán aquí automáticamente.</p></div>}
        {!calls.loading && !!calls.data?.items.length && <div className="table-container"><table><thead><tr><th>Número / llamada</th><th>Agente</th><th>Fecha y hora</th><th>Duración</th><th>Estado</th><th>Grabación</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{calls.data.items.map((call) => <tr key={call.id} data-call-id={call.callId}>
          <td className="phone-cell" data-label="Número"><strong>{call.phoneNumber}</strong><span className="call-reference" title={call.callId}>{call.callId}</span></td>
          <td data-label="Agente"><span className="agent-name"><span className="avatar" aria-hidden="true">{call.agent.slice(0, 1).toUpperCase()}</span>{call.agent}</span></td>
          <td data-label="Fecha y hora"><time dateTime={call.createdAt}>{formatDate(call.createdAt)}</time></td>
          <td data-label="Duración" className="duration">{duration(call.duration)}</td>
          <td data-label="Estado"><div className="badges"><span className={`badge ${call.isRecurrent ? 'recurrent' : 'first'}`}>{call.isRecurrent ? 'Recurrente' : 'Primera llamada'}</span>{call.isSpam && <span className="badge spam">Spam</span>}</div></td>
          <td data-label="Grabación">{call.recordingUrl && /^https?:\/\//i.test(call.recordingUrl) ? <a className="recording-link" href={call.recordingUrl} target="_blank" rel="noopener noreferrer">Abrir enlace <span aria-hidden="true">↗</span></a> : <span className="muted">Sin grabación</span>}</td>
          <td className="action-cell">{call.isSpam ? <span className="marked-label">✓ Spam marcado</span> : <button className="spam-button" onClick={() => void calls.flag(call.id)} disabled={calls.pending.has(call.id)} aria-label={`Marcar ${call.phoneNumber} como spam`}>{calls.pending.has(call.id) ? 'Marcando…' : 'Marcar spam'}</button>}</td>
        </tr>)}</tbody></table></div>}
        <footer className="pagination"><span>Página {calls.page} de {pageCount}</span><div><button disabled={calls.page <= 1 || calls.loading} onClick={() => calls.setPage(calls.page - 1)}>← Anterior</button><button disabled={calls.page >= pageCount || calls.loading} onClick={() => calls.setPage(calls.page + 1)}>Siguiente →</button></div></footer>
      </section>
      <footer className="dashboard-footer"><p><span aria-hidden="true">◉</span> El historial se actualiza automáticamente. Si se interrumpe la conexión, recuperaremos tus llamadas.</p><HealthStatus /></footer>
    </main>
  </>;
}

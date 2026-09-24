import { AgentIcon, PROVIDER_NAMES } from './AgentIcon';
import { compact, credits, duration, metricsOf, money, statusTone } from '../lib/metrics';

export function SessionCard({ session, selected, onSelect, selectionEnabled = false, checked = false, onToggleSelect }) {
  const metrics = metricsOf(session);
  const tokenLabel = Number.isFinite(metrics.total)
    ? `${compact(metrics.total)} tok`
    : Number.isFinite(metrics.observedTokens) ? `${compact(metrics.observedTokens)} agent tok` : 'tok —';
  const billingLabel = Number.isFinite(metrics.credits)
    ? `${credits(metrics.credits)} credits`
    : Number.isFinite(metrics.cost) ? money(metrics.cost) : null;
  const workloadLabel = ({ interactive: 'Interactive', automation: 'Automation', messaging: 'Messaging' })[session.workload];
  const projectLabel = session.workProjectNames?.join(', ') || session.workProjectName;
  const contextLabel = session.workItemName ? `${session.workItemKind}: ${session.workItemName}` : projectLabel ? `${projectLabel} · Unassigned` : workloadLabel || 'Inbox';
  return <div className={`session-select-row ${selectionEnabled ? 'selection-enabled' : ''} ${checked ? 'checked' : ''}`}>{selectionEnabled && <label className="session-select-check" title={`Select ${session.name}`}><input type="checkbox" checked={checked} onChange={() => onToggleSelect?.(session.id)} aria-label={`Select ${session.name}`} /></label>}<button className={`session-card ${selected ? 'selected' : ''}`} onClick={() => onSelect(session.id)}>
    <span className={`agent-icon provider-${session.provider}`} title={PROVIDER_NAMES[session.provider] || session.provider}>
      <AgentIcon id={session.provider} />
      <i className={`session-card-status status-dot ${statusTone(session.status)}`} aria-hidden="true" />
    </span>
    <span className="session-card-copy">
      <strong>{session.name || session.id}</strong>
      <small>{contextLabel} · {session.model || 'auto'}{session.sourceKind && session.provider === 'hermes' ? ` · ${session.sourceKind}` : ''}</small>
    </span>
    <span className="session-card-meta"><strong>{duration(metrics.durationMs)}</strong><small>{tokenLabel}{billingLabel ? ` · ${billingLabel}` : ''}</small></span>
  </button></div>;
}

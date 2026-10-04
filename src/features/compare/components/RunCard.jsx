import { Clock, FileText, FolderSimple, Terminal, Trash } from '@phosphor-icons/react';
import { AgentIcon, PROVIDER_NAMES } from '../../../shared/components/AgentIcon';
import { compact, duration, metricsOf } from '../../../shared/lib/metrics';

export const cardDate = (value) => {
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) return { day: '—', time: '' };
  const date = new Date(parsed);
  return {
    day: new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date),
    time: new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date),
  };
};

export function RunCard({ run, selected, color, disabled, onToggle, onOpen, onRemove }) {
  const metrics = metricsOf(run);
  const { day, time } = cardDate(run.startedAt);
  const tokenLabel = Number.isFinite(metrics.total) ? compact(metrics.total) : Number.isFinite(metrics.observedTokens) ? `${compact(metrics.observedTokens)}*` : '—';
  const subtitle = <small>{run.model || 'auto'} · {run.repositoryName || 'no project'}{run.imported && <em className="source-badge">Imported</em>}</small>;
  return <article className={`run-card ${selected ? 'selected' : ''}`} style={color ? { borderLeftColor: color } : undefined}>
    <label className="run-card-check">
      <input type="checkbox" checked={selected} disabled={!selected && disabled} onChange={() => onToggle(run.id)} aria-label={selected ? `Remove ${run.name} from comparison` : `Add ${run.name} to comparison`} />
    </label>
    <header className="run-card-head">
      <span className={`agent-icon provider-${run.provider}`} title={PROVIDER_NAMES[run.provider] || run.provider}><AgentIcon id={run.provider} /></span>
      {onOpen
        ? <button className="run-card-title" type="button" onClick={() => onOpen(run.id)}><strong title={run.name}>{run.name}</strong>{subtitle}</button>
        : <div className="run-card-title" title={run.sourceName ? `Imported from ${run.sourceName}` : undefined}><strong title={run.name}>{run.name}</strong>{subtitle}</div>}
      <span className="run-card-date"><strong>{day}</strong><small>{time}</small>{onRemove && <button type="button" className="icon-button run-card-remove" aria-label={`Delete imported run ${run.name}`} title="Delete this import" onClick={onRemove}><Trash /></button>}</span>
    </header>
    <div className="run-card-stats">
      <span title="Tokens"><FileText /><strong>{tokenLabel}</strong><small>tokens</small></span>
      <span title="Duration"><Clock /><strong>{duration(metrics.durationMs)}</strong><small>duration</small></span>
      <span title="Tools used"><Terminal /><strong>{run.toolCount ?? 0}</strong><small>tools used</small></span>
      <span title="Files touched"><FolderSimple /><strong>{run.fileCount ?? 0}</strong><small>files</small></span>
    </div>
  </article>;
}

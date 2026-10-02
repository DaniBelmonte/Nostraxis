import { CaretDown, CaretUp } from '@phosphor-icons/react';
import { AgentIcon, PROVIDER_NAMES } from '../../../shared/components/AgentIcon';
import { compact, duration, formatDate, metricsOf } from '../../../shared/lib/metrics';

const COLUMNS = [
  { key: 'project', label: 'Project' },
  { key: 'model', label: 'Model' },
  { key: 'date', label: 'Date' },
  { key: 'tokens', label: 'Tokens' },
  { key: 'duration', label: 'Duration' },
  { key: 'tools', label: 'Tools' },
  { key: 'files', label: 'Files' },
];

export function RunTable({ runs, selectedIds, disabled, sort, onSort, onToggle, onOpen }) {
  return <div className="run-table">
    <div className="run-table-head">
      <span /><span>Run</span>
      {COLUMNS.map((column) => <button key={column.key} type="button" className={`run-table-sort ${sort.key === column.key ? 'active' : ''}`} onClick={() => onSort(column.key)}>
        {column.label}
        {sort.key === column.key && (sort.dir === 'asc' ? <CaretUp weight="bold" /> : <CaretDown weight="bold" />)}
      </button>)}
    </div>
    {runs.map((run) => {
      const selected = selectedIds.includes(run.id);
      const metrics = metricsOf(run);
      const tokenLabel = Number.isFinite(metrics.total) ? compact(metrics.total) : Number.isFinite(metrics.observedTokens) ? `${compact(metrics.observedTokens)}*` : '—';
      return <div className={`run-table-row ${selected ? 'selected' : ''}`} key={run.id}>
        <label className="run-card-check"><input type="checkbox" checked={selected} disabled={!selected && disabled} onChange={() => onToggle(run.id)} aria-label={selected ? `Remove ${run.name} from comparison` : `Add ${run.name} to comparison`} /></label>
        <button className="run-table-name" type="button" onClick={() => onOpen(run.id)}>
          <span className={`agent-icon provider-${run.provider}`} title={PROVIDER_NAMES[run.provider] || run.provider}><AgentIcon id={run.provider} /></span>
          <strong title={run.name}>{run.name}</strong>
        </button>
        <span>{run.repositoryName || 'no project'}</span>
        <code>{run.model || 'auto'}</code>
        <small>{formatDate(run.startedAt)}</small>
        <code>{tokenLabel}</code>
        <code>{duration(metrics.durationMs)}</code>
        <code>{run.toolCount ?? 0}</code>
        <code>{run.fileCount ?? 0}</code>
      </div>;
    })}
    {!runs.length && <p className="table-empty">No runs match these filters.</p>}
  </div>;
}

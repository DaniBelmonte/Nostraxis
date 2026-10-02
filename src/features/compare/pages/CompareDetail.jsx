import { useCallback, useEffect, useState } from 'react';
import { Warning } from '@phosphor-icons/react';
import { api } from '../../../shared/api/client';
import { compact, duration, formatDate, money } from '../../../shared/lib/metrics';
import { MetricMatrix, RunHeading } from '../components/MetricMatrix';
import { CompareTools } from '../components/CompareTools';
import { CompareFiles } from '../components/CompareFiles';
import { DeviationPanel } from '../components/DeviationPanel';
import { ModelBreakdown } from '../components/ModelBreakdown';
import { RunTimeline } from '../components/RunTimeline';
import { comparabilityNotes, formatValue, withDisplayNames } from '../model/comparison';

const TABS = [['deviations', 'Deviations'], ['timeline', 'Timeline'], ['overview', 'Side by side'], ['models', 'Models & agents'], ['tools', 'Tools'], ['files', 'Files'], ['output', 'Prompt & output']];

const effortText = (row) => row.conditions.effort?.join(' → ')
  || (row.conditions.declaredEffort ? `${row.conditions.declaredEffort} (declared)` : 'Not reported');

function RunSummary({ row, color, onInspect, outlier }) {
  const tokens = row.metrics.totalTokens ?? row.metrics.observedTokens;
  return <article className="compare-summary-card" style={{ borderTopColor: color }}>
    <RunHeading row={row} color={color} onInspect={onInspect} outlier={outlier} />
    <dl>
      <dt>Source</dt><dd title={row.importInfo?.sourceName || undefined}>{row.source === 'imported' ? `${row.importInfo?.sourceName || 'JSONL file'}${row.importInfo?.exportedAt ? ` · exported ${formatDate(row.importInfo.exportedAt)}` : ''}` : 'This machine'}</dd>
      <dt>Project</dt><dd>{row.run.repositoryName || 'No project'}</dd>
      <dt>Started</dt><dd>{formatDate(row.run.startedAt)}</dd>
      <dt>Effort</dt><dd>{effortText(row)}</dd>
      <dt>Requests</dt><dd>{Number.isFinite(row.usageDetail.requests) ? `${compact(row.usageDetail.requests)} model calls` : 'Not reported'}</dd>
      <dt>Models</dt><dd title={row.models.map((model) => model.model).join(', ')}>{row.models.length ? row.models.map((model) => model.model).join(', ') : row.run.model || 'Not reported'}</dd>
      <dt>Agents</dt><dd>{row.agents.length ? `${row.agents.filter((agent) => agent.source !== 'main-agent').length} subagents` : 'None reported'}</dd>
    </dl>
    <div className="compare-summary-kpis">
      <span><small>Tokens</small><strong>{compact(tokens)}</strong></span>
      <span><small>{Number.isFinite(row.metrics.providerCredits) ? row.metrics.creditUnit || 'Credits' : 'Cost'}</small><strong>{Number.isFinite(row.metrics.providerCredits) ? formatValue('credits', row.metrics.providerCredits) : Number.isFinite(row.metrics.costUsd) ? money(row.metrics.costUsd) : '—'}</strong></span>
      <span><small>Active</small><strong>{duration(row.metrics.durationMs)}</strong></span>
      <span><small>Tools</small><strong>{row.activity.events ? row.activity.toolCalls : '—'}</strong></span>
    </div>
  </article>;
}

export function CompareDetail({ ids, colors: colorFor, onInspect }) {
  const [rows, setRows] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('deviations');
  const key = ids.join('|');
  const load = useCallback(() => api.compare(ids).then((value) => {
    // A server started before an update still answers with the old list.
    if (!Array.isArray(value?.runs)) throw new Error('The local server is older than this page. Restart it (npm run dev) to load the comparison.');
    setRows(withDisplayNames(value.runs)); setAnalysis(value); setError(null);
  }).catch((reason) => setError(reason.message)), [key]);
  useEffect(() => { if (ids.length) load(); else setRows([]); }, [load]);
  const colors = rows.map((row) => colorFor(row.key));
  const notes = comparabilityNotes(rows);
  const missing = ids.length - rows.length;

  return <section className="compare-detail" aria-label="Run comparison">
    <header className="compare-detail-head">
      <div><span>Reproducible benchmark</span><h2>Comparing {rows.length || ids.length} runs</h2></div>
      {rows.length > 1 && <span className="compare-reference" title={analysis?.reference?.note || undefined}>Reference · median of {rows.length} runs</span>}
    </header>
    {error && <p className="form-error">{error}</p>}
    {missing > 0 && rows.length > 0 && <p className="unavailable-note">{missing} selected run{missing === 1 ? ' is' : 's are'} no longer available.</p>}
    <div className="compare-summary-grid">{rows.map((row, index) => <RunSummary key={row.key} row={row} color={colors[index]} onInspect={onInspect} outlier={rows.length > 2 && row.key === analysis?.outlier} />)}</div>
    {notes.length > 0 && <ul className="compare-notes" aria-label="Comparability notes">{notes.map((note) => <li key={note}><Warning weight="duotone" />{note}</li>)}</ul>}
    <div className="detail-tabs compare-tabs" role="tablist" aria-label="Comparison views">
      {TABS.map(([id, label]) => <button key={id} type="button" role="tab" id={`compare-tab-${id}`} aria-selected={tab === id} aria-controls="compare-tab-panel" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    <div id="compare-tab-panel" role="tabpanel" aria-labelledby={`compare-tab-${tab}`}>
      {rows.length > 0 && tab === 'deviations' && <DeviationPanel rows={rows} colors={colors} analysis={analysis} />}
      {rows.length > 0 && tab === 'overview' && <MetricMatrix rows={rows} colors={colors} onInspect={onInspect} />}
      {rows.length > 0 && tab === 'timeline' && <RunTimeline rows={rows} colors={colors} />}
      {rows.length > 0 && tab === 'models' && <ModelBreakdown rows={rows} colors={colors} />}
      {rows.length > 0 && tab === 'tools' && <CompareTools rows={rows} colors={colors} />}
      {rows.length > 0 && tab === 'files' && <CompareFiles rows={rows} colors={colors} onInspect={onInspect} />}
      {rows.length > 0 && tab === 'output' && <div className="compare-responses">{rows.map((row, index) => <section key={row.key} style={{ borderTopColor: colors[index] }}>
        <RunHeading row={row} color={colors[index]} onInspect={onInspect} />
        <h3>First prompt</h3><pre className="compare-prompt">{row.prompt || 'Not available'}</pre>
        <h3>Available final response</h3><pre>{row.output || 'Not available'}</pre>
      </section>)}</div>}
    </div>
  </section>;
}

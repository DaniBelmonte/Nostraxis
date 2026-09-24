import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../../../shared/api/client';
import { compact, duration, money } from '../../../shared/lib/metrics';
import { PageShell } from '../../workspace/pages/WorkspaceViews';

const number = (metric, formatter = compact) => metric?.value == null ? '—' : formatter(metric.value);
const creditAmount = (value) => Number.isFinite(value) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(value) : '—';

function Distribution({ title, rows, color = '#79bfee', format = compact }) {
  return <section className="analysis-panel"><h2>{title}</h2>{rows.length ? <div className="analysis-bars">{rows.map((row) => <div key={row.name} className="analysis-bar-row"><span title={row.name}>{row.name}</span><div><i style={{ width: `${Math.max(2, 100 * row.value / Math.max(...rows.map((item) => item.value), 1))}%`, background: color }} /></div><strong>{format(row.value)}</strong></div>)}</div> : <p className="table-empty">No data reported.</p>}</section>;
}

export function SelectionAnalysisView({ target, onInspect, onBack }) {
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setAnalysis(null); setError('');
    api.selectionAnalysis(target.request).then((result) => { if (active) setAnalysis(result); }).catch((reason) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [target]);
  const sessions = analysis?.sessions || [];
  const totals = analysis?.totals || {};
  const coverage = (metric) => metric && metric.reported < metric.total ? `${metric.reported}/${metric.total} reported` : null;
  const creditKpis = (analysis?.copilotCreditTotals || []).map((item) => [
    item.unit ? `Copilot ${item.unit}` : 'Copilot credits',
    item,
    creditAmount,
    item.mainAgentOnly ? `${item.mainAgentOnly} main-agent-only` : null,
  ]);
  return <PageShell eyebrow="Aggregate session analysis" title={target.title} description="Live analysis of the current sessions. No permanent group is created.">
    <div className="analysis-heading"><button type="button" className="toolbar-button" onClick={onBack}>← Back</button><span>{analysis ? `${analysis.sessionCount} sessions` : 'Loading…'}</span></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {analysis && <>
      <div className="analysis-kpis">
        {[
          ['Total tokens', totals.totalTokens, compact], ['Input', totals.inputTokens, compact], ['Output', totals.outputTokens, compact], ['Cache', totals.cachedTokens, compact],
          ['Cost', totals.cost, money], ...creditKpis, ['Active time', totals.activeDurationMs, duration], ['Warnings', { value: analysis.warnings }, compact], ['Errors', { value: analysis.errors }, compact],
          ['Reasoning', totals.reasoningTokens, compact], ['Conversation spans', totals.conversationSpanMs, duration], ['File reads', { value: analysis.fileReads }, compact], ['File writes', { value: analysis.fileWrites }, compact],
        ].map(([label, metric, formatter, note]) => <article key={label}><span>{label}</span><strong>{number(metric, formatter)}</strong>{coverage(metric) && <small>{coverage(metric)}</small>}{note && <small>{note}</small>}</article>)}
      </div>
      <div className="analysis-grid"><section className="analysis-panel analysis-chart"><h2>Tokens by session</h2><p>Session totals reported by providers</p>{sessions.some((run) => run.totalTokens != null) ? <ResponsiveContainer width="100%" height={260}><BarChart data={sessions.map((run) => ({ ...run, label: run.name?.slice(0, 20) || run.id }))} margin={{ top: 10, right: 12, bottom: 30, left: 4 }}><CartesianGrid vertical={false} stroke="#263b4b" /><XAxis dataKey="label" angle={-25} textAnchor="end" height={65} interval={0} tick={{ fill: '#9db4c4', fontSize: 10 }} /><YAxis tickFormatter={compact} tick={{ fill: '#9db4c4', fontSize: 10 }} /><Tooltip contentStyle={{ background: '#132735', border: '1px solid #355166', color: '#e4f0f7' }} formatter={compact} /><Bar dataKey="totalTokens" name="Tokens" fill="#79bfee" /></BarChart></ResponsiveContainer> : <p className="table-empty">No token totals reported.</p>}</section>
        <Distribution title="Tokens by agent" rows={analysis.providerTokens} /><Distribution title="Tokens by model" rows={analysis.modelTokens} color="#b680ff" /><Distribution title="Cost by session" rows={sessions.filter((run) => run.cost != null).map((run) => ({ name: run.name, value: run.cost }))} color="#70c5ac" format={money} /><Distribution title="Cost by agent" rows={analysis.providerCost} color="#70c5ac" format={money} /><Distribution title="Cost by model" rows={analysis.modelCost} color="#70c5ac" format={money} /><Distribution title="Sessions by agent" rows={analysis.providers} /><Distribution title="Sessions by model" rows={analysis.models} color="#b680ff" />
        {analysis.copilotCreditTotals.filter((item) => item.value != null).map((item) => <Distribution key={item.unit} title={`Copilot ${item.unit} by session`} rows={sessions.filter((run) => run.provider === 'copilot' && (run.creditUnit || 'unspecified credits') === item.unit && run.credits != null).map((run) => ({ name: run.name, value: run.credits }))} color="#ffbc72" format={creditAmount} />)}
        <Distribution title="Provider credits by unit" rows={analysis.creditsByUnit} color="#ffbc72" format={creditAmount} /><Distribution title="Tools" rows={analysis.tools.slice(0, 12)} color="#70c5ac" /><Distribution title="Commands" rows={analysis.commands.slice(0, 12)} color="#ffbc72" /><Distribution title="Activity by day" rows={analysis.activity} color="#79bfee" />
      </div>
      <div className="analysis-grid"><section className="analysis-panel"><h2>File activity</h2><p>{analysis.fileReads} reads · {analysis.fileWrites} writes · {analysis.files.length} distinct paths</p><div className="analysis-file-list">{analysis.files.slice(0, 30).map((file) => <div key={file.path}><code title={file.path}>{file.path}</code><span>{file.reads} R · {file.writes} W</span></div>)}</div></section><section className="analysis-panel"><h2>Metric coverage</h2><p>Unavailable provider values stay unavailable in totals.</p><dl className="analysis-coverage">{Object.entries(totals).map(([key, metric]) => <div key={key}><dt>{key.replace(/([A-Z])/g, ' $1')}</dt><dd>{number(metric, key.endsWith('Ms') ? duration : key === 'cost' ? money : compact)} <small>{metric.reported}/{metric.total}</small></dd></div>)}</dl></section></div>
      <section className="analysis-panel"><h2>Included sessions</h2><div className="analysis-session-list">{sessions.map((run) => <button key={run.id} onClick={() => onInspect(run.id)}><span>{run.name}</span><small>{run.provider} · {run.model || 'Unknown'} · {run.status}</small><strong>{compact(run.totalTokens)} tokens</strong></button>)}</div></section>
    </>}
  </PageShell>;
}

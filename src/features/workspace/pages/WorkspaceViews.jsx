import { useEffect, useState } from 'react';
import { Check, FolderOpen, Play } from '@phosphor-icons/react';
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api } from '../../../shared/api/client';
import { compact, credits, duration, money, percent, statusLabel } from '../../../shared/lib/metrics';
import { ChartTooltip, DateRange, CommandChart, ConnectionGraph } from '../../../shared/components/Observability';

export function PageShell({ eyebrow, title, description, children }) {
  return <main className="workspace-page"><header className="page-header"><div><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div></header><div className="page-scroll">{children}</div></main>;
}

function MetricCard({ label, value, meta, tone = '' }) {
  return <article className={`metric-card ${tone}`}><span>{label}</span><strong>{value}</strong><small>{meta}</small></article>;
}

export function AnalyticsView({ initial, repositories, onInspect }) {
  const [analytics, setAnalytics] = useState(initial);
  const [filters, setFilters] = useState({ repository: '', provider: '', model: '', from: '', to: '' });
  useEffect(() => {
    let active = true;
    api.analytics({
      ...filters,
      from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : '',
      to: filters.to ? new Date(`${filters.to}T23:59:59`).toISOString() : '',
    }).then(value => { if (active) setAnalytics(value); }).catch(() => {});
    return () => { active = false; };
  }, [filters, initial]);
  const summary = analytics?.summary || {};
  const chart = (analytics?.dimensions?.model || []).map((row) => ({ ...row, cost: row.totalCostUsd, tokens: row.totalTokens, observedTokens: row.totalObservedTokens }));
  const options = (key) => ['', ...new Set((initial?.timeseries || []).map((row) => row[key]).filter(Boolean))];
  return <PageShell eyebrow="Aggregated observability" title="Analytics" description="Cost, tokens, cache, latency and quality without filling gaps the provider does not expose.">
    <DateRange from={filters.from} to={filters.to} onChange={dates=>setFilters({...filters,...dates})} />
    <div className="analytics-filters">
      <label>Project<select value={filters.repository} onChange={(event) => setFilters({ ...filters, repository: event.target.value })}><option value="">All</option>{[...new Set([...repositories.map(repo => repo.name), ...options('repository').filter(Boolean)])].sort().map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      {['provider', 'model'].map((key) => <label key={key}>{key}<select value={filters[key]} onChange={(event) => setFilters({ ...filters, [key]: event.target.value })}>{options(key).map((value) => <option key={value || 'all'} value={value}>{value || 'All'}</option>)}</select></label>)}
    </div>
    <div className="metric-grid">
      <MetricCard label="Runs" value={analytics?.runCount ?? '—'} meta="current filter" />
      <MetricCard label="Session tokens" value={compact(summary.totalTokens)} meta={`${compact(summary.totalObservedTokens)} attributed to agents`} tone="blue" />
      <MetricCard label="Cost" value={money(summary.totalCostUsd)} meta="provider or configured pricing" tone="green" />
      <MetricCard label="Provider credits" value={credits(summary.totalProviderCredits)} meta={summary.providerCreditUnit || 'incompatible units or not reported'} />
      <MetricCard label="Cache hit" value={percent(summary.cacheHit)} meta="input cacheado / input" tone="purple" />
      <MetricCard label="Average evaluation" value={Number.isFinite(summary.averageEvaluationScore) ? summary.averageEvaluationScore.toFixed(2) : 'Not reported'} meta="available evaluators" />
    </div>
    <div className="metric-grid"><MetricCard label="Reads" value={compact(analytics?.observability?.fileReads)} meta="observed" /><MetricCard label="Writes" value={compact(analytics?.observability?.fileWrites)} meta="observed" /><MetricCard label="Warnings" value={compact(analytics?.observability?.warningCount)} meta="sensitive paths and commands" /><MetricCard label="Errors" value={compact(analytics?.observability?.errors)} meta="reported" /><MetricCard label="Average duration" value={duration(summary.averageDurationMs)} meta="active execution time" /></div>
    <section className="panel-block"><header><div><span>Comparison</span><h2>Models by tokens and cost</h2></div><small>Independent axes · tokens / USD</small></header><div className="analytics-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={chart} margin={{left:10,right:10,bottom:35}}><CartesianGrid stroke="#233747" vertical={false} /><XAxis dataKey="key" stroke="#7590a5" tick={{fontSize:10}} angle={-15} textAnchor="end" /><YAxis yAxisId="tokens" stroke="#7590a5" tickFormatter={compact} /><YAxis yAxisId="cost" orientation="right" stroke="#7590a5" tickFormatter={money} /><Tooltip content={<ChartTooltip />} /><Legend /><Bar name="Session tokens" yAxisId="tokens" dataKey="tokens" fill="#79bfee" /><Bar name="Agents (included)" yAxisId="tokens" dataKey="observedTokens" fill="#b680ff" /><Bar name="Cost" yAxisId="cost" dataKey="cost" fill="#70c5ac" /></BarChart></ResponsiveContainer></div></section>
    <section className="panel-block"><header><div><span>Drill-down</span><h2>Included runs</h2></div></header><div className="data-table analytics-table"><div className="table-head"><span>Run</span><span>Repo</span><span>Provider / model</span><span>Tokens</span><span>Cost</span><span>Duration</span><span>Eval</span></div>{(analytics?.timeseries || []).map((row) => <button key={row.runId} onClick={() => onInspect(row.runId)}><strong>{row.runId}</strong><span>{row.repository}</span><code>{row.provider} / {row.model || 'auto'}</code><code>{Number.isFinite(row.totalTokens) ? compact(row.totalTokens) : Number.isFinite(row.observedTokens) ? `${compact(row.observedTokens)} agents` : '—'}</code><code>{money(row.costUsd)}</code><code>{duration(row.durationMs)}</code><code>{Number.isFinite(row.evaluationScore) ? row.evaluationScore.toFixed(2) : '—'}</code></button>)}</div></section>
    <CommandChart commands={analytics?.observability?.commands} />
    <ConnectionGraph graph={analytics?.observability?.graph} />
  </PageShell>;
}

export function LabView({ data, reload, setError }) {
  const repository = data.repositories[0];
  const [name, setName] = useState('Context strategy benchmark');
  const [task, setTask] = useState('Diagnose the checkout regression and propose the smallest safe fix.');
  const [context, setContext] = useState('Checkout totals are rounded only at the payment boundary.');
  const [busy, setBusy] = useState(false);
  const create = async (event) => {
    event.preventDefault(); setBusy(true);
    try {
      await api.createExperiment({ name, task, repositoryId: repository?.id, evaluatorId: 'manual', variants: [
        { label: 'Raw repository', provider: 'codex', model: 'gpt-5', contextStrategy: 'raw-repo', promptTemplate: '{{task}}' },
        { label: 'Knowledge Base', provider: 'codex', model: 'gpt-5-mini', contextStrategy: 'knowledge-base', promptTemplate: '{{context}}\n\n{{task}}', contextItems: [{ type: 'knowledge-base', name: 'domain-notes', content: context }] },
        { label: 'LLM Wiki', provider: 'claude', model: 'sonnet-4', contextStrategy: 'llm-wiki', promptTemplate: '{{context}}\n\n{{task}}', contextItems: [{ type: 'llm-wiki', name: 'repo-wiki', content: context }] },
      ] });
      await reload();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  };
  const start = async (id) => { setBusy(true); try { await api.startExperiment(id); await reload(); } catch (reason) { setError(reason.message); } finally { setBusy(false); } };
  return <PageShell eyebrow="AI R&D" title="R&D Lab" description="Run the same task with different models, prompts and context strategies while retaining exactly what each receives.">
    <div className="lab-layout"><form className="lab-form" onSubmit={create}><header><span>New experiment</span><h2>Context matrix</h2></header><label>Name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Shared task<textarea value={task} onChange={(event) => setTask(event.target.value)} /></label><label>KB / Wiki snapshot<textarea value={context} onChange={(event) => setContext(event.target.value)} /></label><div className="strategy-preview">{['raw-repo', 'knowledge-base', 'llm-wiki'].map((item) => <span key={item}><Check /> {item}</span>)}</div><button className="primary-button" disabled={busy || !repository}>{busy ? 'Saving…' : 'Create experiment'}</button>{!repository && <p className="form-error">Register a repository first.</p>}</form>
      <section className="experiment-list"><header><span>Experiments</span><h2>Reproducible variants</h2></header>{data.experiments.map((experiment) => <article key={experiment.id} className="experiment-card"><div className="experiment-top"><div><span>{statusLabel(experiment.status)}</span><h3>{experiment.name}</h3><p>{experiment.task}</p></div><button className="secondary-button" onClick={() => start(experiment.id)} disabled={busy || experiment.status === 'running'}><Play /> Run</button></div><div className="variant-list">{experiment.variants.map((variant) => <div key={variant.id}><span>{variant.label}</span><code>{variant.provider} / {variant.model || 'auto'}</code><strong>{variant.contextStrategy}</strong><code title={variant.contextSnapshot?.digest}>{variant.contextSnapshot?.digest?.slice(0, 12) || 'snapshot ready'}</code></div>)}</div></article>)}</section></div>
  </PageShell>;
}

export function RepositoriesView({ repositories, reload, setError }) {
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [pathError, setPathError] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    const requestedPath = path.trim();
    if (!requestedPath) { setPathError('Enter the absolute repository path.'); return; }
    setBusy(true); setPathError('');
    try { await api.addRepository(requestedPath); setPath(''); await reload(); }
    catch (reason) { setPathError(reason.message); setError(reason.message); }
    finally { setBusy(false); }
  };
  return <PageShell eyebrow="Code sources" title="Repositories" description="Each run is anchored to a path, branch and commit in the local repository.">
    <button className="primary-button" disabled={busy} onClick={async () => { setBusy(true); try { const result = await api.pickRepository(); if (result.path) { await api.addRepository(result.path); await reload(); } } catch (error) { setError(error.message); } finally { setBusy(false); } }}><FolderOpen /> Select folder…</button>
    <form className="repo-form" onSubmit={submit}><label>Absolute path<input value={path} onChange={(event) => { setPath(event.target.value); setPathError(''); }} placeholder="/Users/me/code/my-repo" required aria-invalid={Boolean(pathError)} aria-describedby="repository-path-help" /><small id="repository-path-help" className={pathError ? 'form-error' : 'repo-field-hint'}>{pathError || 'Paste an absolute local path to enable registration.'}</small></label><button className="primary-button" disabled={busy || !path.trim()}>{busy ? 'Inspecting…' : 'Register repository'}</button></form>
    <section className="panel-block"><header><div><span>Local registry</span><h2>{repositories.length} repositories</h2></div></header><div className="repo-grid">{repositories.map((repo) => <article key={repo.id}><FolderOpen /><div><h3>{repo.name}</h3><code>{repo.path}</code></div><dl><dt>Branch</dt><dd>{repo.branch || 'Not reported'}</dd><dt>HEAD</dt><dd><code>{repo.headSha?.slice(0, 12) || 'Not available'}</code></dd></dl></article>)}</div></section>
  </PageShell>;
}

export function SettingsView({ data }) {
  return <PageShell eyebrow="Standalone runtime" title="Settings" description="Adapter status and observability contract for the independent project.">
    <section className="panel-block"><header><div><span>Team sessions</span><h2>Observed sources · {data.externalSessionCount || 0} imported</h2></div></header><div className="provider-grid">{(data.sessionSources || []).map((source) => <article key={`${source.provider}:${source.root}`}><div><span className={`status-dot ${source.available ? 'live' : 'warning'}`} /><h3>{source.label || source.provider}</h3></div><strong>{source.available ? `${source.count} recent logs` : 'Not detected'}</strong><p><code>{source.root}</code><br />{source.error ? `Error: ${source.error}` : 'Automatic sync every 3 seconds'}</p></article>)}</div></section>
    <section className="panel-block"><header><div><span>Provider adapters</span><h2>Local availability</h2></div></header><div className="provider-grid">{data.providers.map((provider) => <article key={provider.id}><div><span className={`status-dot ${provider.available ? 'live' : 'warning'}`} /><h3>{provider.name}</h3></div><strong>{provider.available ? provider.version || 'Available' : 'Not available'}</strong><p>{provider.error || `Tokens ${provider.capabilities.usage ? 'yes' : 'no'} · credits ${provider.capabilities.credits ? 'yes' : 'no'} · reasoning ${provider.capabilities.reasoning ? 'yes' : 'no'} · cost ${provider.capabilities.cost ? 'yes' : 'no'}`}</p></article>)}</div></section>
    <section className="panel-block"><header><div><span>Semantics</span><h2>Metrics</h2></div></header><div className="definition-list">{data.metricDefinitions.map((metric) => <div key={metric.id}><code>{metric.id}</code><strong>{metric.label}</strong><span>{metric.unit}</span><small>{metric.source}</small></div>)}</div></section>
  </PageShell>;
}

import { useEffect, useMemo, useState } from 'react';
import { Check, FolderOpen, Play } from '@phosphor-icons/react';
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api } from './api';
import { compact, credits, duration, money, percent, statusLabel, statusTone } from './lib';
import { ChartTooltip, DateRange, CommandChart, ConnectionGraph } from './Observability';

function PageShell({ eyebrow, title, description, children }) {
  return <main className="workspace-page"><header className="page-header"><div><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div></header><div className="page-scroll">{children}</div></main>;
}

function MetricCard({ label, value, meta, tone = '' }) {
  return <article className={`metric-card ${tone}`}><span>{label}</span><strong>{value}</strong><small>{meta}</small></article>;
}

function relativeFilePath(filePath, repositoryPath = '') {
  const normalized = String(filePath || '').replaceAll('\\', '/');
  const root = String(repositoryPath || '').replaceAll('\\', '/').replace(/\/$/, '');
  return root && normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized.replace(/^\.\//, '');
}

function buildFileTree(files, repositoryPath) {
  const root = { name: '', folders: new Map(), files: [], count: 0 };
  for (const file of files) {
    const parts = relativeFilePath(file.path, repositoryPath).split('/').filter(Boolean);
    const fileName = parts.pop() || file.path;
    let node = root;
    node.count++;
    for (const folder of parts) {
      if (!node.folders.has(folder)) node.folders.set(folder, { name: folder, folders: new Map(), files: [], count: 0 });
      node = node.folders.get(folder);
      node.count++;
    }
    node.files.push({ ...file, fileName });
  }
  return root;
}

function FileTreeNode({ node, depth = 0, expanded = false }) {
  const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => a.fileName.localeCompare(b.fileName));
  return <>{folders.map(folder => <details key={`${depth}:${folder.name}`} className="file-tree-folder" open={expanded || depth === 0 ? true : undefined}>
    <summary><FolderOpen /><span>{folder.name}</span><small>{folder.count}</small></summary>
    <div><FileTreeNode node={folder} depth={depth + 1} expanded={expanded} /></div>
  </details>)}{files.map(file => <div className={`file-tree-file ${file.sensitive ? 'sensitive' : ''}`} key={file.path} title={file.path}>
    <span>{file.fileName}</span><small>{file.reads ? `${file.reads}R` : ''}{file.reads && file.writes ? ' · ' : ''}{file.writes ? `${file.writes}W` : ''}{file.sensitive ? ' · sensitive' : ''}</small>
  </div>)}</>;
}

function CompareFiles({ rows }) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('all');
  const normalizedQuery = query.trim().toLowerCase();
  const visible = file => (!normalizedQuery || file.path.toLowerCase().includes(normalizedQuery))
    && (mode === 'all' || mode === 'read' && file.reads > 0 || mode === 'write' && file.writes > 0 || mode === 'sensitive' && file.sensitive);
  return <section className="compare-files panel-block">
    <header><div><span>Explorer</span><h2>Observed files</h2></div><div className="compare-file-controls"><input aria-label="Search compared files" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search path or file…" /><div role="group" aria-label="Filter files">{[['all','All'],['read','Read'],['write','Modified'],['sensitive','Sensitive']].map(([id,label]) => <button key={id} className={mode === id ? 'active' : ''} onClick={() => setMode(id)}>{label}</button>)}</div></div></header>
    <div className="compare-file-grid">{rows.map(row => {
      const files = (row.files || []).filter(visible);
      const reads = files.reduce((total, file) => total + file.reads, 0);
      const writes = files.reduce((total, file) => total + file.writes, 0);
      return <article key={row.run.id}><div className="compare-file-heading"><button className="compare-run-link" onClick={() => row.onInspect?.(row.run.id)}>{row.run.name}</button><span>{files.length} of {row.files?.length || 0} files</span><small>{reads} reads · {writes} writes</small></div><div className="file-tree">{files.length ? <FileTreeNode node={buildFileTree(files, row.run.repositoryPath)} expanded={Boolean(normalizedQuery)} /> : <p>No files match this filter.</p>}</div></article>;
    })}</div>
  </section>;
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
    <div className="metric-grid"><MetricCard label="Reads" value={compact(analytics?.observability?.fileReads)} meta="observed" /><MetricCard label="Writes" value={compact(analytics?.observability?.fileWrites)} meta="observed" /><MetricCard label="Warnings" value={compact(analytics?.observability?.warningCount)} meta="sensitive paths and commands" /><MetricCard label="Errors" value={compact(analytics?.observability?.errors)} meta="reported" /><MetricCard label="Average duration" value={duration(summary.averageDurationMs)} meta="elapsed time, including pauses" /></div>
    <section className="panel-block"><header><div><span>Comparison</span><h2>Models by tokens and cost</h2></div><small>Independent axes · tokens / USD</small></header><div className="analytics-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={chart} margin={{left:10,right:10,bottom:35}}><CartesianGrid stroke="#233747" vertical={false} /><XAxis dataKey="key" stroke="#7590a5" tick={{fontSize:10}} angle={-15} textAnchor="end" /><YAxis yAxisId="tokens" stroke="#7590a5" tickFormatter={compact} /><YAxis yAxisId="cost" orientation="right" stroke="#7590a5" tickFormatter={money} /><Tooltip content={<ChartTooltip />} /><Legend /><Bar name="Session tokens" yAxisId="tokens" dataKey="tokens" fill="#79bfee" /><Bar name="Agents (included)" yAxisId="tokens" dataKey="observedTokens" fill="#b680ff" /><Bar name="Cost" yAxisId="cost" dataKey="cost" fill="#70c5ac" /></BarChart></ResponsiveContainer></div></section>
    <section className="panel-block"><header><div><span>Drill-down</span><h2>Included runs</h2></div></header><div className="data-table analytics-table"><div className="table-head"><span>Run</span><span>Repo</span><span>Provider / model</span><span>Tokens</span><span>Cost</span><span>Duration</span><span>Eval</span></div>{(analytics?.timeseries || []).map((row) => <button key={row.runId} onClick={() => onInspect(row.runId)}><strong>{row.runId}</strong><span>{row.repository}</span><code>{row.provider} / {row.model || 'auto'}</code><code>{Number.isFinite(row.totalTokens) ? compact(row.totalTokens) : Number.isFinite(row.observedTokens) ? `${compact(row.observedTokens)} agents` : '—'}</code><code>{money(row.costUsd)}</code><code>{duration(row.durationMs)}</code><code>{Number.isFinite(row.evaluationScore) ? row.evaluationScore.toFixed(2) : '—'}</code></button>)}</div></section>
    <CommandChart commands={analytics?.observability?.commands} />
    <ConnectionGraph graph={analytics?.observability?.graph} />
  </PageShell>;
}

export function CompareView({ runs, focusId, onInspect }) {
  const defaults = useMemo(() => [focusId, ...runs.map((run) => run.id).filter((id) => id !== focusId)].filter(Boolean).slice(0, 3), [runs, focusId]);
  const [ids, setIds] = useState(defaults);
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [dates, setDates] = useState({from:'',to:''});
  useEffect(() => { if (ids.length) api.compare(ids).then(setRows).catch(() => {}); else setRows([]); }, [ids.join('|')]);
  const candidates = runs.filter(run => `${run.name} ${run.model} ${run.repositoryName}`.toLowerCase().includes(query.toLowerCase()) && (!dates.from || Date.parse(run.startedAt)>=new Date(dates.from+'T00:00:00').getTime()) && (!dates.to || Date.parse(run.startedAt)<=new Date(dates.to+'T23:59:59.999').getTime()));
  const toggle = (id) => setIds((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length < 4 ? [...current, id] : current);
  return <PageShell eyebrow="Reproducible benchmark" title="Compare" description="Compare real runs by usage, speed, context, output and score.">
    <DateRange {...dates} onChange={setDates} /><input className="compare-search" aria-label="Search sessions to compare" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search project, model or session…" /><p className="empty-evidence">Select up to 4 sessions · {ids.length} selected. Differences in task and context affect the results.</p>
    <div className="compare-picker">{candidates.map((run) => <button key={run.id} className={ids.includes(run.id) ? 'selected' : ''} onClick={() => toggle(run.id)}><span className={`status-dot ${statusTone(run.status)}`} /><span><strong>{run.name}</strong><small>{run.repositoryName} · {run.model || run.provider} · {run.usage?.input != null && run.usage?.output != null ? `${compact(run.usage.input+run.usage.output)} tokens` : Number.isFinite(run.usage?.observedTokens) ? `${compact(run.usage.observedTokens)} agent tokens` : 'tokens not reported'}</small></span>{ids.includes(run.id) && <Check />}</button>)}</div>
    <section className="compare-matrix" style={{gridTemplateColumns:`136px repeat(${Math.max(1,rows.length)}, minmax(220px, 1fr))`}}>
      <div className="matrix-labels">
        <span>Run</span><span>Model</span><span>Tokens</span><span>Cost</span><span>Provider credits</span>
        <span>Duration</span><span>Cache hit</span><span>Reasoning</span><span>Evaluation</span>
        <span>Tools</span><span>Files</span><span>Context digest</span><span>Output</span>
      </div>
      {rows.map((row) => <article key={row.run.id}>
        <button className="compare-run-link" onClick={() => onInspect(row.run.id)}>{row.run.name}</button>
        <code>{row.run.provider} / {row.run.model || 'auto'}</code>
        <strong title={`Input: ${compact(row.metrics.inputTokens)} · Output: ${compact(row.metrics.outputTokens)} · Cache: ${compact(row.metrics.cachedTokens)}`}>{Number.isFinite(row.metrics.totalTokens) ? compact(row.metrics.totalTokens) : Number.isFinite(row.metrics.observedTokens) ? `${compact(row.metrics.observedTokens)} agents` : 'Not reported'} <small>in {compact(row.metrics.inputTokens)} / out {compact(row.metrics.outputTokens)}</small></strong>
        <strong>{money(row.metrics.costUsd)}</strong>
        <strong>{Number.isFinite(row.metrics.providerCredits) ? `${credits(row.metrics.providerCredits)} ${row.metrics.creditUnit || ''}` : 'Not reported'}</strong>
        <strong>{duration(row.metrics.durationMs)}</strong>
        <strong>{percent(row.metrics.cacheHit)}</strong>
        <strong>{compact(row.metrics.reasoningTokens)}</strong>
        <strong>{Number.isFinite(row.metrics.evaluationScore) ? row.metrics.evaluationScore.toFixed(2) : 'Not reported'}</strong>
        <p>{row.tools?.length ? row.tools.map((tool) => `${tool.name} ×${tool.count}`).join(' · ') : 'Not reported'}</p>
        <p>{row.files?.length ? `${row.files.length} files · ${row.files.reduce((total,file)=>total+file.reads,0)} reads · ${row.files.reduce((total,file)=>total+file.writes,0)} writes` : 'Not reported'}</p>
        <code>{row.contextDigest?.slice(0, 12) || 'Not available'}</code>
        <p>{row.output ? 'View full response below' : 'No response captured'}</p>
      </article>)}
    </section>
    <CompareFiles rows={rows.map(row => ({ ...row, onInspect }))} />
    <div className="compare-responses">{rows.map(row=><section key={row.run.id}><button className="compare-run-link" onClick={()=>onInspect(row.run.id)}>{row.run.name}</button><h3>Available final response</h3><pre>{row.output || 'Not available'}</pre></section>)}</div>
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
    <section className="panel-block"><header><div><span>Team sessions</span><h2>Observed sources · {data.externalSessionCount || 0} imported</h2></div></header><div className="provider-grid">{(data.sessionSources || []).map((source) => <article key={`${source.provider}:${source.root}`}><div><span className={`status-dot ${source.available ? 'live' : 'warning'}`} /><h3>{source.provider}</h3></div><strong>{source.available ? `${source.count} recent logs` : 'Not detected'}</strong><p><code>{source.root}</code><br />{source.error ? `Error: ${source.error}` : 'Automatic sync every 3 seconds'}</p></article>)}</div></section>
    <section className="panel-block"><header><div><span>Provider adapters</span><h2>Local availability</h2></div></header><div className="provider-grid">{data.providers.map((provider) => <article key={provider.id}><div><span className={`status-dot ${provider.available ? 'live' : 'warning'}`} /><h3>{provider.name}</h3></div><strong>{provider.available ? provider.version || 'Available' : 'Not available'}</strong><p>{provider.error || `Tokens ${provider.capabilities.usage ? 'yes' : 'no'} · credits ${provider.capabilities.credits ? 'yes' : 'no'} · reasoning ${provider.capabilities.reasoning ? 'yes' : 'no'} · cost ${provider.capabilities.cost ? 'yes' : 'no'}`}</p></article>)}</div></section>
    <section className="panel-block"><header><div><span>Semantics</span><h2>Metrics</h2></div></header><div className="definition-list">{data.metricDefinitions.map((metric) => <div key={metric.id}><code>{metric.id}</code><strong>{metric.label}</strong><span>{metric.unit}</span><small>{metric.source}</small></div>)}</div></section>
  </PageShell>;
}

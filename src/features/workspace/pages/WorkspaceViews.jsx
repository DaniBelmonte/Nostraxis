import { useMemo, useState } from 'react';
import { CaretDown, CaretRight, Check, Copy, FolderOpen, Play } from '@phosphor-icons/react';
import { api } from '../../../shared/api/client';
import { compact, duration, formatDate, metricsOf, money, statusLabel, statusTone } from '../../../shared/lib/metrics';
import { PROVIDER_NAMES } from '../../../shared/components/AgentIcon';

export function PageShell({ eyebrow, title, description, actions, tabs, children, className = '' }) {
  return <main className="workspace-page"><header className="page-header"><div>{eyebrow && <span>{eyebrow}</span>}<h1>{title}</h1><p>{description}</p></div>{actions && <div className="page-actions">{actions}</div>}</header>{tabs}<div className={`page-scroll ${className}`.trim()}>{children}</div></main>;
}

const VARIANTS = (context) => [
  { id: 'raw', label: 'Raw repository', provider: 'codex', model: 'gpt-5', contextStrategy: 'raw-repo', promptTemplate: '{{task}}' },
  { id: 'kb', label: 'Knowledge Base', provider: 'codex', model: 'gpt-5-mini', contextStrategy: 'knowledge-base', promptTemplate: '{{context}}\n\n{{task}}', contextItems: [{ type: 'knowledge-base', name: 'domain-notes', content: context }] },
  { id: 'wiki', label: 'LLM Wiki', provider: 'claude', model: 'sonnet-4', contextStrategy: 'llm-wiki', promptTemplate: '{{context}}\n\n{{task}}', contextItems: [{ type: 'llm-wiki', name: 'repo-wiki', content: context }] },
];

export function LabView({ data, reload, setError }) {
  const [repositoryId, setRepositoryId] = useState(data.repositories[0]?.id || '');
  const repository = data.repositories.find((repo) => repo.id === repositoryId) || data.repositories[0];
  const [name, setName] = useState('Context strategy benchmark');
  const [task, setTask] = useState('Diagnose the checkout regression and propose the smallest safe fix.');
  const [context, setContext] = useState('Checkout totals are rounded only at the payment boundary.');
  const [chosen, setChosen] = useState({ raw: true, kb: true, wiki: true });
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(data.experiments[0]?.id || null);
  const [busy, setBusy] = useState(false);
  const variants = VARIANTS(context).filter((variant) => chosen[variant.id]);
  // The server requires at least two variants, so the form says so before submitting.
  const create = async (event) => {
    event.preventDefault(); setBusy(true);
    try {
      await api.createExperiment({ name, task, repositoryId: repository?.id, evaluatorId: 'manual', variants: variants.map(({ id, ...variant }) => variant) });
      await reload();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  };
  const start = async (id) => { setBusy(true); try { await api.startExperiment(id); await reload(); setOpen(id); } catch (reason) { setError(reason.message); } finally { setBusy(false); } };
  const statuses = ['all', ...new Set(data.experiments.map((experiment) => experiment.status))];
  const experiments = data.experiments.filter((experiment) => filter === 'all' || experiment.status === filter);
  const runOf = (id) => data.runs.find((run) => run.id === id);
  return <PageShell eyebrow="AI R&D" title="R&D Lab" description="Run the same task with different models, prompts and context strategies while retaining exactly what each receives.">
    <p className="lab-banner">Experimental feature, enabled with <code>NOSTRAXIS_EXPERIMENTS_ENABLED=1</code>. Variants run as managed runs; repository writes stay disabled.</p>
    <div className="lab-layout"><form className="lab-form" onSubmit={create}><header><span>New experiment</span><h2>Context matrix</h2></header>
      <label>Name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Repository<select value={repository?.id || ''} onChange={(event) => setRepositoryId(event.target.value)}>{data.repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label>
      <label>Shared task<textarea value={task} onChange={(event) => setTask(event.target.value)} /><small>Every variant receives this exact task.</small></label>
      <label>KB / Wiki snapshot<textarea value={context} onChange={(event) => setContext(event.target.value)} /><small>Frozen with a digest so each variant can be reproduced.</small></label>
      <fieldset className="variant-picker"><legend>Variants</legend>{VARIANTS(context).map((variant) => <button key={variant.id} type="button" aria-pressed={Boolean(chosen[variant.id])} className={chosen[variant.id] ? 'active' : ''} onClick={() => setChosen((current) => ({ ...current, [variant.id]: !current[variant.id] }))}>
        <i aria-hidden="true">{chosen[variant.id] && <Check weight="bold" />}</i><strong>{variant.label}</strong><code>{variant.provider} / {variant.model} · {variant.contextStrategy}</code>
      </button>)}</fieldset>
      <div className="lab-form-foot"><button className="primary-button" disabled={busy || !repository || variants.length < 2}>{busy ? 'Saving…' : 'Create experiment'}</button><small className={variants.length < 2 ? 'form-error' : ''}>{!repository ? 'Register a repository first.' : variants.length < 2 ? 'Choose at least two variants.' : `${variants.length} variants · snapshots are frozen on create`}</small></div>
    </form>
      <section className="experiment-list"><header><div><span>Experiments</span><h2>Reproducible variants</h2></div>{statuses.length > 2 && <div className="view-toggle" role="group" aria-label="Status filter">{statuses.map((status) => <button key={status} type="button" aria-pressed={filter === status} className={filter === status ? 'active' : ''} onClick={() => setFilter(status)}>{status === 'all' ? 'All' : statusLabel(status)}</button>)}</div>}</header>
        {experiments.map((experiment) => {
          const expanded = open === experiment.id;
          return <article key={experiment.id} className={`experiment-card ${expanded ? 'open' : ''}`}><div className="experiment-top">
            <button type="button" className="experiment-toggle" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : experiment.id)}>{expanded ? <CaretDown /> : <CaretRight />}<span><strong>{experiment.name}<em className={`state-pill ${statusTone(experiment.status)}`}>{statusLabel(experiment.status)}</em></strong><small>{experiment.task}</small></span></button>
            <button className="secondary-button" onClick={() => start(experiment.id)} disabled={busy || experiment.status === 'running'}><Play /> {experiment.status === 'draft' ? 'Run' : 'Run again'}</button>
          </div>
          {expanded && <div className="variant-table" role="table" aria-label={`${experiment.name} variants`}>
            <div className="variant-row variant-head" role="row"><span role="columnheader">Variant</span><span role="columnheader">Strategy</span><span role="columnheader">Snapshot</span><span role="columnheader">Status</span><span role="columnheader">Tokens</span><span role="columnheader">Duration</span><span role="columnheader">Cost</span></div>
            {experiment.variants.map((variant) => {
              const run = runOf(variant.runId);
              const metrics = run ? metricsOf(run) : null;
              return <div key={variant.id} className="variant-row" role="row">
                <span role="cell"><strong>{variant.label}</strong><code>{variant.provider} / {variant.model || 'auto'}</code></span>
                <span role="cell"><code className="strategy-tag">{variant.contextStrategy}</code></span>
                <code role="cell" title={variant.contextSnapshot?.digest}>{variant.contextSnapshot?.digest?.slice(0, 12) || 'snapshot ready'}</code>
                <span role="cell"><em className={`state-pill ${statusTone(variant.status)}`}>{statusLabel(variant.status)}</em></span>
                <code role="cell">{metrics ? compact(metrics.total) : '—'}</code>
                <code role="cell">{metrics ? duration(metrics.durationMs) : '—'}</code>
                <code role="cell">{metrics ? money(metrics.cost) : '—'}</code>
              </div>;
            })}
          </div>}</article>;
        })}
        {!experiments.length && <p className="table-empty">{data.experiments.length ? 'No experiments with this status.' : 'No experiments yet. Create one to compare context strategies.'}</p>}
      </section></div>
  </PageShell>;
}

export function RepositoriesView({ repositories, runs = [], reload, setError }) {
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [pathError, setPathError] = useState('');
  const [selectedId, setSelectedId] = useState(repositories[0]?.id || null);
  const [copied, setCopied] = useState(false);
  // Sessions are matched to a repository by id, falling back to its name for observed histories.
  const usage = useMemo(() => new Map(repositories.map((repo) => {
    const own = runs.filter((run) => run.repositoryId === repo.id || (!run.repositoryId && run.repositoryName === repo.name));
    const latest = own.reduce((best, run) => (Date.parse(run.updatedAt || run.startedAt) > Date.parse(best?.updatedAt || best?.startedAt || 0) ? run : best), null);
    return [repo.id, { runs: own, latest, providers: [...new Set(own.map((run) => run.provider))] }];
  })), [repositories, runs]);
  const selected = repositories.find((repo) => repo.id === selectedId) || repositories[0];
  const info = selected ? usage.get(selected.id) : null;
  const register = async (requestedPath) => {
    setBusy(true); setPathError('');
    try { await api.addRepository(requestedPath); setPath(''); await reload(); }
    catch (reason) { setPathError(reason.message); setError(reason.message); }
    finally { setBusy(false); }
  };
  const submit = (event) => {
    event.preventDefault();
    const requestedPath = path.trim();
    if (!requestedPath) { setPathError('Enter the absolute repository path.'); return; }
    register(requestedPath);
  };
  const pickFolder = async () => { setBusy(true); try { const result = await api.pickRepository(); if (result.path) await register(result.path); } catch (error) { setError(error.message); } finally { setBusy(false); } };
  return <PageShell eyebrow="Code sources" title="Repositories" description="Each run is anchored to a path, branch and commit in the local repository." actions={<button className="primary-button" disabled={busy} onClick={pickFolder}><FolderOpen /> Select folder…</button>}>
    <form className="repo-form" onSubmit={submit}><header><h2>Register a repository</h2><small>Nostraxis only reads git metadata: path, branch and HEAD commit.</small></header><div className="repo-form-row"><label>Absolute path<input value={path} onChange={(event) => { setPath(event.target.value); setPathError(''); }} placeholder="/Users/me/code/my-repo" required aria-invalid={Boolean(pathError)} aria-describedby="repository-path-help" /><small id="repository-path-help" className={pathError ? 'form-error' : 'repo-field-hint'}>{pathError || 'Paste an absolute local path to enable registration.'}</small></label><button className="primary-button" disabled={busy || !path.trim()}>{busy ? 'Inspecting…' : 'Register repository'}</button></div></form>
    <div className="repo-layout">
      <section className="panel-block repo-registry"><header><div><span>Local registry</span><h2>{repositories.length} {repositories.length === 1 ? 'repository' : 'repositories'}</h2></div></header>
        {repositories.length ? <div className="repo-table" role="table" aria-label="Registered repositories">
          <div className="repo-row repo-head" role="row"><span role="columnheader">Repository</span><span role="columnheader">Branch</span><span role="columnheader">HEAD</span><span role="columnheader">Sessions</span><span role="columnheader">Last activity</span></div>
          {repositories.map((repo) => {
            const entry = usage.get(repo.id);
            return <button key={repo.id} type="button" role="row" aria-pressed={selected?.id === repo.id} className={`repo-row ${selected?.id === repo.id ? 'selected' : ''}`} onClick={() => setSelectedId(repo.id)}>
              <span role="cell" className="repo-name"><FolderOpen /><span><strong>{repo.name}</strong><code>{repo.path}</code></span></span>
              <code role="cell" className={repo.branch ? '' : 'muted'}>{repo.branch || 'Not reported'}</code>
              <code role="cell" className={repo.headSha ? '' : 'muted'}>{repo.headSha?.slice(0, 12) || 'Not available'}</code>
              <code role="cell">{entry.runs.length}</code>
              <span role="cell" className={entry.latest ? '' : 'muted'}>{entry.latest ? formatDate(entry.latest.updatedAt || entry.latest.startedAt) : 'No sessions'}</span>
            </button>;
          })}
        </div> : <p className="table-empty">No repositories registered yet.</p>}
      </section>
      {selected && <aside className="panel-block repo-detail" aria-label="Repository details"><header><div><span>Repository</span><h2>{selected.name}</h2></div></header>
        <dl className="session-facts">
          <dt>Path</dt><dd className="copy-value"><code>{selected.path}</code><button type="button" onClick={() => { navigator.clipboard?.writeText(selected.path); setCopied(true); setTimeout(() => setCopied(false), 1200); }} aria-label="Copy repository path">{copied ? <Check /> : <Copy />}</button></dd>
          <dt>Branch</dt><dd><code>{selected.branch || 'Not reported'}</code></dd>
          <dt>HEAD</dt><dd><code>{selected.headSha || 'Not available'}</code></dd>
          <dt>Sessions</dt><dd>{info.runs.length}</dd>
          <dt>Agents seen</dt><dd>{info.providers.map((id) => PROVIDER_NAMES[id] || id).join(', ') || 'None yet'}</dd>
          <dt>Last activity</dt><dd>{info.latest ? formatDate(info.latest.updatedAt || info.latest.startedAt) : 'No sessions'}</dd>
        </dl>
        <h3>Recent sessions</h3>
        {info.runs.length ? <ul className="repo-recent">{[...info.runs].sort((a, b) => Date.parse(b.updatedAt || b.startedAt) - Date.parse(a.updatedAt || a.startedAt)).slice(0, 5).map((run) => <li key={run.id}><i className={`status-dot ${statusTone(run.status)}`} /><span>{run.name}</span><small>{PROVIDER_NAMES[run.provider] || run.provider}</small></li>)}</ul> : <p className="table-empty">No sessions recorded for this repository yet.</p>}
      </aside>}
    </div>
  </PageShell>;
}

import { useState } from 'react';
import { Check, FolderOpen, Play } from '@phosphor-icons/react';
import { api } from '../../../shared/api/client';
import { statusLabel } from '../../../shared/lib/metrics';

export function PageShell({ eyebrow, title, description, children }) {
  return <main className="workspace-page"><header className="page-header"><div>{eyebrow && <span>{eyebrow}</span>}<h1>{title}</h1><p>{description}</p></div></header><div className="page-scroll">{children}</div></main>;
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

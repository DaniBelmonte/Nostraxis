import { useState } from 'react';
import { Check, FolderOpen, Play, Plus, X } from '@phosphor-icons/react';
import { api } from '../../../shared/api/client';
import { statusLabel } from '../../../shared/lib/metrics';
import { FolderBrowserDialog } from '../../../shared/components/FolderBrowserDialog';

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

export function RepositoriesView({ repositories, workProjects = [], workItems = [], hiddenWorkProjectPaths = [], onViewSessions, onViewWorkItemSessions, onAnalyze, onManageSources, reload, setError }) {
  const [path, setPath] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectFolder, setProjectFolder] = useState('');
  const [projectExtraFolders, setProjectExtraFolders] = useState([]);
  const [busy, setBusy] = useState(false);
  const [pathError, setPathError] = useState('');
  const [projectFolderError, setProjectFolderError] = useState('');
  const [workspacePaths, setWorkspacePaths] = useState({});
  const [workspaceErrors, setWorkspaceErrors] = useState({});
  const [folderDialog, setFolderDialog] = useState(null);
  const [itemDrafts, setItemDrafts] = useState({});
  const createItem = async (event, project) => {
    event.preventDefault();
    const draft = itemDrafts[project.id] || {};
    if (!draft.title?.trim()) return;
    setBusy(true);
    try { await api.createWorkItem({ projectId: project.id, kind: draft.kind || 'task', title: draft.title.trim() }); setItemDrafts((current) => ({ ...current, [project.id]: { kind: draft.kind || 'task', title: '' } })); await reload(); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  };
  const removeItem = async (item) => {
    if (!window.confirm(`Remove ${item.kind}: ${item.title}? Sessions will return to Unassigned in this project.`)) return;
    setBusy(true);
    try { await api.removeWorkItem(item.id); await reload(); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  };
  const submit = async (event) => {
    event.preventDefault();
    const requestedPath = path.trim();
    if (!requestedPath) { setPathError('Enter the absolute repository path.'); return; }
    setBusy(true); setPathError('');
    try { await api.addRepository(requestedPath); setPath(''); await reload(); }
    catch (reason) { setPathError(reason.message); setError(reason.message); }
    finally { setBusy(false); }
  };
  const createProject = async (event) => {
    event.preventDefault();
    const folderPath = projectFolder.trim();
    if (!folderPath) { setProjectFolderError('Choose a folder for this work project.'); return; }
    setBusy(true); setProjectFolderError('');
    try {
      await api.createWorkProject({ name: projectName, folderPaths: [folderPath, ...projectExtraFolders] });
      setProjectName(''); setProjectFolder(''); setProjectExtraFolders([]);
      try { await reload(); }
      catch (error) { setError(`Project created, but the list could not refresh: ${error.message}`); }
    } catch (error) {
      const message = error.message === 'API route not found.' ? 'The local server is out of date. Restart Nostraxis and try again.' : error.message;
      setProjectFolderError(message); setError(message);
    }
    finally { setBusy(false); }
  };
  const selectProjectFolder = async (folderPath) => {
    setProjectFolder(folderPath);
    setProjectFolderError('');
    if (!projectName.trim()) setProjectName(folderPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'New work project');
  };
  const selectExtraProjectFolder = async (folderPath) => {
    if (folderPath === projectFolder || projectExtraFolders.includes(folderPath)) return;
    setProjectExtraFolders((current) => [...current, folderPath]);
  };
  const addWorkspace = async (project, folderPath) => {
    if (!folderPath.trim()) { setWorkspaceErrors((current) => ({ ...current, [project.id]: 'Select a folder or enter its absolute path.' })); return; }
    setBusy(true); setWorkspaceErrors((current) => ({ ...current, [project.id]: '' }));
    try {
      await api.addWorkProjectFolder(project.id, folderPath.trim());
      setWorkspacePaths((current) => ({ ...current, [project.id]: '' }));
      await reload();
    } catch (error) { setWorkspaceErrors((current) => ({ ...current, [project.id]: error.message })); }
    finally { setBusy(false); }
  };
  const selectWorkspace = async (project, folderPath) => {
    setBusy(true); setWorkspaceErrors((current) => ({ ...current, [project.id]: '' }));
    try {
      await api.addWorkProjectFolder(project.id, folderPath);
      await reload();
    } catch (error) { setWorkspaceErrors((current) => ({ ...current, [project.id]: error.message })); throw error; }
    finally { setBusy(false); }
  };
  const removeWorkspace = async (project, folderPath) => {
    if (!window.confirm(`Remove this workspace from ${project.name}? Its sessions will remain available in Nostraxis.`)) return;
    setBusy(true);
    try { await api.removeWorkProjectFolder(project.id, folderPath); await reload(); }
    catch (error) { setWorkspaceErrors((current) => ({ ...current, [project.id]: error.message })); }
    finally { setBusy(false); }
  };
  const removeProject = async (project) => {
    if (!window.confirm(`${project.source === 'detected' ? 'Hide this detected folder' : 'Remove this work project'} from Nostraxis? Its sessions will remain available.`)) return;
    setBusy(true);
    try { await api.removeWorkProject(project.id); await reload(); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  };
  const restoreFolder = async (folderPath) => {
    setBusy(true);
    try { await api.restoreWorkProjectFolder(folderPath); await reload(); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  };
  const manualProjects = workProjects.filter((project) => project.source === 'manual');
  const detectedFolders = workProjects.filter((project) => project.source === 'detected');
  const detectedRow = (project) => <div key={project.id} className="work-project-row"><div><strong>{project.name}</strong><small>Detected folder · {project.sessionCount} sessions</small><code title={project.folderPath}>{project.folderPath}</code></div><button className="toolbar-button" type="button" disabled={busy} onClick={() => removeProject(project)}>Hide</button></div>;
  return <PageShell eyebrow="Work organization" title="Projects" description="Organize sessions independently of their original folder. Removing a project never deletes sessions.">
    <div className="projects-layout"><div className="projects-main">
      <section className="panel-block projects-panel"><header><div><span>Work projects</span><h2>{manualProjects.length} user-created · {detectedFolders.length} detected</h2></div></header>
        <div className="projects-panel-body"><div className="project-create-intro"><h3>Create a work project</h3><p>Start with one workspace folder. You can add more workspaces or assign individual sessions later. Missing sessions? Configure the agent’s history path in <button type="button" onClick={onManageSources}>Settings</button>.</p></div>
          <form className="work-project-form" onSubmit={createProject}>
            <label>Project name<input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="e.g. Strava MCP" maxLength={100} required /></label>
            <div className="work-project-folder-field"><label htmlFor="work-project-folder">Workspace folders</label><div className="work-project-folder-control"><input id="work-project-folder" value={projectFolder} onChange={(event) => { setProjectFolder(event.target.value); setProjectFolderError(''); }} placeholder="No folder selected" required aria-invalid={Boolean(projectFolderError)} aria-describedby="work-project-folder-help" /><button className="secondary-button" type="button" disabled={busy} onClick={() => setFolderDialog({ kind: 'create', initialPath: projectFolder })}><FolderOpen /> Select folder</button></div><small id="work-project-folder-help" className={projectFolderError ? 'form-error' : 'repo-field-hint'}>{projectFolderError || 'Select a folder or enter an absolute path. Matching sessions join automatically.'}</small>{projectExtraFolders.map((folderPath) => <div className="project-create-extra" key={folderPath}><code>{folderPath}</code><button type="button" aria-label={`Remove ${folderPath}`} onClick={() => setProjectExtraFolders((current) => current.filter((item) => item !== folderPath))}><X /></button></div>)}<button className="secondary-button project-create-more" type="button" disabled={busy || !projectFolder.trim()} onClick={() => setFolderDialog({ kind: 'create-add', initialPath: projectExtraFolders.at(-1) || projectFolder })}><Plus /> Add another folder</button></div>
            <div className="project-create-actions"><button className="primary-button" disabled={busy || !projectName.trim() || !projectFolder.trim()}>Create work project</button></div>
          </form>
        </div>
        <div className="project-collection"><div className="project-collection-heading"><h3>Your work projects</h3><span>{manualProjects.length}</span></div>
          {manualProjects.length ? manualProjects.map((project) => {
            const folderPaths = project.folderPaths || (project.folderPath ? [project.folderPath] : []);
            return <article className="project-card" key={project.id}><div className="project-card-top"><div><h4>{project.name}</h4><p>{project.sessionCount} {project.sessionCount === 1 ? 'session' : 'sessions'} · {folderPaths.length} {folderPaths.length === 1 ? 'workspace' : 'workspaces'}</p></div><div className="project-card-controls"><button className="project-view-button" type="button" disabled={!project.sessionCount} onClick={() => onViewSessions(project.id)}>View sessions</button><button className="project-view-button" type="button" disabled={!project.sessionCount} onClick={() => onAnalyze({ projectId: project.id }, `${project.name} · Project analysis`)}>Analyze</button><button className="project-remove-button" type="button" disabled={busy} onClick={() => removeProject(project)}>Remove project</button></div></div>
              <div className="project-workspace-list">{folderPaths.length ? folderPaths.map((folderPath) => <div className="project-workspace" key={folderPath}><FolderOpen /><code title={folderPath}>{folderPath}</code><button type="button" title="Remove workspace" aria-label={`Remove workspace ${folderPath}`} disabled={busy} onClick={() => removeWorkspace(project, folderPath)}><X /></button></div>) : <p>No workspace folders yet. Sessions can still be assigned manually.</p>}</div>
              <div className="project-workspace-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => setFolderDialog({ kind: 'add', project, initialPath: project.folderPaths?.[0] || '' })}><Plus /> Select folder to add workspace</button><details><summary>Enter path manually</summary><form onSubmit={(event) => { event.preventDefault(); addWorkspace(project, workspacePaths[project.id] || ''); }}><label htmlFor={`workspace-path-${project.id}`}>Absolute folder path</label><div><input id={`workspace-path-${project.id}`} value={workspacePaths[project.id] || ''} onChange={(event) => { setWorkspacePaths((current) => ({ ...current, [project.id]: event.target.value })); setWorkspaceErrors((current) => ({ ...current, [project.id]: '' })); }} placeholder="/Users/me/workspace" /><button className="toolbar-button" disabled={busy || !(workspacePaths[project.id] || '').trim()}>Add</button></div></form></details></div>
              <div className="project-items"><div className="project-items-heading"><strong>Work items</strong><span>{workItems.filter((item) => item.projectId === project.id).length}</span></div><button type="button" className="project-item-row" onClick={() => onViewWorkItemSessions(project.id, 'unassigned')}><span>Unassigned</span><small>{project.sessionCount - workItems.filter((item) => item.projectId === project.id).reduce((sum, item) => sum + item.sessionCount, 0)} sessions</small></button>{workItems.filter((item) => item.projectId === project.id).map((item) => <div className="project-item-row" key={item.id}><button type="button" onClick={() => onViewWorkItemSessions(project.id, item.id)}><span>{item.kind}: {item.title}</span><small>{item.sessionCount} sessions</small></button><button type="button" title="Analyze work item" onClick={() => onAnalyze({ workItemId: item.id }, `${item.title} · Work item analysis`)}>Analyze</button><button type="button" title="Remove work item" onClick={() => removeItem(item)}>×</button></div>)}<form className="project-item-create" onSubmit={(event) => createItem(event, project)}><select aria-label={`Work item type for ${project.name}`} value={itemDrafts[project.id]?.kind || 'task'} onChange={(event) => setItemDrafts((current) => ({ ...current, [project.id]: { ...current[project.id], kind: event.target.value } }))}>{['feature','task','bug','research'].map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select><input aria-label={`New work item title for ${project.name}`} placeholder="New work item title" maxLength={160} value={itemDrafts[project.id]?.title || ''} onChange={(event) => setItemDrafts((current) => ({ ...current, [project.id]: { ...current[project.id], title: event.target.value } }))} /><button type="submit" disabled={busy || !itemDrafts[project.id]?.title?.trim()}>Add</button></form></div>
              {workspaceErrors[project.id] && <p className="project-workspace-error" role="alert">{workspaceErrors[project.id]}</p>}
            </article>;
          }) : <div className="project-empty"><FolderOpen /><strong>No work projects yet</strong><p>Create one above to organize workspaces and sessions in one place.</p></div>}
        </div>
        {!!detectedFolders.length && <details className="detected-folders"><summary>Detected folders ({detectedFolders.length}) <span>Review or hide suggestions</span></summary><div className="work-project-list">{detectedFolders.map(detectedRow)}</div></details>}
      </section>
      {!!hiddenWorkProjectPaths.length && <section className="panel-block projects-panel"><header><div><span>Hidden folders</span><h2>{hiddenWorkProjectPaths.length} excluded from project navigation</h2></div></header><div className="projects-panel-body work-project-list">{hiddenWorkProjectPaths.map((folderPath) => <div key={folderPath} className="work-project-row"><code title={folderPath}>{folderPath}</code><button className="toolbar-button" type="button" disabled={busy} onClick={() => restoreFolder(folderPath)}>Show again</button></div>)}</div></section>}
    </div><aside className="projects-side"><section className="panel-block projects-panel"><header><div><span>Code sources</span><h2>Registered repositories · {repositories.length}</h2></div></header><div className="projects-panel-body"><p className="project-side-intro">Connect code repositories for managed runs. Workspaces above only organize sessions.</p><button className="secondary-button project-repo-picker" disabled={busy} onClick={async () => { setBusy(true); try { const result = await api.pickRepository(); if (result.path) { await api.addRepository(result.path); await reload(); } } catch (error) { setError(error.message); } finally { setBusy(false); } }}><FolderOpen /> Select repository folder</button><details className="project-repo-manual"><summary>Enter path manually</summary><form className="repo-form" onSubmit={submit}><label>Absolute path<input value={path} onChange={(event) => { setPath(event.target.value); setPathError(''); }} placeholder="/Users/me/code/my-repo" required aria-invalid={Boolean(pathError)} aria-describedby="repository-path-help" /><small id="repository-path-help" className={pathError ? 'form-error' : 'repo-field-hint'}>{pathError || 'Paste a local absolute path.'}</small></label><button className="primary-button" disabled={busy || !path.trim()}>{busy ? 'Inspecting…' : 'Register'}</button></form></details></div><div className="repo-grid">{repositories.map((repo) => <article key={repo.id}><FolderOpen /><div><h3>{repo.name}</h3><code title={repo.path}>{repo.path}</code></div><dl><dt>Branch</dt><dd>{repo.branch || 'Not reported'}</dd><dt>HEAD</dt><dd><code>{repo.headSha?.slice(0, 12) || 'Not available'}</code></dd></dl></article>)}</div></section></aside></div>
    {folderDialog && <FolderBrowserDialog initialPath={folderDialog.initialPath} onClose={() => setFolderDialog(null)} onSelect={(folderPath) => folderDialog.kind === 'create' ? selectProjectFolder(folderPath) : folderDialog.kind === 'create-add' ? selectExtraProjectFolder(folderPath) : selectWorkspace(folderDialog.project, folderPath)} />}
  </PageShell>;
}

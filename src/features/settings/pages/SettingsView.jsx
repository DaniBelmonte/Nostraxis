import { useState } from 'react';
import { CaretDown, FolderOpen, Plus } from '@phosphor-icons/react';
import { api } from '../../../shared/api/client';
import { FolderBrowserDialog } from '../../../shared/components/FolderBrowserDialog';
import { PageShell } from '../../workspace/pages/WorkspaceViews';

const sections = [
  { id: 'sources', label: 'Session sources', description: 'Local history Nostraxis reads automatically.' },
  { id: 'providers', label: 'Provider adapters', description: 'Installed agents and the data they expose.' },
  { id: 'metrics', label: 'Metric definitions', description: 'How dashboard values are measured and sourced.' },
];
const sourceTypes = [
  { value: 'codex:provider-log', label: 'Codex history', kind: 'folder' },
  { value: 'claude:provider-log', label: 'Claude Code history', kind: 'folder' },
  { value: 'copilot:provider-log', label: 'GitHub Copilot CLI / Agent', kind: 'folder' },
  { value: 'copilot:vscode-chat', label: 'VS Code Copilot Chat', kind: 'folder' },
  { value: 'copilot:copilot-otel', label: 'GitHub Copilot OpenTelemetry', kind: 'file' },
  { value: 'hermes:hermes-sqlite', label: 'Hermes Agent', kind: 'file' },
];

function SettingsSource({ source, onRemove, busy }) {
  const status = source.available ? 'Connected' : 'Not detected';
  return <article className="settings-item">
    <div className="settings-item-heading"><div className="settings-item-name"><span className={`status-dot ${source.available ? 'live' : 'warning'}`} /><h3>{source.label || source.provider}</h3></div><span className={`settings-state ${source.available ? 'is-connected' : 'is-missing'}`}>{status}</span></div>
    <p className="settings-item-summary">{source.available ? `${source.count} recent ${source.format === 'hermes-sqlite' ? 'sessions' : 'logs'}` : 'No history found at this location'}</p>
    {source.custom && <button className="settings-source-remove" type="button" disabled={busy} onClick={() => onRemove(source)}>Remove custom source</button>}
    <details className="settings-details"><summary>Source details <CaretDown /></summary><div><span>Local path</span><code>{source.root || 'Not reported'}</code><span>Sync</span><p>{source.error || (source.available ? 'Automatic, every 3 seconds' : 'Starts when the source becomes available')}</p></div></details>
  </article>;
}

function SettingsProvider({ provider }) {
  const capabilities = provider.capabilities || {};
  return <article className="settings-item">
    <div className="settings-item-heading"><div className="settings-item-name"><span className={`status-dot ${provider.available ? 'live' : 'warning'}`} /><h3>{provider.name}</h3></div><span className={`settings-state ${provider.available ? 'is-connected' : 'is-missing'}`}>{provider.available ? 'Available' : 'Unavailable'}</span></div>
    <p className="settings-item-summary">{capabilities.managedRuns === false ? 'Observed history only' : 'Managed runs supported'}</p>
    <div className="settings-capabilities" aria-label={`${provider.name} capabilities`}><span className={capabilities.usage ? 'supported' : ''}>Tokens {capabilities.usage ? 'available' : 'unavailable'}</span><span className={capabilities.reasoning ? 'supported' : ''}>Reasoning {capabilities.reasoning ? 'available' : 'unavailable'}</span><span className={capabilities.cost ? 'supported' : ''}>Cost {capabilities.cost ? 'available' : 'unavailable'}</span></div>
    <details className="settings-details"><summary>Adapter details <CaretDown /></summary><div><span>Version</span><p>{provider.version || 'Not reported'}</p>{provider.error && <><span>Error</span><p>{provider.error}</p></>}</div></details>
  </article>;
}

export function SettingsView({ data, reload }) {
  const [activeSection, setActiveSection] = useState('sources');
  const [sourceType, setSourceType] = useState(sourceTypes[0].value);
  const [sourceRoot, setSourceRoot] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sourceFolderDialog, setSourceFolderDialog] = useState(false);
  const sources = data.sessionSources || [];
  const providers = data.providers || [];
  const metrics = data.metricDefinitions || [];
  const availableSources = sources.filter((source) => source.available).length;
  const availableProviders = providers.filter((provider) => provider.available).length;
  const selected = sections.find((section) => section.id === activeSection);
  const selectedSourceType = sourceTypes.find((item) => item.value === sourceType);
  const addSource = async (event) => {
    event.preventDefault();
    setBusy(true); setSourceError('');
    try {
      const [provider, format] = sourceType.split(':');
      await api.addSessionSource({ provider, format, root: sourceRoot.trim() });
      setSourceRoot('');
      await reload();
    } catch (error) { setSourceError(error.message); }
    finally { setBusy(false); }
  };
  const removeSource = async (source) => {
    setBusy(true); setSourceError('');
    try { await api.removeSessionSource(source); await reload(); }
    catch (error) { setSourceError(error.message); }
    finally { setBusy(false); }
  };

  return <PageShell eyebrow="Local observability" title="Settings" description="See where sessions come from, which agents are available, and what each metric means.">
    <div className="settings-overview" aria-label="Observability summary">
      <div><span>Imported sessions</span><strong>{data.externalSessionCount ?? '—'}</strong></div>
      <div><span>Connected sources</span><strong>{availableSources}<small> / {sources.length}</small></strong></div>
      <div><span>Available adapters</span><strong>{availableProviders}<small> / {providers.length}</small></strong></div>
    </div>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings sections">{sections.map((section) => <button key={section.id} type="button" className={activeSection === section.id ? 'active' : ''} aria-current={activeSection === section.id ? 'page' : undefined} onClick={() => setActiveSection(section.id)}><span>{section.label}</span><small>{section.id === 'sources' ? sources.length : section.id === 'providers' ? providers.length : metrics.length}</small></button>)}</nav>
      <section className="settings-content" aria-labelledby="settings-section-title">
        <header><div><span>Configuration overview</span><h2 id="settings-section-title">{selected.label}</h2><p>{selected.description}</p></div></header>
        {activeSection === 'sources' && <><form className="settings-source-form" onSubmit={addSource}><div><h3>Add session history</h3><p>Select the folder where an agent stores its logs. This is usually different from the work project folder. Imported sessions are then grouped by their workspace.</p></div><label>Source type<select value={sourceType} onChange={(event) => { setSourceType(event.target.value); setSourceRoot(''); setSourceError(''); }}>{sourceTypes.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label><label>History {selectedSourceType.kind}<div className="settings-source-path"><input value={sourceRoot} onChange={(event) => { setSourceRoot(event.target.value); setSourceError(''); }} placeholder={selectedSourceType.kind === 'file' ? 'Absolute path to the history file' : 'No folder selected'} required />{selectedSourceType.kind === 'folder' && <button className="secondary-button" type="button" disabled={busy} onClick={() => setSourceFolderDialog(true)}><FolderOpen /> Select folder</button>}</div></label><div className="settings-source-submit"><button className="primary-button" disabled={busy || !sourceRoot.trim()}><Plus /> Add and sync source</button><small>{selectedSourceType.kind === 'file' ? 'Enter the absolute path to the SQLite or OpenTelemetry file.' : 'Choose the provider history folder, not your code workspace.'}</small></div>{sourceError && <p className="form-error" role="alert">{sourceError}</p>}</form><div className="settings-list">{sources.length ? sources.map((source) => <SettingsSource key={`${source.provider}:${source.format || 'provider-log'}:${source.root}`} source={source} onRemove={removeSource} busy={busy} />) : <p className="settings-empty">No local session sources are configured.</p>}</div></>}
        {activeSection === 'providers' && <div className="settings-list">{providers.length ? providers.map((provider) => <SettingsProvider key={provider.id} provider={provider} />) : <p className="settings-empty">No provider adapters were found.</p>}</div>}
        {activeSection === 'metrics' && <div className="settings-list">{metrics.length ? metrics.map((metric) => <article key={metric.id} className="settings-metric"><div><h3>{metric.label}</h3><code>{metric.id}</code></div><div className="settings-metric-meta"><span>{metric.unit}</span><small>Source: {metric.source}</small></div></article>) : <p className="settings-empty">No metric definitions are available.</p>}</div>}
      </section>
    </div>
    {sourceFolderDialog && <FolderBrowserDialog initialPath={sourceRoot} eyebrow="Session history" description="Choose the folder containing this provider’s session history. Add the source to import its sessions into Nostraxis." onClose={() => setSourceFolderDialog(false)} onSelect={async (folderPath) => { setSourceRoot(folderPath); setSourceError(''); }} />}
  </PageShell>;
}

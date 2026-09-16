import { useEffect, useRef, useState } from 'react';
import {
  ActivityIcon as Activity, ArrowsOut, ChartBar, Code, Flask, FolderOpen, Robot,
  SlidersHorizontal, X,
} from '@phosphor-icons/react';
import { api } from './api';
import { ContextPane, MainTrace, SessionsPane } from './SessionsView';
import { ProviderUsageDock } from './ProviderUsageDock';
import { AnalyticsView, CompareView, LabView, RepositoriesView, SettingsView } from './WorkspaceViews';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';

const navItems = (experimentsEnabled) => [
  ['Sessions', Activity], ['Analytics', ChartBar], ['Compare', ArrowsOut],
  ...(experimentsEnabled ? [['R&D Lab', Flask]] : []),
  ['Repos', FolderOpen], ['Settings', SlidersHorizontal],
];

function useDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const timer = useRef(null);
  const reload = async () => {
    try { setData(await api.dashboard()); setError(''); }
    catch (reason) { setError(reason.message); }
  };
  useEffect(() => {
    reload();
    const stream = new EventSource('/api/stream');
    stream.onmessage = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(reload, 180);
    };
    return () => { clearTimeout(timer.current); stream.close(); };
  }, []);
  return { data, error, reload };
}

function AppRail({ active, onChange, online, experimentsEnabled }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(interval);
  }, []);
  const currentTime = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(now);
  return <nav className="app-rail">
    <div className="wordmark"><strong>Nostra</strong><strong>xis</strong></div>
    <div className="rail-items">{navItems(experimentsEnabled).map(([label, Icon]) => <button key={label} aria-label={label} title={label} className={active === label ? 'active' : ''} onClick={() => onChange(label)}><Icon weight={active === label ? 'duotone' : 'regular'} /><span>{label}</span></button>)}</div>
    <div className="system-state"><span><i className={online ? '' : 'offline'} /> Current time</span><strong>{currentTime}</strong></div>
  </nav>;
}

function Modal({ title, onClose, children }) {
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
      <header><h2>{title}</h2><button onClick={onClose} aria-label="Close"><X /></button></header>
      {children}
    </section>
  </div>;
}

function NewRunForm({ data, onCreated, onError }) {
  const available = data.providers.find((provider) => provider.available)?.id || 'custom';
  const [form, setForm] = useState({
    repositoryId: data.repositories[0]?.id || '', provider: available, model: '',
    name: 'Developer task', prompt: 'Inspect the repository and identify the smallest safe optimization.',
    allowWrites: false, allowShell: true, executable: '',
  });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    try { onCreated(await api.createRun(form)); }
    catch (reason) { onError(reason.message); }
  };
  return <form className="modal-form" onSubmit={submit}>
    <label>Repository<select value={form.repositoryId} onChange={(event) => update('repositoryId', event.target.value)}>{data.repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label>
    <label>Provider<select value={form.provider} onChange={(event) => update('provider', event.target.value)}>{data.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}{provider.available ? '' : ' · not detected'}</option>)}</select></label>
    <label>Model<input value={form.model} onChange={(event) => update('model', event.target.value)} placeholder="empty = provider default" /></label>
    {form.provider === 'custom' && <label>JSONL executable<input value={form.executable} onChange={(event) => update('executable', event.target.value)} placeholder="/absolute/path/to/runner" /></label>}
    <label>Name<input value={form.name} onChange={(event) => update('name', event.target.value)} /></label>
    <label>Goal<textarea value={form.prompt} onChange={(event) => update('prompt', event.target.value)} /></label>
    <div className="permission-row"><label><input type="checkbox" checked={form.allowShell} onChange={(event) => update('allowShell', event.target.checked)} /> Commands</label><label><input type="checkbox" checked={form.allowWrites} onChange={(event) => update('allowWrites', event.target.checked)} /> Writes</label></div>
    <button className="primary-button" disabled={!form.repositoryId}>Create session</button>
  </form>;
}

export function App() {
  const { data, error: loadError, reload } = useDashboard();
  const [activeNav, setActiveNav] = useState('Sessions');
  const [selectedSession, setSelectedSession] = useState('');
  const [detail, setDetail] = useState(null);
  const [paused, setPaused] = useState(false);
  const [contextTab, setContextTab] = useState('knowledge');
  const [modal, setModal] = useState(null);
  const [rawEvent, setRawEvent] = useState(null);
  const [actionError, setActionError] = useState('');
  const [contextPaneWidth, setContextPaneWidth] = useState(null);
  const shellRef = useRef(null);

  useEffect(() => {
    if (!selectedSession && data?.runs?.length) setSelectedSession(data.runs[0].id);
  }, [data, selectedSession]);
  useEffect(() => {
    if (selectedSession) api.run(selectedSession).then(setDetail).catch((reason) => setActionError(reason.message));
  }, [selectedSession, data?.generatedAt]);

  const inspect = (id) => { setSelectedSession(id); setActiveNav('Sessions'); };
  const cancel = async () => {
    try { await api.cancelRun(selectedSession); await reload(); }
    catch (reason) { setActionError(reason.message); }
  };
  const setError = (message) => {
    setActionError(message);
    setTimeout(() => setActionError(''), 5000);
  };
  const constrainContextPaneWidth = (width) => {
    const shell = shellRef.current;
    if (!shell) return Math.max(300, Math.min(760, width));
    const railWidth = shell.querySelector('.app-rail')?.getBoundingClientRect().width || 68;
    const sessionsWidth = shell.querySelector('.sessions-pane')?.getBoundingClientRect().width || 270;
    const minimumTraceWidth = window.innerWidth > 1320 ? 480 : 420;
    const maximum = Math.max(300, Math.min(760, shell.clientWidth - railWidth - sessionsWidth - minimumTraceWidth));
    return Math.max(300, Math.min(maximum, Math.round(width)));
  };
  const resizeContextPane = (clientX) => {
    const shell = shellRef.current;
    if (!shell) return;
    setContextPaneWidth(constrainContextPaneWidth(shell.getBoundingClientRect().right - clientX));
  };
  const startContextResize = (event) => {
    if (window.innerWidth <= 1080) return;
    event.preventDefault();
    const move = (pointerEvent) => resizeContextPane(pointerEvent.clientX);
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  };
  const adjustContextPane = (amount) => {
    const measuredWidth = shellRef.current?.querySelector('.context-pane')?.getBoundingClientRect().width || 392;
    setContextPaneWidth((current) => constrainContextPaneWidth((current ?? measuredWidth) + amount));
  };

  if (!data) return <div className="boot-screen"><Robot weight="duotone" /><h1>Nostraxis</h1><p>{loadError || 'Starting local runtime, API and SQLite…'}</p></div>;
  return <div ref={shellRef} className={`observatory-shell ${activeNav !== 'Sessions' ? 'workspace-shell' : ''}`} style={contextPaneWidth ? { '--context-pane-width': `${contextPaneWidth}px` } : undefined}>
    <AppRail active={activeNav} onChange={setActiveNav} online={!loadError} experimentsEnabled={data.features?.experiments === true} />
    <ProviderUsageDock initial={data.providerUsage} />
    {activeNav === 'Sessions' && <>
      <SessionsPane runs={data.runs} sources={data.sessionSources || []} externalSessionCount={data.externalSessionCount || 0} selected={selectedSession} onSelect={setSelectedSession} onNewSession={() => setModal('new')} onSync={async () => { await api.syncSessions(); await reload(); }} />
      <MainTrace detail={detail} hasRuns={data.runs.length > 0} paused={paused} onPause={() => setPaused((value) => !value)} onCancel={cancel} onCompare={() => setActiveNav('Compare')} onRawEvent={setRawEvent} onEmptyAction={() => setActiveNav('Repos')} />
      <ContextPane detail={detail} tab={contextTab} onTab={setContextTab} contextWidth={contextPaneWidth ?? 392} onResizeStart={startContextResize} onResizeKeyDown={adjustContextPane} />
    </>}
    {activeNav === 'Analytics' && <AnalyticsView initial={data.analytics} repositories={data.repositories} onInspect={inspect} />}
    {activeNav === 'Compare' && <CompareView runs={data.runs} focusId={selectedSession} onInspect={inspect} />}
    {data.features?.experiments === true && activeNav === 'R&D Lab' && <LabView data={data} reload={reload} setError={setError} />}
    {activeNav === 'Repos' && <RepositoriesView repositories={data.repositories} reload={reload} setError={setError} />}
    {activeNav === 'Settings' && <SettingsView data={data} />}

    {actionError && <div className="toast-error"><WarningIcon />{actionError}<button onClick={() => setActionError('')}><X /></button></div>}
    {modal === 'new' && <Modal title="New session" onClose={() => setModal(null)}><NewRunForm data={data} onError={setError} onCreated={(run) => { setSelectedSession(run.id); setModal(null); reload(); }} /></Modal>}
    {rawEvent && <Modal title="Raw event" onClose={() => setRawEvent(null)}><pre className="raw-event">{JSON.stringify(rawEvent, null, 2)}</pre></Modal>}
  </div>;
}

function WarningIcon() {
  return <Code weight="duotone" />;
}

import { useEffect, useRef, useState } from 'react';
import { Code, Robot, X } from '@phosphor-icons/react';
import { api } from '../shared/api/client';
import { ContextPane, MainTrace, NewRunForm, SessionsPane } from '../features/sessions';
import { ProviderUsageDock } from '../features/provider-usage';
import { AnalyticsView } from '../features/analytics';
import { CompareView } from '../features/compare';
import { LabView } from '../features/experiments';
import { RepositoriesView } from '../features/repositories';
import { SettingsView } from '../features/settings';
import { SelectionAnalysisView } from '../features/analysis/pages/SelectionAnalysisView';
import { AppRail } from './components/AppRail';
import { Modal } from './components/Modal';
import { useDashboard } from './hooks/useDashboard';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';

export function App() {
  const { data, error: loadError, reload } = useDashboard();
  const [activeNav, setActiveNav] = useState('Sessions');
  const [sessionProjectId, setSessionProjectId] = useState('all');
  const [selectedSession, setSelectedSession] = useState('');
  const [selectedSessionIds, setSelectedSessionIds] = useState([]);
  const [isSessionSelectionEnabled, setIsSessionSelectionEnabled] = useState(false);
  const [sessionWorkItemId, setSessionWorkItemId] = useState('all');
  const [analysisTarget, setAnalysisTarget] = useState(null);
  const [compareIds, setCompareIds] = useState(null);
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
    if (!data?.runs) return;
    const available = new Set(data.runs.map((run) => run.id));
    setSelectedSessionIds((current) => current.every((id) => available.has(id)) ? current : current.filter((id) => available.has(id)));
  }, [data?.runs]);
  useEffect(() => {
    if (selectedSession) api.run(selectedSession).then(setDetail).catch((reason) => setActionError(reason.message));
  }, [selectedSession, data?.generatedAt]);

  const inspect = (id) => { setSelectedSession(id); setActiveNav('Sessions'); };
  const openAnalysis = (request, title) => { setAnalysisTarget({ request, title, returnNav: activeNav }); setActiveNav('Selection analysis'); };
  const viewProjectSessions = (projectId) => {
    setSessionProjectId(projectId);
    setSessionWorkItemId('all');
    const firstSession = data.runs.find((run) => run.workProjectIds?.includes(projectId));
    if (firstSession) setSelectedSession(firstSession.id);
    setActiveNav('Sessions');
  };
  const viewWorkItemSessions = (projectId, workItemId) => { viewProjectSessions(projectId); setSessionWorkItemId(workItemId); };
  const toggleSession = (id) => setSelectedSessionIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleSessionSelection = () => {
    if (isSessionSelectionEnabled) setSelectedSessionIds([]);
    setIsSessionSelectionEnabled((current) => !current);
  };
  const moveSelection = async (projectId, workItemId = null) => {
    await api.moveSessions(selectedSessionIds, projectId, workItemId);
    setSelectedSessionIds([]); await reload();
  };
  const assignSelectionItem = async (workItemId) => { await api.assignWorkItemRuns(selectedSessionIds, workItemId); setSelectedSessionIds([]); await reload(); };
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
  const selectedRun = data.runs.find((run) => run.id === selectedSession);
  const displayedDetail = detail?.run?.id === selectedSession && selectedRun
    ? { ...detail, run: { ...detail.run, workProjectId: selectedRun.workProjectId, workProjectName: selectedRun.workProjectName, workProjectIds: selectedRun.workProjectIds, workProjectNames: selectedRun.workProjectNames, workItemName: selectedRun.workItemName } }
    : detail;
  return <div ref={shellRef} className={`observatory-shell ${activeNav !== 'Sessions' ? 'workspace-shell' : ''}`} style={contextPaneWidth ? { '--context-pane-width': `${contextPaneWidth}px` } : undefined}>
    <AppRail active={activeNav} onChange={setActiveNav} online={!loadError} experimentsEnabled={data.features?.experiments === true} />
    <ProviderUsageDock initial={data.providerUsage} />
    {activeNav === 'Sessions' && <>
      <SessionsPane runs={data.runs} workProjects={data.workProjects || []} workItems={data.workItems || []} projectId={sessionProjectId} onProjectChange={(value) => { setSessionProjectId(value); setSessionWorkItemId('all'); }} workItemId={sessionWorkItemId} onWorkItemChange={setSessionWorkItemId} sources={data.sessionSources || []} externalSessionCount={data.externalSessionCount || 0} selected={selectedSession} onSelect={setSelectedSession} selectionEnabled={isSessionSelectionEnabled} onToggleSelection={toggleSessionSelection} selectedIds={selectedSessionIds} onToggleSelect={toggleSession} onSelectVisible={(ids) => setSelectedSessionIds(ids)} onClearSelection={() => setSelectedSessionIds([])} onMoveSelection={moveSelection} onAssignSelectionItem={assignSelectionItem} onAnalyzeSelection={() => openAnalysis({ runIds: selectedSessionIds }, `Selection analysis · ${selectedSessionIds.length} sessions`)} onCompareSelection={() => { setCompareIds(selectedSessionIds.slice(0, 4)); setActiveNav('Compare'); }} onManageProjects={() => setActiveNav('Projects')} onNewSession={() => setModal('new')} onSync={async () => { await api.syncSessions(); await reload(); }} />
      <MainTrace detail={displayedDetail} hasRuns={data.runs.length > 0} paused={paused} onPause={() => setPaused((value) => !value)} onCancel={cancel} onCompare={() => setActiveNav('Compare')} onRawEvent={setRawEvent} onEmptyAction={() => setActiveNav('Projects')} />
      <ContextPane detail={displayedDetail} tab={contextTab} onTab={setContextTab} contextWidth={contextPaneWidth ?? 392} onResizeStart={startContextResize} onResizeKeyDown={adjustContextPane} />
    </>}
    {activeNav === 'Analytics' && <AnalyticsView initial={data.analytics} repositories={data.repositories} />}
    {activeNav === 'Compare' && <CompareView runs={data.runs} focusId={selectedSession} initialIds={compareIds} onInspect={inspect} />}
    {activeNav === 'Selection analysis' && analysisTarget && <SelectionAnalysisView target={analysisTarget} onInspect={inspect} onBack={() => setActiveNav(analysisTarget.returnNav || 'Sessions')} />}
    {data.features?.experiments === true && activeNav === 'R&D Lab' && <LabView data={data} reload={reload} setError={setError} />}
    {activeNav === 'Projects' && <RepositoriesView repositories={data.repositories} workProjects={data.workProjects || []} workItems={data.workItems || []} hiddenWorkProjectPaths={data.hiddenWorkProjectPaths || []} onViewSessions={viewProjectSessions} onViewWorkItemSessions={viewWorkItemSessions} onAnalyze={openAnalysis} onManageSources={() => setActiveNav('Settings')} reload={reload} setError={setError} />}
    {activeNav === 'Settings' && <SettingsView data={data} reload={reload} />}

    {actionError && <div className="toast-error"><WarningIcon />{actionError}<button onClick={() => setActionError('')}><X /></button></div>}
    {modal === 'new' && <Modal title="New session" onClose={() => setModal(null)}><NewRunForm data={data} onError={setError} onCreated={(run) => { setSelectedSession(run.id); setModal(null); reload(); }} /></Modal>}
    {rawEvent && <Modal title="Raw event" onClose={() => setRawEvent(null)}><pre className="raw-event">{JSON.stringify(rawEvent, null, 2)}</pre></Modal>}
  </div>;
}

function WarningIcon() {
  return <Code weight="duotone" />;
}

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowsClockwise, ArrowsOut, Brain, CaretDown, CaretRight, ChartLine, Check, Code, Copy,
  Database, DownloadSimple, FileCode, FileText, FolderOpen, MagnifyingGlass,
  Pause, Play, SlidersHorizontal, TerminalWindow, Warning, X,
} from '@phosphor-icons/react';
import {
  Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { buildUsageChartPoints, compact, credits, duration, formatDate, metricsOf, money, paddedChartDomain, percent, statusLabel, statusTone } from '../../../shared/lib/metrics';
import { Conversation, CommandChart, DateRange } from '../../../shared/components/Observability';
import { SessionCard } from '../../../shared/components/SessionCard';
import { api } from '../../../shared/api/client';

const emptyFacets = () => ({ provider: {}, model: {}, state: {} });
const category = (run) => run.status === 'running' || run.status === 'queued' ? 'live' : run.status === 'completed' ? 'completed' : 'attention';

function matchesFacet(value, modes = {}) {
  const included = Object.entries(modes).filter(([, mode]) => mode === 'include').map(([key]) => key);
  return (included.length === 0 || included.includes(value)) && modes[value] !== 'exclude';
}

function FacetSection({ title, values, modes, onToggle }) {
  const [query, setQuery] = useState('');
  const shown = values.filter(([value]) => (value || 'Unknown').toLowerCase().includes(query.toLowerCase()));
  return <fieldset className="session-facet"><legend>{title}</legend>{values.length > 8 && <input className="session-facet-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Find ${title.toLowerCase()}…`} aria-label={`Find ${title.toLowerCase()}`} />}{shown.map(([value, count]) => <div className="session-facet-row" key={value}>
    <span title={value}>{value || 'Unknown'}</span><small>{count}</small>
    <button type="button" className={modes[value] === 'include' ? 'active include' : ''} onClick={() => onToggle(value, 'include')} aria-label={`Include ${title.toLowerCase()} ${value || 'unknown'}`} title="Include">+</button>
    <button type="button" className={modes[value] === 'exclude' ? 'active exclude' : ''} onClick={() => onToggle(value, 'exclude')} aria-label={`Exclude ${title.toLowerCase()} ${value || 'unknown'}`} title="Exclude">−</button>
  </div>)}</fieldset>;
}

export function SessionsPane({ runs, workProjects = [], projectId = 'all', onProjectChange, sources, externalSessionCount, selected, onSelect, onManageProjects, onAssignWorkProject, onAssignShown, onNewSession, onSync }) {
  const [scope, setScope] = useState('all');
  const [groupMode, setGroupMode] = useState('project');
  const [query, setQuery] = useState('');
  const [projectQuery, setProjectQuery] = useState('');
  const [projectOpen, setProjectOpen] = useState(false);
  const [filters, setFilters] = useState({ workload: 'All', origin: 'All', age: 'Any', cost: 'Any', cache: 'Any' });
  const [facets, setFacets] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('nostraxis.sessionFilters.v1'));
      return Object.fromEntries(['provider', 'model', 'state'].map((key) => [key, saved?.[key] && typeof saved[key] === 'object' && !Array.isArray(saved[key]) ? saved[key] : {}]));
    }
    catch { return emptyFacets(); }
  });
  const [openGroups, setOpenGroups] = useState({});
  const [syncing, setSyncing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [assignmentError, setAssignmentError] = useState('');
  const [bulkProjectId, setBulkProjectId] = useState('');
  const [dates, setDates] = useState({ from: '', to: '' });
  useEffect(() => { try { localStorage.setItem('nostraxis.sessionFilters.v1', JSON.stringify(facets)); } catch { /* Browsing without storage keeps filters for this visit. */ } }, [facets]);
  const providerIncludes = Object.entries(facets.provider).filter(([, mode]) => mode === 'include').map(([value]) => value);
  const isHermesSelected = providerIncludes.length === 1 && providerIncludes[0] === 'hermes';
  useEffect(() => {
    if (isHermesSelected) return;
    setFilters((current) => current.workload === 'All' ? current : { ...current, workload: 'All' });
    setGroupMode((current) => current === 'workload' ? 'project' : current);
  }, [isHermesSelected]);

  const updateFacet = (key, value, mode) => setFacets((current) => {
    const next = { ...current[key] };
    if (next[value] === mode) delete next[value]; else next[value] = mode;
    return { ...current, [key]: next };
  });
  const update = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const reset = () => { setQuery(''); onProjectChange('all'); setDates({ from: '', to: '' }); setFilters({ workload: 'All', origin: 'All', age: 'Any', cost: 'Any', cache: 'Any' }); setFacets(emptyFacets()); setScope('all'); };
  const facetValues = (key) => [...runs.reduce((counts, run) => { const value = run[key] || ''; counts.set(value, (counts.get(value) || 0) + 1); return counts; }, new Map())].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const baseVisible = useMemo(() => runs.filter((run) => {
    const metric = metricsOf(run);
    const search = `${run.name} ${run.id} ${run.workProjectName} ${run.repositoryName} ${run.repositoryPath} ${run.provider} ${run.model} ${run.workload} ${run.sourceKind} ${run.prompt}`.toLowerCase();
    const ageMs = Date.now() - Date.parse(run.updatedAt || run.startedAt);
    return search.includes(query.trim().toLowerCase())
      && (projectId === 'all' || (projectId === 'unassigned' ? !run.workProjectId : run.workProjectId === projectId))
      && (!dates.from || Date.parse(run.startedAt) >= new Date(`${dates.from}T00:00:00`).getTime())
      && (!dates.to || Date.parse(run.startedAt) <= new Date(`${dates.to}T23:59:59.999`).getTime())
      && matchesFacet(run.provider || '', facets.provider)
      && matchesFacet(run.model || '', facets.model)
      && matchesFacet(run.status || '', facets.state)
      && (filters.workload === 'All' || run.workload === filters.workload)
      && (filters.origin === 'All' || (filters.origin === 'External' ? run.external : !run.external))
      && (filters.age === 'Any' || ageMs <= (filters.age === '24 hours' ? 86_400_000 : filters.age === '7 days' ? 604_800_000 : 2_592_000_000))
      && (filters.cost === 'Any' || (filters.cost === '> $1' ? metric.cost > 1 : metric.cost != null && metric.cost < .5))
      && (filters.cache === 'Any' || (filters.cache === '< 40%' ? metric.cacheHit != null && metric.cacheHit < .4 : metric.cacheHit != null && metric.cacheHit > .6));
  }), [runs, query, projectId, dates, facets, filters]);
  const counts = { live: baseVisible.filter((run) => category(run) === 'live').length, attention: baseVisible.filter((run) => category(run) === 'attention').length, completed: baseVisible.filter((run) => category(run) === 'completed').length };
  const visible = scope === 'all' ? baseVisible : baseVisible.filter((run) => category(run) === scope);
  const groups = useMemo(() => {
    if (groupMode === 'none') return [{ id: 'all', label: 'Recent sessions', sessions: visible }];
    const grouped = new Map();
    for (const run of visible) {
      let id; let label;
      if (groupMode === 'project') { id = run.workProjectId || 'unassigned'; label = run.workProjectName || 'Unassigned'; }
      else if (groupMode === 'state') { id = category(run); label = { live: 'Live', attention: 'Needs attention', completed: 'Completed' }[id]; }
      else if (groupMode === 'provider') { id = run.provider || 'unknown'; label = id; }
      else if (groupMode === 'model') { id = run.model || 'unknown'; label = run.model || 'Unknown model'; }
      else { id = run.workload || 'unspecified'; label = { interactive: 'Interactive', automation: 'Automations', messaging: 'Messaging' }[id] || 'Unclassified'; }
      if (!grouped.has(id)) grouped.set(id, { id: `${groupMode}:${id}`, label, sessions: [] });
      grouped.get(id).sessions.push(run);
    }
    return [...grouped.values()];
  }, [visible, groupMode]);
  const tabs = [['all', 'All', baseVisible.length], ['live', 'Live', counts.live], ['attention', 'Attention', counts.attention], ['completed', 'Completed', counts.completed]];
  const activeFacets = Object.entries(facets).flatMap(([key, values]) => Object.entries(values).map(([value, mode]) => ({ key, value, mode })));
  const selectedProject = workProjects.find((project) => project.id === projectId);
  useEffect(() => { if (projectId !== 'all' && projectId !== 'unassigned' && !selectedProject) onProjectChange('all'); }, [projectId, selectedProject, onProjectChange]);
  const selectedRun = runs.find((run) => run.id === selected);
  const manualProjects = workProjects.filter((project) => project.source === 'manual');
  const projectResults = workProjects.filter((project) => `${project.name} ${(project.folderPaths || [project.folderPath || '']).join(' ')}`.toLowerCase().includes(projectQuery.toLowerCase()));
  const allCollapsed = groups.length > 0 && groups.every((group) => openGroups[group.id] === false);
  const availableSources = sources.filter((source) => source.available);
  const availableProviders = [...new Set(availableSources.map((source) => source.provider))];
  const sync = async () => { setSyncing(true); try { await onSync(); } finally { setSyncing(false); } };
  const assign = async (value) => {
    setAssignmentError('');
    try { await onAssignWorkProject(selected, value === 'unassigned' ? null : value); }
    catch (error) { setAssignmentError(error.message); }
  };
  const assignShown = async () => {
    if (!bulkProjectId || !visible.length || visible.length > 500) return;
    const project = manualProjects.find((item) => item.id === bulkProjectId);
    if (!project || !window.confirm(`Assign ${visible.length} shown sessions to ${project.name}?`)) return;
    setAssignmentError('');
    try { await onAssignShown(visible.map((run) => run.id), bulkProjectId); setBulkProjectId(''); }
    catch (error) { setAssignmentError(error.message); }
  };
  const toggleAllGroups = () => setOpenGroups((current) => {
    const next = { ...current };
    groups.forEach((group) => { next[group.id] = allCollapsed; });
    return next;
  });

  return <aside className="sessions-pane">
    <div className="sessions-heading"><h1>Sessions</h1><div className="sessions-heading-actions"><button className="icon-button" onClick={sync} disabled={syncing} aria-label="Sync external sessions" title="Sync external sessions"><ArrowsClockwise className={syncing ? 'spinning' : ''} /></button><button className="secondary-button" onClick={onNewSession}>+ New session</button></div></div>
    <div className="session-tabs" role="tablist">{tabs.map(([id, label, count]) => <button key={id} className={scope === id ? 'active' : ''} onClick={() => setScope(id)}>{label} <span>{count}</span></button>)}</div>
    <div className="session-source-strip"><span><i className={availableSources.length ? 'online' : ''} />{externalSessionCount} external</span><small>{availableSources.length ? `${availableProviders.join(' · ')} live` : 'No local sources detected'}</small></div>
    <div className="sessions-controls">
      <label className="search-field session-search"><MagnifyingGlass /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects, sessions, prompts…" aria-label="Search sessions" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X /></button>}</label>
      <div className="session-project-picker"><button type="button" className="session-project-trigger" onClick={() => setProjectOpen((value) => !value)} aria-expanded={projectOpen}><FolderOpen /><span>{selectedProject?.name || (projectId === 'unassigned' ? 'Unassigned' : 'All projects')}</span><CaretDown /></button><button type="button" className="session-project-manage" onClick={onManageProjects}>Manage</button></div>
      {projectOpen && <div className="session-project-menu"><input value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} placeholder="Find a project…" aria-label="Find a project" /><div className="session-project-options"><button type="button" className={projectId === 'all' ? 'active' : ''} onClick={() => { onProjectChange('all'); setProjectOpen(false); }}>All projects <small>{runs.length}</small></button><button type="button" className={projectId === 'unassigned' ? 'active' : ''} onClick={() => { onProjectChange('unassigned'); setProjectOpen(false); }}>Unassigned <small>{runs.filter((run) => !run.workProjectId).length}</small></button>{projectResults.map((project) => <button key={project.id} type="button" className={projectId === project.id ? 'active' : ''} onClick={() => { onProjectChange(project.id); setProjectOpen(false); }} title={(project.folderPaths || [project.folderPath || project.name]).join('\n')}><span><strong>{project.name}</strong><em>{project.source === 'detected' ? 'Detected folder' : 'Work project'}{project.folderPath ? ` · ${project.folderPath}` : ''}</em></span><small>{project.sessionCount}</small></button>)}</div></div>}
      <div className="session-filter-actions"><button type="button" className={`toolbar-button ${moreOpen ? 'active' : ''}`} onClick={() => setMoreOpen((value) => !value)} aria-expanded={moreOpen}><SlidersHorizontal /> Advanced filters {activeFacets.length > 0 && <span>{activeFacets.length}</span>}</button><button type="button" className="session-reset" onClick={reset}>Reset</button></div>
      {!!activeFacets.length && <div className="session-filter-chips">{activeFacets.map(({ key, value, mode }) => <button type="button" key={`${key}:${value}`} className={mode} onClick={() => updateFacet(key, value, mode)} title="Remove filter">{mode === 'exclude' ? '−' : '+'} {value || 'Unknown'} <X /></button>)}</div>}
      {moreOpen && <div className="session-advanced"><p>Include (+) or exclude (−) any combination. Your choices persist in this browser.</p><FacetSection title="Providers" values={facetValues('provider')} modes={facets.provider} onToggle={(value, mode) => updateFacet('provider', value, mode)} /><FacetSection title="Models" values={facetValues('model')} modes={facets.model} onToggle={(value, mode) => updateFacet('model', value, mode)} /><FacetSection title="Statuses" values={facetValues('status')} modes={facets.state} onToggle={(value, mode) => updateFacet('state', value, mode)} />{isHermesSelected && <label>Hermes type<select value={filters.workload} onChange={(event) => update('workload', event.target.value)}>{['All', 'interactive', 'automation', 'messaging'].map((value) => <option key={value}>{value}</option>)}</select></label>}<label>Origin<select value={filters.origin} onChange={(event) => update('origin', event.target.value)}>{['All', 'External', 'Dashboard'].map((value) => <option key={value}>{value}</option>)}</select></label><label>Updated<select value={filters.age} onChange={(event) => update('age', event.target.value)}>{['Any', '24 hours', '7 days', '30 days'].map((value) => <option key={value}>{value}</option>)}</select></label><label>Cost<select value={filters.cost} onChange={(event) => update('cost', event.target.value)}>{['Any', '> $1', '< $0.50'].map((value) => <option key={value}>{value}</option>)}</select></label><label>Cache hit<select value={filters.cache} onChange={(event) => update('cache', event.target.value)}>{['Any', '< 40%', '> 60%'].map((value) => <option key={value}>{value}</option>)}</select></label><DateRange {...dates} onChange={setDates} /></div>}
      {selectedRun && <details className="session-assignment"><summary>Assign selected session <span>{selectedRun.workProjectName || 'Unassigned'}</span></summary><label>Work project<select value={selectedRun.workProjectAssignment || 'auto'} onChange={(event) => assign(event.target.value)}><option value="auto">Automatic {selectedRun.workProjectAssignment === 'auto' && selectedRun.workProjectName ? `· ${selectedRun.workProjectName}` : ''}</option><option value="unassigned">Unassigned</option>{manualProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>{assignmentError && <small role="alert">{assignmentError}</small>}</details>}
      {!!manualProjects.length && <details className="session-assignment session-bulk"><summary>Assign shown sessions <span>{visible.length}</span></summary><p>Search and filter first, then assign the visible results together.</p><select value={bulkProjectId} onChange={(event) => setBulkProjectId(event.target.value)} aria-label="Target work project"><option value="">Choose a work project…</option>{manualProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><button className="toolbar-button" type="button" disabled={!bulkProjectId || !visible.length || visible.length > 500} onClick={assignShown}>Assign {visible.length} shown</button>{visible.length > 500 && <small>Filter to 500 sessions or fewer.</small>}</details>}
      <div className="session-list-tools"><span>{visible.length} shown</span><label>Group by<select value={groupMode} onChange={(event) => setGroupMode(event.target.value)}><option value="project">Project</option><option value="state">Status</option><option value="provider">Provider</option><option value="model">Model</option><option value="none">None</option>{isHermesSelected && <option value="workload">Hermes type</option>}</select></label><button type="button" className="icon-button" onClick={toggleAllGroups} disabled={!groups.length} aria-label={allCollapsed ? 'Expand all groups' : 'Collapse all groups'} title={allCollapsed ? 'Expand all' : 'Collapse all'}>{allCollapsed ? <CaretRight /> : <CaretDown />}</button></div>
    </div>
    <div className="session-list">{!runs.length && <div className="sessions-empty"><Database /><strong>No sessions</strong><span>Sync an agent source or start a session here.</span></div>}{runs.length > 0 && !visible.length && <div className="sessions-empty"><MagnifyingGlass /><strong>No matching sessions</strong><span>Adjust the project or filters to see more.</span><button type="button" className="toolbar-button" onClick={reset}>Reset filters</button></div>}{groups.map((group) => <section key={group.id} className="session-group"><button className="group-heading" onClick={() => setOpenGroups((current) => ({ ...current, [group.id]: current[group.id] === false }))}><span>{group.label} ({group.sessions.length})</span>{openGroups[group.id] !== false ? <CaretDown /> : <CaretRight />}</button>{openGroups[group.id] !== false && group.sessions.map((session) => <SessionCard key={session.id} session={session} selected={selected === session.id} onSelect={onSelect} />)}</section>)}</div>
  </aside>;
}

function ChartInspector({ point, mode }) {
  if (!point) return <div className="chart-inspector"><span>Move over the chart to inspect each measurement</span></div>;
  const rows = mode === 'credits'
    ? [['Cumulative credits', credits(point.credits), point.creditsDelta != null ? `+${credits(point.creditsDelta)}` : null]]
    : mode === 'cost'
    ? [['Cumulative cost', money(point.cost), point.costDelta != null ? `+${money(point.costDelta)}` : null]]
    : [
      [point.total != null ? 'Total session tokens' : 'Observed agent tokens', compact(point.displayedTokens), null],
      ['Context in use', compact(point.contextTokens), null],
      ['Cumulative input', compact(point.input), point.inputDelta != null ? `+${compact(point.inputDelta)}` : null],
      ['Cumulative output', compact(point.output), point.outputDelta != null ? `+${compact(point.outputDelta)}` : null],
    ];
  return <div className="chart-inspector" aria-live="polite"><time>{new Date(point.at).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>{rows.map(([name, value, delta]) => <span key={name}><em>{name}</em><strong>{value}</strong>{delta && <small>{delta}</small>}</span>)}</div>;
}

function CompactChartTooltip({ active, payload, mode }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const rows = mode === 'credits'
    ? [['Credits', credits(point.credits), point.creditsDelta]]
    : mode === 'cost'
    ? [['Cost', money(point.cost), point.costDelta]]
    : [
      ['Total', compact(point.displayedTokens), (point.inputDelta || 0) + (point.outputDelta || 0) || null],
      ['Context', compact(point.contextTokens), null],
      ['Input', compact(point.input), point.inputDelta],
      ['Output', compact(point.output), point.outputDelta],
    ];
  const formatDelta = (value) => mode === 'cost' ? `+${money(value)}` : mode === 'credits' ? `+${credits(value)}` : `+${compact(value)}`;
  return <div className="compact-chart-tooltip">
    <time>{new Date(point.at).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
    {rows.map(([name, value, delta]) => <div key={name}><span>{name}</span><strong>{value}</strong>{Number.isFinite(delta) && <small>{formatDelta(delta)}</small>}</div>)}
  </div>;
}

function TraceChart({ mode, detail }) {
  const [activePoint, setActivePoint] = useState(null);
  const points = buildUsageChartPoints(detail);
  const label = mode === 'tokens' ? 'tokens' : mode === 'cost' ? 'cost' : 'credits';
  const reportedPoints = points.filter((point) => mode === 'tokens'
    ? [point.input, point.output, point.contextTokens, point.observedTokens].some(Number.isFinite)
    : Number.isFinite(point[mode]));
  const fallbackPoints = points.length ? points : (detail.events || []).map((event, index) => ({
    id: event.id || `zero-${index}`,
    at: Date.parse(event.timestamp),
  })).filter((point) => Number.isFinite(point.at));
  const visiblePoints = reportedPoints.length ? reportedPoints : fallbackPoints.length ? fallbackPoints : [{ id: 'zero', at: Date.parse(detail.run.startedAt) || Date.now() }];
  const isZeroFallback = reportedPoints.length === 0;
  const chartPoints = isZeroFallback ? visiblePoints.map((point) => ({ ...point, input: 0, output: 0, contextTokens: 0, cost: 0, credits: 0 })) : visiblePoints;
  const inspectedPoint = activePoint && visiblePoints.some((point) => point.id === activePoint.id) ? activePoint : visiblePoints.at(-1);
  const spansDays = visiblePoints.length > 1 && visiblePoints.at(-1).at - visiblePoints[0].at >= 86_400_000;
  const xDomain = visiblePoints.length === 1 ? [visiblePoints[0].at - 30_000, visiblePoints[0].at + 30_000] : ['dataMin', 'dataMax'];
  const seriesName = mode === 'cost' ? 'Cumulative cost' : 'Cumulative credits';
  const seriesColor = mode === 'tokens' ? '#79bfee' : mode === 'cost' ? '#70c5ac' : '#ffbc42';
  return <section className="trace-chart-panel" aria-label={`${label} over time`}>
    <div className="chart-topbar"><div className="chart-legend">{mode === 'tokens' ? <><span><i style={{ background: '#70c5ac' }} />Context</span><span><i style={{ background: '#79bfee' }} />Input</span><span><i style={{ background: '#b680ff' }} />Output</span></> : <span><i style={{ background: seriesColor }} />{seriesName}</span>}<small>{isZeroFallback ? 'No provider usage reported · showing zero' : `${visiblePoints.length} measurements`}</small></div><ChartInspector point={inspectedPoint} mode={mode} /></div>
    <div className="chart-wrap">
    <ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartPoints} margin={{ top: 12, right: 18, left: 4, bottom: 6 }} onMouseMove={(state) => setActivePoint(state?.activePayload?.[0]?.payload || null)} onMouseLeave={() => setActivePoint(null)}>
      <defs><linearGradient id="trace-chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={mode === 'tokens' ? '#79bfee' : seriesColor} stopOpacity={.45} /><stop offset="100%" stopColor={mode === 'tokens' ? '#79bfee' : seriesColor} stopOpacity={0} /></linearGradient></defs>
      <CartesianGrid stroke="#233747" vertical strokeDasharray="0" />
      <XAxis type="number" scale="time" domain={xDomain} dataKey="at" stroke="#7590a5" tickLine={false} axisLine={{ stroke: '#314657' }} tick={{ fontSize: 10, fontFamily: 'JetBrains Mono' }} tickCount={6} minTickGap={32} tickFormatter={(value) => new Date(value).toLocaleString([], spansDays ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' })} />
      <YAxis yAxisId="left" width={54} domain={paddedChartDomain(chartPoints.flatMap((point) => mode === 'tokens' ? [point.contextTokens, point.input, point.output] : [point[mode]]).map((value) => Number.isFinite(value) ? value : 0))} stroke="#7590a5" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} tickFormatter={mode === 'cost' ? money : mode === 'credits' ? credits : compact} />
      <Tooltip content={<CompactChartTooltip mode={mode} />} cursor={{ stroke: '#557589', strokeDasharray: '3 3' }} offset={10} isAnimationActive={false} wrapperStyle={{ pointerEvents: 'none', zIndex: 4 }} />
      {mode === 'tokens'
        ? <><Area yAxisId="left" name="Input" type="stepAfter" dataKey="input" stroke="#79bfee" strokeWidth={2} fill="url(#trace-chart-fill)" dot={visiblePoints.length <= 2} isAnimationActive={false} connectNulls />
            <Line yAxisId="left" name="Context" type="stepAfter" dataKey="contextTokens" stroke="#70c5ac" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
            <Line yAxisId="left" name="Output" type="stepAfter" dataKey="output" stroke="#b680ff" strokeWidth={2} dot={visiblePoints.length <= 2} isAnimationActive={false} connectNulls /></>
        : <Area yAxisId="left" name={seriesName} type="stepAfter" dataKey={mode} stroke={seriesColor} strokeWidth={2} fill="url(#trace-chart-fill)" dot={visiblePoints.length <= 2} isAnimationActive={false} connectNulls />}
    </ComposedChart></ResponsiveContainer>
    </div>
  </section>;
}

const eventIcon = (type) => {
  if (type.includes('thinking')) return <Brain weight="duotone" />;
  if (type.includes('file')) return <FileCode weight="duotone" />;
  if (type.includes('command') || type.includes('tool')) return <TerminalWindow weight="duotone" />;
  return <Code weight="duotone" />;
};
const eventTypeTone = (type = '') => {
  const eventName = type.replace(/^agent\./, '');
  if (eventName === 'thinking') return 'thinking';
  if (eventName === 'completed' || eventName.endsWith('_completed')) return 'completed';
  if (eventName === 'output') return 'output';
  if (eventName === 'input') return 'input';
  if (eventName === 'usage') return 'usage';
  return 'default';
};
const fixedEventLabels = new Map([
  ['Preparando respuesta', 'Preparing response'],
  ['Turno terminado', 'Turn completed'],
  ['Uso actualizado', 'Usage updated'],
  ['Uso acumulado', 'Cumulative usage'],
  ['Turno interrumpido', 'Turn interrupted'],
  ['Razonamiento en curso (contenido no expuesto)', 'Reasoning in progress (content not exposed)'],
  ['Output observado en directo', 'Live output observed'],
  ['Créditos Copilot actualizados', 'Copilot credits updated'],
  ['Uso final reportado por Copilot', 'Final Copilot usage reported'],
  ['Sesión terminada', 'Session completed'],
  ['Uso de Copilot actualizado desde OpenTelemetry', 'Copilot usage updated from OpenTelemetry'],
]);
const eventText = (event) => {
  const text = event?.data?.text || event?.data?.command || event?.data?.path || event?.type || '';
  if (fixedEventLabels.has(text)) return fixedEventLabels.get(text);
  const external = text.match(/^Sesión externa detectada en (.+)$/);
  return external ? `External session detected in ${external[1]}` : text;
};
const eventTime = (value) => {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
};

function EventStream({ events = [], paused, onRawEvent, runId }) {
  const [open, setOpen] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const shown = paused ? [] : events;
  const tokenTotal = [...events].reverse().find(e=>Number.isFinite(e.data?.usage?.input))?.data.usage.input;
  const costTotal = [...events].reverse().find(e=>Number.isFinite(e.data?.usage?.cost))?.data.usage.cost;
  return <div className="events-table">
    <div className="event-header"><span>Time</span><span>Type</span><span>Event</span><span>Input Σ / Δ</span><span>Cost Σ / Δ</span></div>
    <div className="event-body"><div className="phase">
      <div className="phase-row"><button className="phase-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}><span>{open ? <CaretDown /> : <CaretRight />}</span><strong>Full run</strong><small>({events.length} events)</small><code>{compact(tokenTotal)}</code><code>{money(costTotal)}</code></button><a className="phase-download" href={api.runExportUrl(runId)} download title="Download full run for AI analysis as JSONL" aria-label="Download full run as JSONL"><DownloadSimple weight="bold" /><span>JSONL</span></a></div>
      {open && (shown.length ? shown : [{ id: 'empty', timestamp: new Date().toISOString(), type: 'agent.log', data: { text: paused ? 'Visual stream paused.' : 'Waiting for the first runtime event…' } }]).map((event) => <button key={event.id} className={`event-row ${event.data?.repeated || event.type === 'agent.error' ? 'warning' : ''} ${selectedEvent === event.id ? 'selected' : ''}`} onClick={() => { setSelectedEvent(event.id); onRawEvent(event); }}>
        <code>{eventTime(event.timestamp)}</code>
        <span className={`event-type event-type-${eventTypeTone(event.type)}`}>{eventIcon(event.type)}<code>{event.type.replace('agent.', '')}</code></span>
        <span>{eventText(event)}</span>
        <code>{event.data?.usage?.input != null ? 'Σ '+compact(event.data.usage.input) : event.data?.tokensDelta != null ? '+'+compact(event.data.tokensDelta) : '—'}</code>
        <code>{event.data?.usage?.cost != null ? 'Σ '+money(event.data.usage.cost) : event.data?.costDelta != null ? '+'+money(event.data.costDelta) : '—'}</code>
      </button>)}
    </div></div>
  </div>;
}

export function MainTrace({ detail, hasRuns, paused, onPause, onCompare, onRawEvent, onCancel, onEmptyAction }) {
  const [metric, setMetric] = useState('tokens');
  const [view, setView] = useState('timeline');
  useEffect(() => {
    if (metric === 'credits' && !Number.isFinite(detail?.run?.usage?.credits)) setMetric('tokens');
  }, [detail?.run?.id, detail?.run?.usage?.credits, metric]);
  if (!detail) return <main className="trace-pane loading-panel"><Database weight="duotone" /><h2>{hasRuns ? 'Loading timeline…' : 'Connect your agent sources'}</h2><p>{hasRuns ? 'Retrieving normalised events.' : 'The dashboard detects real Codex, Claude, Copilot and Hermes sessions, as well as sessions started here.'}</p>{!hasRuns && <button className="primary-button" onClick={onEmptyAction}>Add repository</button>}</main>;
  const { run, events } = detail;
  const metrics = metricsOf(run);
  // The active time sums the turns; the span and the last turn are reported
  // beside it so a conversation resumed later is not read as one execution.
  const lastTurnMs = Number.isFinite(detail.timing?.lastTurnMs) ? detail.timing.lastTurnMs : metrics.lastTurnDurationMs;
  const lastEvent = events.at(-1);
  return <main className="trace-pane">
    <header className="trace-toolbar">
      <div className="breadcrumb"><Database /><span>{run.workProjectName || 'Unassigned'}</span><CaretRight /><strong>{run.name}</strong><span className={`state-pill ${statusTone(run.status)}`}>{statusLabel(run.status)}</span></div>
      <div className="trace-time"><strong>{duration(metrics.durationMs)} active</strong><small>Span {duration(metrics.totalDurationMs)} · last turn {duration(lastTurnMs)}</small><small>Started: {formatDate(run.startedAt)}</small></div>
      <div className="toolbar-actions">
        {run.status === 'running' && !run.external && <button className="toolbar-button" onClick={onCancel}><span>Cancel</span></button>}
        <button className="toolbar-button" onClick={onCompare} aria-label="Compare session"><ArrowsOut /><span>Compare</span></button>
        <button className="toolbar-button" onClick={() => onRawEvent(lastEvent)} disabled={!lastEvent} aria-label="View raw event"><Code /><span>View raw event</span></button>
      </div>
    </header>
    <section className="trace-summary">
      <div className="trace-summary-copy"><h2>{paused ? 'Visual stream paused' : eventText(lastEvent) || run.prompt} <span>· {duration(metrics.durationMs)}</span></h2></div>
      <div className="metric-switch"><button className={metric === 'tokens' ? 'active' : ''} onClick={() => setMetric('tokens')}>Tokens</button><button className={metric === 'cost' ? 'active' : ''} onClick={() => setMetric('cost')}>Cost</button>{Number.isFinite(metrics.credits) && <button className={metric === 'credits' ? 'active' : ''} onClick={() => setMetric('credits')}>Credits</button>}</div>
      <div className="inline-metrics">{Number.isFinite(metrics.total) ? <><span><i className="dot blue" />Cumulative input<strong>{compact(metrics.input)}</strong></span><span><i className="dot purple" />Cumulative output<strong>{compact(metrics.output)}</strong></span></> : <><span><i className="dot blue" />Context in use<strong>{compact(metrics.contextTokens)}</strong></span><span><i className="dot purple" />Session total<strong>Not reported</strong></span></>}<span><i className="dot green" />{Number.isFinite(metrics.credits) ? metrics.creditUnit || 'Provider credits' : 'Cumulative cost'}<strong>{Number.isFinite(metrics.credits) ? credits(metrics.credits) : money(metrics.cost)}</strong></span></div>
    </section>
    <TraceChart mode={metric} detail={detail} />
    <div className="detail-body"><div className="detail-tabs">{[['timeline','Timeline'],['conversation','Conversation'],['commands','Commands'],['warnings',`Warnings (${detail.warnings?.length || 0})`]].map(([id,label])=><button key={id} className={view===id?'active':''} onClick={()=>setView(id)}>{label}</button>)}</div>{view==='timeline' && <EventStream events={events} paused={paused} onRawEvent={onRawEvent} runId={run.id} />}{view==='conversation' && <Conversation detail={detail} />}{view==='commands' && <CommandChart commands={detail.commands} />}{view==='warnings' && <div className="warning-list"><p>Heuristic rules for observed paths and commands. They do not prove data leakage.</p>{detail.warnings?.length ? detail.warnings.map((w,i)=><button key={i} onClick={()=>onRawEvent(events.find(e=>e.id===w.eventId))}><Warning /><span>{w.message}<code>{w.target}</code></span></button>) : <p>No matches with sensitivity rules were detected.</p>}</div>}</div>
  </main>;
}

const formatFileAccessTime = (value) => {
  if (!value || Number.isNaN(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
};

const readableFilePath = (path) => {
  const segments = String(path || '').replaceAll('\\', '/').split('/').filter(Boolean);
  return segments.slice(-2).join('/') || path;
};

function LoadedContext({ files, tools, run, snapshot }) {
  const [contextTab, setContextTab] = useState('files');
  const [showAllFiles, setShowAllFiles] = useState(false);
  const promptCount = new Set([run.prompt, snapshot.renderedPrompt].filter(Boolean)).size;
  const orderedFiles = useMemo(() => [...files].sort((left, right) => {
    const accessDifference = (right.reads + right.writes) - (left.reads + left.writes);
    return accessDifference || Date.parse(right.lastAt || 0) - Date.parse(left.lastAt || 0);
  }), [files]);
  const visibleFiles = showAllFiles ? orderedFiles : orderedFiles.slice(0, 6);
  const hiddenFileCount = Math.max(0, orderedFiles.length - visibleFiles.length);

  useEffect(() => {
    setContextTab('files');
    setShowAllFiles(false);
  }, [run.id]);

  return <section className="context-section context-loaded">
    <header className="loaded-context-heading">
      <div><span>Agent context</span><h3>Context loaded by the agent</h3></div>
      <small>{files.length ? `${files.length} files observed` : 'No files observed'}</small>
    </header>
    <div className="segmented-tabs" role="tablist" aria-label="Loaded context">
      <button role="tab" aria-selected={contextTab === 'files'} className={contextTab === 'files' ? 'active' : ''} onClick={() => setContextTab('files')}>Files ({files.length})</button>
      <button role="tab" aria-selected={contextTab === 'prompts'} className={contextTab === 'prompts' ? 'active' : ''} onClick={() => setContextTab('prompts')}>Prompts ({promptCount})</button>
      <button role="tab" aria-selected={contextTab === 'tools'} className={contextTab === 'tools' ? 'active' : ''} onClick={() => setContextTab('tools')}>Tools ({tools.length})</button>
    </div>
    {contextTab === 'files' && <div className="files-table" role="table" aria-label="Files loaded by the agent">
      <div className="files-header" role="row"><span role="columnheader">File</span><span role="columnheader">Times</span><span role="columnheader">Read</span><span role="columnheader">Write</span><span role="columnheader">Tokens</span><span role="columnheader">Last access</span></div>
      {visibleFiles.length ? visibleFiles.map((file) => <article key={file.path} role="row" className={file.sensitive ? 'warning' : ''} title={file.path}>
        <span className="file-name" role="cell"><code aria-label={`Full path: ${file.path}`}>{readableFilePath(file.path)}</code>{file.sensitive && <Warning weight="fill" aria-label="Sensitive file" />}</span>
        <strong role="cell">{file.reads + file.writes}</strong>
        <strong role="cell">{file.reads}</strong>
        <strong role="cell">{file.writes}</strong>
        <code role="cell">{compact(file.tokens)}</code>
        <time role="cell" dateTime={file.lastAt || undefined}>{formatFileAccessTime(file.lastAt)}</time>
      </article>) : <p className="table-empty">No file access captured.</p>}
      {hiddenFileCount > 0 && <button className="more-files" onClick={() => setShowAllFiles(true)}>Show {hiddenFileCount} more files…</button>}
      {showAllFiles && orderedFiles.length > 6 && <button className="more-files collapse-files" onClick={() => setShowAllFiles(false)}>Show fewer files</button>}
    </div>}
    {contextTab === 'prompts' && <div className="context-placeholder"><FileText /><strong>{run.external ? 'Observed visible prompt' : 'Exact prompt and context retained'}</strong><span>{snapshot.renderedPrompt || run.prompt || 'Not exposed by the provider'}</span></div>}
    {contextTab === 'tools' && <div className="context-placeholder"><TerminalWindow /><strong>{tools.length} observed tools</strong><span>{tools.map((tool) => `${tool.name} ×${tool.count}`).join(' · ') || 'The provider did not report tools'}</span></div>}
  </section>;
}

function ContextResizeHandle({ width, onResizeStart, onResizeKeyDown }) {
  const onKeyDown = (event) => {
    const adjustments = { ArrowLeft: 32, ArrowRight: -32, Home: -1000, End: 1000 };
    if (!(event.key in adjustments)) return;
    event.preventDefault();
    onResizeKeyDown(adjustments[event.key]);
  };
  return <div className="context-resize-handle" role="separator" aria-label="Resize context panel" aria-orientation="vertical" aria-valuemin={300} aria-valuemax={760} aria-valuenow={Math.round(width)} tabIndex={0} onPointerDown={onResizeStart} onKeyDown={onKeyDown} />;
}

export function ContextPane({ detail, tab, onTab, contextWidth, onResizeStart, onResizeKeyDown }) {
  const [copied, setCopied] = useState(false);
  const resizeHandle = <ContextResizeHandle width={contextWidth} onResizeStart={onResizeStart} onResizeKeyDown={onResizeKeyDown} />;
  if (!detail) return <aside className="context-pane">{resizeHandle}<div className="context-empty"><Database /><h3>No context captured</h3><p>The selected run's commit, prompts, files, tools and metrics will appear here.</p></div></aside>;
  const { run, files, tools } = detail;
  const metrics = metricsOf(run);
  const snapshot = run.contextSnapshot || {};
  const tabs = [['knowledge', 'Context'], ['metrics', 'Metrics'], ['tools', 'Tools']];
  return <aside className="context-pane">
    {resizeHandle}
    <div className="context-tabs">{tabs.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => onTab(id)}>{label}</button>)}</div>
    {tab === 'knowledge' && <div className="context-scroll">
      <section className="context-section"><h3>Session summary</h3><dl className="session-facts">
        <dt>Name</dt><dd>{run.name}</dd><dt>Provider</dt><dd><code>{run.provider}</code></dd><dt>Project</dt><dd>{run.workProjectName || 'Unassigned'}</dd>
        <dt>Repository</dt><dd className="copy-value"><code>{run.repositoryPath}</code><button onClick={() => { navigator.clipboard?.writeText(run.repositoryPath); setCopied(true); setTimeout(() => setCopied(false), 1200); }} aria-label="Copy repository">{copied ? <Check /> : <Copy />}</button></dd>
        <dt>Branch</dt><dd><code>{snapshot.repository?.branch || 'Not reported'}</code></dd><dt>Model</dt><dd><code>{run.model || 'Automatic'}</code></dd>
        <dt>Provider session ID</dt><dd><code>{run.nativeSessionId || 'Not reported'}</code></dd><dt>Origin</dt><dd>{run.external ? 'Observed external session' : 'Dashboard'}</dd>
        <dt>Started</dt><dd>{formatDate(run.startedAt)}</dd><dt>Status</dt><dd><span className={`status-dot ${statusTone(run.status)}`} /> {statusLabel(run.status)}</dd>
      </dl></section>
      <LoadedContext files={files} tools={tools} run={run} snapshot={snapshot} />
      <section className="context-section initial-prompt"><h3>Initial prompt</h3><details><summary>{(run.prompt || 'Not available in history').slice(0,180)}</summary><pre>{run.prompt || 'Not available'}</pre></details></section>
      <section className="context-section"><h3>Token and credit usage</h3><dl className="usage-list"><dt>Input</dt><dd>{compact(metrics.input)}</dd><dt>Output</dt><dd>{compact(metrics.output)}</dd><dt>Session total</dt><dd>{Number.isFinite(metrics.total) ? compact(metrics.total) : 'Not reported'}</dd>{Number.isFinite(metrics.observedTokens) && <><dt>Included from agents</dt><dd>{compact(metrics.observedTokens)}</dd></>}{Number.isFinite(metrics.contextTokens) && <><dt>Context in use</dt><dd>{compact(metrics.contextTokens)}{Number.isFinite(metrics.contextWindowTokens) ? ` / ${compact(metrics.contextWindowTokens)}` : ''}</dd></>}</dl><dl className="usage-list compact"><dt>Cache hit rate</dt><dd>{percent(metrics.cacheHit)}</dd><dt>Estimated cost</dt><dd>{money(metrics.cost)}</dd><dt>Provider credits</dt><dd>{Number.isFinite(metrics.credits) ? `${credits(metrics.credits)} ${metrics.creditUnit || ''}` : 'Not reported'}</dd><dt>Source</dt><dd>{metrics.usageSource || 'Not reported'}</dd></dl>{metrics.creditCoverage === 'main-agent-only' && <p className="unavailable-note">OpenTelemetry did not attribute agent credits; the credit value covers the main agent only.</p>}{(metrics.total == null || metrics.cost == null || metrics.credits == null) && <p className="unavailable-note">Values not exposed by the provider remain unreported. The dashboard prioritises OpenTelemetry and only uses `/usage` or `/context` as fallback sources.</p>}</section>
      {files.some((file) => file.reads > 1) && <section className="warning-callout"><Warning weight="fill" /><div><strong>Repeated reads detected</strong><p>{files.filter((file) => file.reads > 1).map((file) => `${file.path} ×${file.reads}`).join(', ')}. Review exclusions or retained context.</p></div></section>}
    </div>}
    {tab === 'metrics' && <div className="context-tab-panel"><header className="context-panel-heading"><ChartLine /><div><h3>Session metrics</h3><p>Reported values for this run.</p></div></header><dl className="context-metric-list"><dt>Session tokens</dt><dd>{compact(metrics.total)}</dd><dt>Observed agent tokens</dt><dd>{compact(metrics.observedTokens)}</dd><dt>Active time</dt><dd>{duration(metrics.durationMs)}</dd><dt>Conversation span</dt><dd>{duration(metrics.totalDurationMs)}</dd><dt>Last turn</dt><dd>{duration(metrics.lastTurnDurationMs)}</dd><dt>Cache hit</dt><dd>{percent(metrics.cacheHit)}</dd><dt>Provider credits</dt><dd>{Number.isFinite(metrics.credits) ? `${credits(metrics.credits)} ${metrics.creditUnit || ''}` : 'Not reported'}</dd><dt>Evaluation</dt><dd>{Number.isFinite(run.evaluation?.score) ? run.evaluation.score.toFixed(2) : 'Not reported'}</dd><dt>Reasoning tokens</dt><dd>{compact(run.usage?.reasoning)}</dd></dl></div>}
    {tab === 'tools' && <div className="context-tab-panel"><header className="context-panel-heading"><TerminalWindow /><div><h3>Tools used</h3><p>Observed calls in this run.</p></div></header>{tools.length ? <div className="tool-usage-list">{tools.map((tool) => <article key={tool.name}><code>{tool.name}</code><strong>{tool.count}</strong><span>{tool.count === 1 ? 'call' : 'calls'}</span></article>)}</div> : <div className="context-panel-empty"><TerminalWindow /><p>No tools reported by the provider.</p></div>}</div>}
  </aside>;
}

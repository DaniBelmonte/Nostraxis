import { useEffect, useMemo, useRef, useState } from 'react';
import { CaretLeft, CaretRight, MagnifyingGlass, SlidersHorizontal, SquaresFour, Table as TableIcon, UploadSimple, X } from '@phosphor-icons/react';
import { metricsOf, runDurationMs } from '../../../shared/lib/metrics';
import { DateRange } from '../../../shared/components/Observability';
import { PageShell } from '../../workspace/pages/WorkspaceViews';
import { RunCard } from '../components/RunCard';
import { RunTable } from '../components/RunTable';
import { ComparisonTray } from '../components/ComparisonTray';
import { CompareDetail } from './CompareDetail';
import { useImportedRuns } from '../hooks/useImportedRuns';
import { MAX_COMPARED_RUNS, RUN_COLORS } from '../model/comparison';

const MAX_RUNS = MAX_COMPARED_RUNS;
const PAGE_SIZE = 12;

// Default direction the first click on a column applies; a second click flips it.
const DEFAULT_SORT_DIR = { date: 'asc', project: 'asc', model: 'asc', tokens: 'desc', duration: 'desc', tools: 'desc', files: 'desc' };

const sortOptions = [
  ['date:desc', 'Most recent'],
  ['date:asc', 'Oldest first'],
  ['project:asc', 'Project (A-Z)'],
  ['model:asc', 'Model (A-Z)'],
  ['tokens:desc', 'Most tokens'],
  ['duration:desc', 'Longest duration'],
  ['tools:desc', 'Most tools used'],
  ['files:desc', 'Most files'],
];

function sortValue(key, run) {
  if (key === 'project') return (run.repositoryName || '').toLowerCase();
  if (key === 'model') return (run.model || '').toLowerCase();
  if (key === 'date') return Date.parse(run.startedAt) || 0;
  if (key === 'tokens') { const m = metricsOf(run); return Number.isFinite(m.total) ? m.total : m.observedTokens ?? 0; }
  if (key === 'duration') return runDurationMs(run) || 0;
  if (key === 'tools') return run.toolCount || 0;
  if (key === 'files') return run.fileCount || 0;
  return 0;
}

function sortRuns(runs, { key, dir }) {
  const sorted = [...runs];
  sorted.sort((a, b) => {
    const left = sortValue(key, a);
    const right = sortValue(key, b);
    const compared = typeof left === 'string' ? left.localeCompare(right) : left - right;
    return dir === 'asc' ? compared : -compared;
  });
  return sorted;
}

function pageWindow(current, total) {
  const pages = new Set([1, total, current - 1, current, current + 1]);
  return [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
}

// Each selected run holds a colour slot until it is removed, so the other
// runs keep their colour in every chart.
const withSlot = (slots, id) => {
  const used = new Set(Object.values(slots));
  return { ...slots, [id]: RUN_COLORS.findIndex((_, index) => !used.has(index)) };
};

export function CompareView({ runs: localRuns, focusId, onInspect }) {
  const imported = useImportedRuns();
  const runs = useMemo(() => [...localRuns, ...imported.imports], [localRuns, imported.imports]);
  const [selectedIds, setSelectedIds] = useState(() => [focusId].filter(Boolean));
  const [slots, setSlots] = useState(() => focusId ? { [focusId]: 0 } : {});
  const fileInput = useRef(null);
  const [query, setQuery] = useState('');
  const [dates, setDates] = useState({ from: '', to: '' });
  const [filters, setFilters] = useState({ project: 'All', agent: 'All', model: 'All', source: 'All' });
  const [moreOpen, setMoreOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('All');
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });
  const [view, setView] = useState('cards');
  const [page, setPage] = useState(1);
  const detailRef = useRef(null);

  const options = (key) => ['All', ...new Set(runs.map((run) => run[key]).filter(Boolean))];

  const filtered = useMemo(() => runs.filter((run) => {
    const haystack = `${run.name} ${run.repositoryName} ${run.provider} ${run.model}`.toLowerCase();
    return haystack.includes(query.toLowerCase())
      && (!dates.from || Date.parse(run.startedAt) >= new Date(`${dates.from}T00:00:00`).getTime())
      && (!dates.to || Date.parse(run.startedAt) <= new Date(`${dates.to}T23:59:59.999`).getTime())
      && (filters.project === 'All' || run.repositoryName === filters.project)
      && (filters.agent === 'All' || run.provider === filters.agent)
      && (filters.model === 'All' || run.model === filters.model)
      && (filters.source === 'All' || (filters.source === 'Imported') === Boolean(run.imported))
      && (statusFilter === 'All' || run.status === statusFilter);
  }), [runs, query, dates, filters, statusFilter]);

  const sorted = useMemo(() => sortRuns(filtered, sort), [filtered, sort]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  useEffect(() => { setPage(1); }, [query, dates, filters, statusFilter, sort]);
  const sortByColumn = (key) => setSort((current) => current.key === key
    ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: DEFAULT_SORT_DIR[key] });
  const currentPage = Math.min(page, totalPages);
  const pageRuns = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const select = (ids) => {
    let next = selectedIds, nextSlots = slots;
    for (const id of ids) {
      if (next.includes(id) || next.length >= MAX_RUNS) continue;
      next = [...next, id];
      nextSlots = withSlot(nextSlots, id);
    }
    setSelectedIds(next); setSlots(nextSlots);
  };
  const toggle = (id) => {
    if (!selectedIds.includes(id)) return select([id]);
    setSelectedIds(selectedIds.filter((value) => value !== id));
    setSlots(Object.fromEntries(Object.entries(slots).filter(([key]) => key !== id)));
  };
  const colorFor = (id) => RUN_COLORS[slots[id] ?? 0];
  const importFiles = async (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (!files.length) return;
    const added = await imported.importFiles(files);
    select(added.map((run) => run.id));
  };
  const removeImport = async (run) => {
    if (selectedIds.includes(run.id)) toggle(run.id);
    await imported.remove(run.importId);
  };
  const selectedRuns = selectedIds.map((id) => runs.find((run) => run.id === id)).filter(Boolean);
  const showDetail = selectedRuns.length >= 2;
  const scrollToComparison = () => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return <PageShell eyebrow="Reproducible benchmark" title="Compare" description="Select up to five runs, from this machine or imported from another Nostraxis, to compare usage, tools, files, context, memory and effort.">
    <div className="compare-toolbar">
      <label className="search-field compare-search-field"><MagnifyingGlass /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search runs by title, project, model, agent…" /></label>
      <DateRange {...dates} onChange={setDates} />
    </div>
    <div className="compare-filters">
      <label>Project<select value={filters.project} onChange={(event) => setFilters({ ...filters, project: event.target.value })}>{options('repositoryName').map((value) => <option key={value} value={value}>{value === 'All' ? 'All projects' : value}</option>)}</select></label>
      <label>Agent<select value={filters.agent} onChange={(event) => setFilters({ ...filters, agent: event.target.value })}>{options('provider').map((value) => <option key={value} value={value}>{value === 'All' ? 'All agents' : value}</option>)}</select></label>
      <label>Model<select value={filters.model} onChange={(event) => setFilters({ ...filters, model: event.target.value })}>{options('model').map((value) => <option key={value} value={value}>{value === 'All' ? 'All models' : value}</option>)}</select></label>
      <label>Source<select value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value })}>{[['All', 'All sources'], ['Local', 'This machine'], ['Imported', 'Imported JSONL']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button className={`toolbar-button ${moreOpen ? 'active' : ''}`} type="button" onClick={() => setMoreOpen((value) => !value)}><SlidersHorizontal /> More filters</button>
    </div>
    {moreOpen && <div className="compare-filters compare-filters-more">
      <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>{['All', 'running', 'waiting', 'queued', 'completed', 'failed', 'cancelled', 'stopped', 'idle', 'unknown'].map((value) => <option key={value}>{value}</option>)}</select></label>
    </div>}
    <div className="compare-runs-head">
      <h2>Runs <small>({sorted.length})</small></h2>
      <div className="compare-runs-actions">
        <button type="button" className="toolbar-button" onClick={() => fileInput.current?.click()} disabled={imported.busy} title="Import a full-run JSONL exported from another Nostraxis"><UploadSimple /> <span>{imported.busy ? 'Importing…' : 'Import JSONL'}</span></button>
        <input ref={fileInput} type="file" accept=".jsonl,.ndjson,application/x-ndjson" multiple hidden onChange={importFiles} />
        <label className="sort-by">Sort by<select value={`${sort.key}:${sort.dir}`} onChange={(event) => { const [key, dir] = event.target.value.split(':'); setSort({ key, dir }); }}>{sortOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <div className="view-toggle" role="group" aria-label="Layout">
          <button type="button" className={view === 'cards' ? 'active' : ''} onClick={() => setView('cards')} aria-pressed={view === 'cards'}><SquaresFour /> Cards</button>
          <button type="button" className={view === 'table' ? 'active' : ''} onClick={() => setView('table')} aria-pressed={view === 'table'}><TableIcon /> Table</button>
        </div>
      </div>
    </div>
    {imported.error && <p className="form-error compare-import-error" role="alert">{imported.error}<button type="button" className="icon-button" aria-label="Dismiss import error" onClick={imported.clearError}><X /></button></p>}
    {view === 'cards'
      ? <div className="run-grid">{pageRuns.map((run) => <RunCard key={run.id} run={run} selected={selectedIds.includes(run.id)} color={selectedIds.includes(run.id) ? colorFor(run.id) : null} disabled={selectedIds.length >= MAX_RUNS} onToggle={toggle} onOpen={run.imported ? null : onInspect} onRemove={run.imported ? () => removeImport(run) : null} />)}{!pageRuns.length && <p className="table-empty">No runs match these filters.</p>}</div>
      : <RunTable runs={pageRuns} selectedIds={selectedIds} disabled={selectedIds.length >= MAX_RUNS} sort={sort} onSort={sortByColumn} onToggle={toggle} onOpen={onInspect} onRemove={removeImport} />}
    {totalPages > 1 && <nav className="pagination" aria-label="Runs pages">
      <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1} aria-label="Previous page"><CaretLeft /></button>
      {pageWindow(currentPage, totalPages).map((pageNumber, index, list) => <span key={pageNumber}>
        {index > 0 && pageNumber - list[index - 1] > 1 && <span className="pagination-ellipsis">…</span>}
        <button type="button" className={pageNumber === currentPage ? 'active' : ''} onClick={() => setPage(pageNumber)} aria-current={pageNumber === currentPage ? 'page' : undefined}>{pageNumber}</button>
      </span>)}
      <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={currentPage === totalPages} aria-label="Next page"><CaretRight /></button>
    </nav>}
    {showDetail && <div ref={detailRef}><CompareDetail ids={selectedIds} colors={colorFor} onInspect={onInspect} /></div>}
    <ComparisonTray runs={selectedRuns} colorFor={colorFor} onRemove={toggle} onScrollToComparison={scrollToComparison} />
  </PageShell>;
}

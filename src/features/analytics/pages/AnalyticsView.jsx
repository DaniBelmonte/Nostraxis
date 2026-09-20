import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, ArrowsClockwise, BookOpen, CalendarBlank, CaretDown, Clock, Cpu, DotsThreeVertical,
  FileText, FolderOpen, Lightning, PencilSimple, SlidersHorizontal, Stack, TrendDown, TrendUp, Warning, XCircle,
} from '@phosphor-icons/react';
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api } from '../../../shared/api/client';
import { AgentIcon, PROVIDER_NAMES } from '../../../shared/components/AgentIcon';
import { CommandUsage } from '../components/CommandUsage';
import { ConnectionsPanel } from '../components/ConnectionsPanel';
import { compact, duration, money, percent } from '../../../shared/lib/metrics';
import { PageShell } from '../../workspace/pages/WorkspaceViews';

const DAY = 86400000;
const RANGES = [
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: '90d', label: 'Last 90 days', days: 90 },
  { id: 'all', label: 'All time', days: null },
];
const GRANULARITIES = [{ id: 'daily', label: 'Daily' }, { id: 'weekly', label: 'Weekly' }, { id: 'monthly', label: 'Monthly' }];
const SERIES = { tokens: { name: 'Session tokens', color: '#35a7ff' }, observed: { name: 'Agents (included)', color: '#b680ff' } };

const addNullable = (total, value) => (Number.isFinite(value) ? (total ?? 0) + value : total);
const change = (current, previous) => (Number.isFinite(current) && Number.isFinite(previous) && previous > 0 ? (current - previous) / previous : null);
const startOfDay = (date) => { const copy = new Date(date); copy.setHours(0, 0, 0, 0); return copy; };

function windowFor(range, custom) {
  if (custom.from || custom.to) {
    return {
      from: custom.from ? new Date(`${custom.from}T00:00:00`) : null,
      to: custom.to ? new Date(`${custom.to}T23:59:59.999`) : null,
    };
  }
  const days = RANGES.find((item) => item.id === range)?.days;
  if (!days) return { from: null, to: null };
  const to = new Date();
  return { from: startOfDay(new Date(to.getTime() - (days - 1) * DAY)), to };
}

function previousWindow({ from, to }) {
  if (!from || !to) return null;
  const span = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - span - 1), to: new Date(from.getTime() - 1) };
}

function bucketOf(date, granularity) {
  if (granularity === 'monthly') return new Date(date.getFullYear(), date.getMonth(), 1);
  if (granularity === 'weekly') {
    const start = startOfDay(date);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return start;
  }
  return startOfDay(date);
}

const labelOf = (date, granularity) => new Intl.DateTimeFormat('en-GB', granularity === 'monthly'
  ? { month: 'short', year: 'numeric' }
  : { day: 'numeric', month: 'short' }).format(date);

function bucketize(rows, granularity) {
  const buckets = new Map();
  for (const row of rows) {
    const at = new Date(row.at);
    if (Number.isNaN(at.getTime())) continue;
    const start = bucketOf(at, granularity);
    const key = start.getTime();
    const bucket = buckets.get(key) || { key, label: labelOf(start, granularity), runs: 0, tokens: null, observedTokens: null, cost: null, durations: [] };
    bucket.runs += 1;
    bucket.tokens = addNullable(bucket.tokens, row.totalTokens);
    bucket.observedTokens = addNullable(bucket.observedTokens, row.observedTokens);
    bucket.cost = addNullable(bucket.cost, row.costUsd);
    if (Number.isFinite(row.durationMs)) bucket.durations.push(row.durationMs);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.key - b.key).map((bucket) => ({
    ...bucket,
    averageDurationMs: bucket.durations.length ? bucket.durations.reduce((total, value) => total + value, 0) / bucket.durations.length : null,
    sessionOnly: Number.isFinite(bucket.tokens) && Number.isFinite(bucket.observedTokens)
      ? Math.max(0, bucket.tokens - bucket.observedTokens)
      : bucket.tokens,
  }));
}

function rank(groups = [], metric) {
  const rows = groups.map((group) => ({ key: group.key, value: Number.isFinite(group[metric]) ? group[metric] : null, runs: group.runs }));
  const total = rows.reduce((sum, row) => addNullable(sum, row.value), null);
  const maximum = Math.max(0, ...rows.map((row) => row.value ?? 0));
  return rows
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
    .map((row) => ({ ...row, share: Number.isFinite(row.value) && total ? row.value / total : null, width: maximum ? (row.value ?? 0) / maximum : 0 }));
}

function Delta({ value }) {
  if (!Number.isFinite(value)) return null;
  const up = value >= 0;
  const magnitude = Math.abs(value);
  return <span className={`analytics-delta ${up ? 'up' : 'down'}`} title={`${up ? '+' : '−'}${(magnitude * 100).toFixed(1)}%`}>
    {up ? <TrendUp /> : <TrendDown />}{magnitude >= 10 ? `×${(1 + magnitude).toFixed(1)}` : `${Math.round(magnitude * 100)}%`}
  </span>;
}

function Sparkline({ values, tone }) {
  const points = values.map((value, index) => ({ value, index })).filter((point) => Number.isFinite(point.value));
  if (points.length < 2) return null;
  const maximum = Math.max(...points.map((point) => point.value));
  const minimum = Math.min(...points.map((point) => point.value));
  const span = maximum - minimum || Math.abs(maximum) || 1;
  const x = (index) => (index / Math.max(1, values.length - 1)) * 100;
  const y = (value) => 26 - ((value - minimum) / span) * 22;
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${x(point.index).toFixed(2)},${y(point.value).toFixed(2)}`).join(' ');
  return <svg className={`analytics-sparkline ${tone}`} viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
    <path className="sparkline-area" d={`${line} L${x(points.at(-1).index).toFixed(2)},30 L${x(points[0].index).toFixed(2)},30 Z`} />
    <path className="sparkline-line" d={line} />
  </svg>;
}

function OverviewCard({ icon, tone, label, value, delta, meta, series }) {
  return <article className={`analytics-overview-card ${tone}`}>
    <span className="analytics-overview-icon">{icon}</span>
    <span className="analytics-overview-label">{label}</span>
    <strong>{value}</strong>
    <div className="analytics-overview-trend"><Delta value={delta} />{meta && <small>{meta}</small>}</div>
    <Sparkline values={series} tone={tone} />
  </article>;
}

function QualityRow({ icon, label, value, delta }) {
  return <div className="analytics-quality-row"><span className="analytics-quality-icon">{icon}</span><span>{label}</span><strong>{value}</strong><Delta value={delta} /></div>;
}

function UsageTooltip({ active, payload, label, metric }) {
  if (!active || !payload?.length) return null;
  const bucket = payload[0].payload;
  const rows = metric === 'cost'
    ? [['Cost', money(bucket.cost)]]
    : [[SERIES.tokens.name, compact(bucket.tokens)], [SERIES.observed.name, compact(bucket.observedTokens)]];
  return <div className="readable-tooltip"><strong>{label}</strong>{rows.map(([name, text]) => <div key={name}><span>{name}</span><b>{text}</b></div>)}<div><span>Runs</span><b>{bucket.runs}</b></div></div>;
}

function FilterPill({ icon, label, value, options, onChange }) {
  return <label className="analytics-pill">{icon}<span>{label}</span>
    <select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    <CaretDown />
  </label>;
}

function TopList({ title, caption, header, rows, iconFor, labelFor, linkLabel }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, 5);
  return <section className="panel-block analytics-top">
    <header><div><h2>{title}</h2><small>{caption}</small></div></header>
    {visible.length ? <>
      <div className="analytics-top-head"><span>{header}</span><span /><span>Tokens</span><span>%</span></div>
      {visible.map((row) => <div key={row.key} className="analytics-top-row">
        <span className="analytics-top-name">{iconFor?.(row.key)}<code title={row.key}>{labelFor ? labelFor(row.key) : row.key}</code></span>
        <span className="analytics-top-bar"><i style={{ width: `${Math.max(row.width * 100, row.value ? 4 : 0)}%` }} /></span>
        <code>{compact(row.value)}</code>
        <code>{Number.isFinite(row.share) ? `${Math.round(row.share * 100)}%` : '—'}</code>
      </div>)}
      {rows.length > 5 && <button type="button" className="analytics-top-link" onClick={() => setExpanded(!expanded)}>{expanded ? 'Show top 5' : linkLabel} <ArrowRight /></button>}
    </> : <p className="empty-evidence">Nothing reported in this period.</p>}
  </section>;
}

export function AnalyticsView({ initial, repositories }) {
  const [analytics, setAnalytics] = useState(initial);
  const [previous, setPrevious] = useState(null);
  const [range, setRange] = useState('30d');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [filters, setFilters] = useState({ repository: '', provider: '', model: '' });
  const [moreOpen, setMoreOpen] = useState(false);
  const [metric, setMetric] = useState('tokens');
  const [granularity, setGranularity] = useState('daily');
  const [visibleSeries, setVisibleSeries] = useState({ tokens: true, observed: true });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    let active = true;
    const current = windowFor(range, custom);
    const earlier = previousWindow(current);
    const query = {
      ...filters,
      from: current.from ? current.from.toISOString() : '',
      to: current.to ? current.to.toISOString() : '',
    };
    Promise.all([
      api.analytics(query),
      earlier ? api.analytics({ ...filters, from: earlier.from.toISOString(), to: earlier.to.toISOString() }) : Promise.resolve(null),
    ]).then(([now, before]) => {
      if (!active) return;
      setAnalytics(now);
      setPrevious(before);
    }).catch(() => {});
    return () => { active = false; };
  }, [range, custom.from, custom.to, filters, initial]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event) => { if (!menuRef.current?.contains(event.target)) setMenuOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  const summary = analytics?.summary || {};
  const previousSummary = previous?.summary || {};
  const observability = analytics?.observability || {};
  const previousObservability = previous?.observability || {};
  const timeseries = analytics?.timeseries || [];
  const daily = useMemo(() => bucketize(timeseries, 'daily'), [timeseries]);
  const series = useMemo(() => bucketize(timeseries, granularity), [timeseries, granularity]);
  const providerOf = useMemo(() => new Map(timeseries.map((row) => [row.model, row.provider])), [timeseries]);
  const rangeLabel = custom.from || custom.to
    ? `${custom.from || 'start'} → ${custom.to || 'today'}`
    : RANGES.find((item) => item.id === range).label;
  const comparison = previous ? `vs previous ${rangeLabel.toLowerCase().replace('last ', '')}` : 'No previous period';
  const optionsFor = (key) => [...new Set((initial?.timeseries || []).map((row) => row[key]).filter(Boolean))].sort();
  const projects = [...new Set([...repositories.map((repo) => repo.name), ...optionsFor('repository')])].sort();
  const filtered = [rangeLabel, filters.repository || 'All projects', filters.provider ? PROVIDER_NAMES[filters.provider] || filters.provider : 'All providers', filters.model || 'All models'].join(' • ');
  const dirty = range !== '30d' || custom.from || custom.to || filters.repository || filters.provider || filters.model;
  const reset = () => { setRange('30d'); setCustom({ from: '', to: '' }); setFilters({ repository: '', provider: '', model: '' }); };

  return <PageShell title="Analytics" description="Understand usage, performance and quality across all your agent runs.">
    <div className="analytics-filter-bar">
      <FilterPill icon={<CalendarBlank />} label="" value={custom.from || custom.to ? 'custom' : range}
        options={[...RANGES.map((item) => ({ value: item.id, label: item.label })), ...(custom.from || custom.to ? [{ value: 'custom', label: rangeLabel }] : [])]}
        onChange={(value) => { setCustom({ from: '', to: '' }); setRange(value); }} />
      <FilterPill icon={<FolderOpen />} label="Project" value={filters.repository}
        options={[{ value: '', label: 'All projects' }, ...projects.map((name) => ({ value: name, label: name }))]}
        onChange={(value) => setFilters({ ...filters, repository: value })} />
      <FilterPill icon={<Stack />} label="Provider" value={filters.provider}
        options={[{ value: '', label: 'All providers' }, ...optionsFor('provider').map((value) => ({ value, label: PROVIDER_NAMES[value] || value }))]}
        onChange={(value) => setFilters({ ...filters, provider: value })} />
      <FilterPill icon={<Cpu />} label="Model" value={filters.model}
        options={[{ value: '', label: 'All models' }, ...optionsFor('model').map((value) => ({ value, label: value }))]}
        onChange={(value) => setFilters({ ...filters, model: value })} />
      <button type="button" className={`toolbar-button ${moreOpen ? 'active' : ''}`} onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen}><SlidersHorizontal /> More filters</button>
      <button type="button" className="analytics-reset" onClick={reset} disabled={!dirty}><ArrowsClockwise /> Reset filters</button>
    </div>
    {moreOpen && <div className="analytics-filter-more">
      <label>From<input type="date" value={custom.from} max={custom.to || undefined} onChange={(event) => setCustom({ ...custom, from: event.target.value })} /></label>
      <label>To<input type="date" value={custom.to} min={custom.from || undefined} onChange={(event) => setCustom({ ...custom, to: event.target.value })} /></label>
    </div>}

    <div className="analytics-summary">
      <section className="panel-block analytics-overview">
        <header><div><h2>Overview</h2><small>{filtered}</small></div></header>
        <div className="analytics-overview-grid">
          <OverviewCard icon={<CalendarBlank />} tone="blue" label="Total runs" value={analytics?.runCount ?? '—'}
            delta={change(analytics?.runCount, previous?.runCount)} meta={comparison} series={daily.map((bucket) => bucket.runs)} />
          <OverviewCard icon={<FileText />} tone="purple" label="Session tokens" value={compact(summary.totalTokens)}
            delta={change(summary.totalTokens, previousSummary.totalTokens)} meta={comparison} series={daily.map((bucket) => bucket.tokens)} />
          <OverviewCard icon={<Clock />} tone="green" label="Average duration" value={duration(summary.averageDurationMs)}
            delta={change(summary.averageDurationMs, previousSummary.averageDurationMs)} meta={comparison} series={daily.map((bucket) => bucket.averageDurationMs)} />
          <OverviewCard icon={<Stack />} tone="neutral" label="Cost" value={money(summary.totalCostUsd)}
            delta={change(summary.totalCostUsd, previousSummary.totalCostUsd)} meta="Provider or configured pricing" series={daily.map((bucket) => bucket.cost)} />
        </div>
      </section>
      <section className="panel-block analytics-quality">
        <header><div><h2>Quality &amp; activity</h2></div></header>
        <div className="analytics-quality-list">
          <QualityRow icon={<Lightning />} label="Cache hit rate" value={percent(summary.cacheHit)} delta={change(summary.cacheHit, previousSummary.cacheHit)} />
          <QualityRow icon={<BookOpen />} label="Reads" value={compact(observability.fileReads)} delta={change(observability.fileReads, previousObservability.fileReads)} />
          <QualityRow icon={<PencilSimple />} label="Writes" value={compact(observability.fileWrites)} delta={change(observability.fileWrites, previousObservability.fileWrites)} />
          <QualityRow icon={<Warning />} label="Warnings" value={compact(observability.warningCount)} delta={change(observability.warningCount, previousObservability.warningCount)} />
          <QualityRow icon={<XCircle />} label="Errors" value={compact(observability.errors)} delta={change(observability.errors, previousObservability.errors)} />
        </div>
      </section>
    </div>

    <section className="panel-block analytics-usage">
      <header>
        <div><h2>Usage over time</h2><small>Tokens and cost across your runs.</small></div>
        <div className="analytics-usage-controls">
          <div className="view-toggle">
            <button type="button" className={metric === 'tokens' ? 'active' : ''} onClick={() => setMetric('tokens')}><FileText /> Tokens</button>
            <button type="button" className={metric === 'cost' ? 'active' : ''} onClick={() => setMetric('cost')}><Stack /> Cost</button>
          </div>
          <label className="analytics-pill analytics-pill-plain"><select value={granularity} onChange={(event) => setGranularity(event.target.value)} aria-label="Granularity">{GRANULARITIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><CaretDown /></label>
          <div className="analytics-menu" ref={menuRef}>
            <button type="button" className="analytics-menu-button" aria-label="Chart options" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><DotsThreeVertical /></button>
            {menuOpen && <div className="analytics-menu-list" role="menu">
              {metric === 'tokens' ? Object.entries(SERIES).map(([id, item]) => <label key={id}>
                <input type="checkbox" checked={visibleSeries[id]} onChange={() => setVisibleSeries({ ...visibleSeries, [id]: !visibleSeries[id] })} />
                <i style={{ background: item.color }} />{item.name}
              </label>) : <p>Cost is shown as reported by each provider.</p>}
            </div>}
          </div>
        </div>
      </header>
      {series.length ? <>
        <div className="analytics-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ top: 6, right: 12, left: 4, bottom: 4 }} barCategoryGap="28%">
              <CartesianGrid stroke="#1d3243" vertical={false} />
              <XAxis dataKey="label" stroke="#5f7d92" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis stroke="#5f7d92" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} width={54} tickFormatter={metric === 'cost' ? money : compact} />
              <Tooltip cursor={{ fill: '#16303f66' }} content={<UsageTooltip metric={metric} />} />
              {metric === 'cost'
                ? <Bar name="Cost" dataKey="cost" fill="#43d59a" radius={[3, 3, 0, 0]} />
                : <>
                  {visibleSeries.observed && <Bar name={SERIES.observed.name} dataKey="observedTokens" stackId="usage" fill={SERIES.observed.color} />}
                  {visibleSeries.tokens && <Bar name={SERIES.tokens.name} dataKey="sessionOnly" stackId="usage" fill={SERIES.tokens.color} radius={[3, 3, 0, 0]} />}
                </>}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="analytics-legend">
          {(metric === 'cost' ? [{ name: 'Cost', color: '#43d59a' }] : Object.entries(SERIES).filter(([id]) => visibleSeries[id]).map(([, item]) => item))
            .map((item) => <span key={item.name}><i style={{ background: item.color }} />{item.name}</span>)}
        </div>
      </> : <p className="empty-evidence">No runs in this period.</p>}
    </section>

    <div className="analytics-tops">
      <TopList title="Top models" caption="By session tokens." header="Model" linkLabel="View all models"
        rows={rank(analytics?.dimensions?.model, 'totalTokens')}
        iconFor={(key) => <span className={`agent-icon provider-${providerOf.get(key) || 'unknown'}`}><AgentIcon id={providerOf.get(key)} /></span>} />
      <TopList title="Top projects" caption="By session tokens." header="Project" linkLabel="View all projects"
        rows={rank(analytics?.dimensions?.repositoryName, 'totalTokens')}
        iconFor={() => <span className="agent-icon"><FolderOpen /></span>} />
      <TopList title="Top agents" caption="By session tokens." header="Agent" linkLabel="View all agents"
        rows={rank(analytics?.dimensions?.provider, 'totalTokens')}
        labelFor={(key) => PROVIDER_NAMES[key] || key}
        iconFor={(key) => <span className={`agent-icon provider-${key}`}><AgentIcon id={key} /></span>} />
    </div>

    <CommandUsage commands={observability.commands} projects={projects} models={optionsFor('model')} />
    <ConnectionsPanel graph={observability.graph} />
  </PageShell>;
}

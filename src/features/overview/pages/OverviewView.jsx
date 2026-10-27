import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageShell } from '../../workspace/pages/WorkspaceViews';
import { AgentIcon, PROVIDER_NAMES } from '../../../shared/components/AgentIcon';
import { compact, credits, duration, metricsOf, money, percent, statusLabel, statusTone } from '../../../shared/lib/metrics';
import { axisTick, cursorFill, ink, line, providerColors } from '../../../shared/lib/theme';

const DAY = 86_400_000;
const RANGES = [['1', '24 hours'], ['7', '7 days'], ['30', '30 days']];
const PROVIDERS = ['codex', 'claude', 'copilot', 'hermes'];
const at = (run) => Date.parse(run.updatedAt || run.startedAt) || 0;
// Sums stay null when no run reported the value, so a gap never reads as zero.
const sum = (values) => values.reduce((total, value) => (Number.isFinite(value) ? (total ?? 0) + value : total), null);

function summarize(runs) {
  const metrics = runs.map(metricsOf);
  const input = sum(metrics.map((item) => (item.cached != null ? item.input : null)));
  const cached = sum(metrics.map((item) => (item.input != null ? item.cached : null)));
  const creditUnits = new Map();
  metrics.forEach((item) => { if (Number.isFinite(item.credits)) creditUnits.set(item.creditUnit || 'credits', (creditUnits.get(item.creditUnit || 'credits') || 0) + item.credits); });
  return { sessions: runs.length, tokens: sum(metrics.map((item) => item.total)), cost: sum(metrics.map((item) => item.cost)), cacheHit: input > 0 ? cached / input : null, credits: [...creditUnits] };
}

const delta = (current, previous, points = false) => {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return { label: 'No previous period', tone: '' };
  if (points) { const diff = Math.round((current - previous) * 100); return { label: `${diff >= 0 ? '+' : '−'}${Math.abs(diff)} pts`, tone: diff >= 0 ? 'up' : 'down' }; }
  if (previous === 0) return { label: current ? 'New' : 'No change', tone: '' };
  const change = (current - previous) / previous;
  return { label: `${change >= 0 ? '+' : '−'}${Math.round(Math.abs(change) * 100)}%`, tone: change >= 0 ? 'up' : 'down' };
};

function UsageTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return <div className="readable-tooltip"><strong>{label}</strong>{payload.filter((item) => item.value).map((item) => <div key={item.dataKey}><span><i className="tooltip-swatch" style={{ background: item.color }} />{item.name}</span><small>{compact(item.value)}</small></div>)}</div>;
}

export function OverviewView({ data, onInspect, onNavigate }) {
  const [range, setRange] = useState('7');
  const [provider, setProvider] = useState('all');
  const now = Date.now();
  const days = Number(range);
  const view = useMemo(() => {
    const scoped = data.runs.filter((run) => provider === 'all' || run.provider === provider);
    const current = scoped.filter((run) => at(run) >= now - days * DAY);
    const previous = scoped.filter((run) => at(run) < now - days * DAY && at(run) >= now - 2 * days * DAY);
    const span = Math.max(days, 14);
    const daily = Array.from({ length: span }, (_, index) => {
      const start = new Date(now - (span - 1 - index) * DAY); start.setHours(0, 0, 0, 0);
      const runs = scoped.filter((run) => { const time = Date.parse(run.startedAt); return time >= start.getTime() && time < start.getTime() + DAY; });
      return { label: start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), ...Object.fromEntries(PROVIDERS.map((id) => [id, sum(runs.filter((run) => run.provider === id).map((run) => metricsOf(run).total)) ?? 0])) };
    });
    const byProvider = PROVIDERS.map((id) => ({ id, ...summarize(current.filter((run) => run.provider === id)) })).filter((item) => item.sessions);
    const rank = (key) => [...current.reduce((groups, run) => groups.set(run[key] || 'Not reported', [...(groups.get(run[key] || 'Not reported') || []), run]), new Map())]
      .map(([name, runs]) => ({ name, sessions: runs.length, tokens: sum(runs.map((run) => metricsOf(run).total)), provider: runs[0].provider }))
      .sort((a, b) => (b.tokens ?? -1) - (a.tokens ?? -1) || b.sessions - a.sessions).slice(0, 5);
    const attention = [
      ...current.filter((run) => run.status === 'failed').map((run) => ({ id: run.id, tone: 'error', title: `Session failed · ${run.name}`, meta: `${PROVIDER_NAMES[run.provider] || run.provider} · ${run.repositoryName || 'No project'}` })),
      ...scoped.filter((run) => run.status === 'waiting').map((run) => ({ id: run.id, tone: 'warning', title: `Waiting for approval · ${run.name}`, meta: `${PROVIDER_NAMES[run.provider] || run.provider} · ${run.repositoryName || 'No project'}` })),
      ...scoped.filter((run) => run.status === 'running').filter((run) => { const item = metricsOf(run); return item.contextWindowTokens > 0 && item.contextTokens / item.contextWindowTokens > 0.9; })
        .map((run) => ({ id: run.id, tone: 'warning', title: `Context above 90% · ${run.name}`, meta: `${PROVIDER_NAMES[run.provider] || run.provider} · running` })),
      ...(data.sessionSources || []).filter((source) => source.error).map((source) => ({ id: null, tone: 'warning', title: `${source.label || source.provider} source error`, meta: source.error })),
    ].slice(0, 6);
    return { current: summarize(current), previous: summarize(previous), daily, byProvider, models: rank('model'), projects: rank('repositoryName'), attention,
      recent: [...scoped].sort((a, b) => at(b) - at(a)).slice(0, 6), providers: PROVIDERS.filter((id) => data.runs.some((run) => run.provider === id)) };
  }, [data.runs, data.sessionSources, provider, days]);

  const { current, previous } = view;
  const stats = [
    ['Sessions', String(current.sessions), delta(current.sessions, previous.sessions)],
    ['Session tokens', compact(current.tokens), delta(current.tokens, previous.tokens)],
    ['Estimated cost', Number.isFinite(current.cost) ? money(current.cost) : 'Not reported', delta(current.cost, previous.cost), current.credits.map(([unit, value]) => `+ ${credits(value)} ${unit}`).join(' · ')],
    ['Cache hit rate', percent(current.cacheHit), delta(current.cacheHit, previous.cacheHit, true)],
  ];
  const maxModel = Math.max(1, ...view.models.map((item) => item.tokens || 0));
  const maxProject = Math.max(1, ...view.projects.map((item) => item.sessions));
  const filters = <div className="overview-toolbar">
    <div className="chip-group" role="group" aria-label="Filter by provider">{['all', ...view.providers].map((id) => <button key={id} type="button" aria-pressed={provider === id} className={provider === id ? 'active' : ''} onClick={() => setProvider(id)}>{id !== 'all' && <i style={{ background: providerColors[id] }} />}{id === 'all' ? 'All providers' : PROVIDER_NAMES[id] || id}</button>)}</div>
    <div className="view-toggle" role="group" aria-label="Time range">{RANGES.map(([id, label]) => <button key={id} type="button" aria-pressed={range === id} className={range === id ? 'active' : ''} onClick={() => setRange(id)}>{label}</button>)}</div>
  </div>;

  return <PageShell title="Overview" description="Activity, usage and health across every observed agent." tabs={filters} className="overview-page">
    {stats.map(([label, value, change, extra]) => <section key={label} className="panel-block overview-stat"><span>{label}</span><strong>{value}</strong><small><em className={change.tone}>{change.label}</em>{change.tone && ` vs previous ${days === 1 ? '24 hours' : `${days} days`}`}</small>{extra && <small>{extra}</small>}</section>)}

    <section className="panel-block overview-usage"><header><div><h2>Usage over time</h2><small>Session tokens per day, by provider</small></div></header>
      <div className="overview-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={view.daily} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid stroke={line.grid} vertical={false} />
        <XAxis dataKey="label" stroke={ink.faint} tickLine={false} axisLine={{ stroke: line.axis }} tick={axisTick} interval="preserveStartEnd" minTickGap={18} />
        <YAxis stroke={ink.faint} tickLine={false} axisLine={false} tick={axisTick} width={48} tickFormatter={compact} />
        <Tooltip cursor={{ fill: cursorFill }} content={<UsageTooltip />} />
        {view.providers.map((id, index) => <Bar key={id} dataKey={id} name={PROVIDER_NAMES[id] || id} stackId="tokens" fill={providerColors[id]} radius={index === view.providers.length - 1 ? [2, 2, 0, 0] : 0} isAnimationActive={false} />)}
      </BarChart></ResponsiveContainer></div>
      <div className="analytics-legend">{view.providers.map((id) => <span key={id}><i style={{ background: providerColors[id] }} />{PROVIDER_NAMES[id] || id}</span>)}</div>
    </section>

    <section className="panel-block overview-providers"><header><div><h2>Provider usage</h2><small>Units are never mixed</small></div></header>
      {view.byProvider.length ? view.byProvider.map((item) => <div key={item.id} className="overview-provider">
        <span className={`agent-icon provider-${item.id}`}><AgentIcon id={item.id} /></span>
        <div><strong>{PROVIDER_NAMES[item.id] || item.id}</strong><small>{item.sessions} {item.sessions === 1 ? 'session' : 'sessions'}</small></div>
        <dl><dt>Tokens</dt><dd>{compact(item.tokens)}</dd><dt>Cost</dt><dd>{Number.isFinite(item.cost) ? money(item.cost) : '—'}</dd>{item.credits.flatMap(([unit, value]) => [<dt key={`${unit}-t`}>{unit}</dt>, <dd key={`${unit}-d`}>{credits(value)}</dd>])}</dl>
      </div>) : <p className="table-empty">No sessions in this period.</p>}
    </section>

    <section className="panel-block overview-recent"><header><div><h2>Recent sessions</h2><small>Managed and observed</small></div><button type="button" className="compare-run-link" onClick={() => onNavigate('Sessions')}>View all sessions</button></header>
      <div className="overview-table" role="table" aria-label="Recent sessions">
        <div className="overview-row overview-head" role="row"><span role="columnheader">Status</span><span role="columnheader">Session</span><span role="columnheader">Provider</span><span role="columnheader">Project</span><span role="columnheader">Duration</span><span role="columnheader">Tokens</span><span role="columnheader">Cost</span></div>
        {view.recent.map((run) => { const item = metricsOf(run); return <button key={run.id} type="button" role="row" className="overview-row" onClick={() => onInspect(run.id)}>
          <span role="cell"><i className={`status-dot ${statusTone(run.status)}`} />{statusLabel(run.status)}</span>
          <strong role="cell">{run.name}</strong>
          <span role="cell"><i className="overview-swatch" style={{ background: providerColors[run.provider] || providerColors.unknown }} />{PROVIDER_NAMES[run.provider] || run.provider}</span>
          <span role="cell">{run.repositoryName || 'No project'}</span>
          <code role="cell">{duration(item.durationMs)}</code>
          <code role="cell" className={Number.isFinite(item.total) ? '' : 'muted'}>{Number.isFinite(item.total) ? compact(item.total) : 'Not reported'}</code>
          <code role="cell" className={Number.isFinite(item.cost) || Number.isFinite(item.credits) ? '' : 'muted'}>{Number.isFinite(item.credits) ? `${credits(item.credits)} ${item.creditUnit || 'credits'}` : Number.isFinite(item.cost) ? money(item.cost) : '—'}</code>
        </button>; })}
        {!view.recent.length && <p className="table-empty">No sessions yet.</p>}
      </div>
    </section>

    <section className="panel-block overview-attention"><header><div><h2>Needs attention</h2><small>{view.attention.length ? `${view.attention.length} open` : 'All clear'}</small></div></header>
      {view.attention.length ? <ul>{view.attention.map((item, index) => <li key={`${item.title}-${index}`}><i className={`overview-sev ${item.tone}`} /><div>{item.id ? <button type="button" onClick={() => onInspect(item.id)}>{item.title}</button> : <strong>{item.title}</strong>}<small>{item.meta}</small></div></li>)}</ul> : <p className="table-empty">Nothing needs attention right now.</p>}
    </section>

    <section className="panel-block overview-rank"><header><div><h2>Top models</h2><small>By session tokens</small></div></header>
      {view.models.map((item) => <div key={item.name} className="overview-bar"><span><code>{item.name}</code><code>{compact(item.tokens)}</code></span><i><b style={{ width: `${((item.tokens || 0) / maxModel) * 100}%`, background: providerColors[item.provider] || providerColors.unknown }} /></i></div>)}
      {!view.models.length && <p className="table-empty">No sessions in this period.</p>}
    </section>

    <section className="panel-block overview-rank"><header><div><h2>Top projects</h2><small>By sessions</small></div></header>
      {view.projects.map((item) => <div key={item.name} className="overview-bar"><span><span>{item.name}</span><code>{item.sessions}</code></span><i><b style={{ width: `${(item.sessions / maxProject) * 100}%` }} /></i></div>)}
      {!view.projects.length && <p className="table-empty">No sessions in this period.</p>}
    </section>

    <section className="panel-block overview-sources"><header><div><h2>Observed sources</h2><small>Read-only</small></div><button type="button" className="compare-run-link" onClick={() => onNavigate('Settings')}>Manage</button></header>
      <ul>{(data.sessionSources || []).map((source) => <li key={`${source.provider}:${source.root}`}><i className={`status-dot ${source.error ? 'warning' : source.available ? 'done' : ''}`} /><div><strong>{source.label || PROVIDER_NAMES[source.provider] || source.provider}</strong><small>{source.error ? `Error: ${source.error}` : source.available ? 'Detected' : 'Not detected'}</small></div><code className={source.available ? '' : 'muted'}>{source.available ? source.count : '—'}</code></li>)}</ul>
    </section>
  </PageShell>;
}

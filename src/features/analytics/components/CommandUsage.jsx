import { useMemo, useState } from 'react';
import { CaretDown, CaretUp, MagnifyingGlass, X } from '@phosphor-icons/react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { PROVIDER_NAMES } from '../../../shared/components/AgentIcon';
import { ChartTooltip } from '../../../shared/components/Observability';
import { compact } from '../../../shared/lib/metrics';

const PROVIDER_COLORS = { claude: '#69b5ed', codex: '#70c5ac', copilot: '#a69be8', unknown: '#90a9bd' };
const CATEGORIES = [
  ['file system', 'File system', '#4aa3e8'],
  ['search', 'Search', '#a69be8'],
  ['edit', 'Edit', '#5cc2a0'],
  ['process', 'Process', '#ddb879'],
  ['git', 'Git', '#df929c'],
  ['navigation', 'Navigation', '#7fc4f0'],
  ['environment', 'Environment', '#9fb6c9'],
  ['other', 'Other', '#6e8496'],
];
const TOP_ROWS = 8;

// A command is only counted under a project and a model together when the
// session that ran it matched both; nothing is inferred from the margins.
const callsOf = (command, project, model) => {
  if (project && model) return command.byPair?.[`${project}\u0001${model}`] ?? null;
  if (project) return command.byProject?.[project] ?? null;
  if (model) return command.byModel?.[model] ?? null;
  return command.count;
};

const scaleOf = (command, calls) => (command.count ? calls / command.count : 0);

export function CommandUsage({ commands = [], projects = [], models = [] }) {
  const [search, setSearch] = useState('');
  const [project, setProject] = useState('');
  const [model, setModel] = useState('');
  const [expanded, setExpanded] = useState(false);

  const rows = useMemo(() => commands
    .map((command) => ({ ...command, calls: callsOf(command, project, model) }))
    .filter((command) => Number.isFinite(command.calls) && command.calls > 0)
    .filter((command) => command.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => b.calls - a.calls), [commands, project, model, search]);

  const total = rows.reduce((sum, command) => sum + command.calls, 0);
  const maximum = rows[0]?.calls || 0;
  const visible = expanded ? rows : rows.slice(0, TOP_ROWS);
  // An older payload without the per-provider split still draws, as one unattributed bar.
  const providers = [...new Set(rows.flatMap((command) => Object.keys(command.byProvider || {})))];
  const segments = providers.length ? providers : ['unknown'];
  const segmentOf = (command, provider) => (providers.length ? command.byProvider?.[provider] || 0 : command.count);
  const share = (value) => (total ? `${Math.round((value / total) * 100)}%` : '—');

  const distribution = CATEGORIES
    .map(([id, name, color]) => ({ id, name, color, value: rows.filter((command) => (command.category || 'other') === id).reduce((sum, command) => sum + command.calls, 0) }))
    .filter((slice) => slice.value > 0);

  return <section className="panel-block command-usage">
    <header>
      <div><h2>Command usage</h2><small>Most common commands across all observed runs ({compact(total)} total calls)</small></div>
      <div className="command-usage-controls">
        <label className="search-field"><MagnifyingGlass /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search commands…" aria-label="Search commands" />
          {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><X /></button>}</label>
        <label className="analytics-pill analytics-pill-plain"><select value={project} onChange={(event) => setProject(event.target.value)} aria-label="Project">
          <option value="">All projects</option>{projects.map((name) => <option key={name} value={name}>{name}</option>)}</select><CaretDown /></label>
        <label className="analytics-pill analytics-pill-plain"><select value={model} onChange={(event) => setModel(event.target.value)} aria-label="Model">
          <option value="">All models</option>{models.map((name) => <option key={name} value={name}>{name}</option>)}</select><CaretDown /></label>
      </div>
    </header>
    {rows.length ? <div className="command-usage-body">
      <div className="command-rank">
        <div className="command-rank-head"><span>#</span><span>Command</span><span /><span>Calls</span><span>%</span></div>
        {visible.map((command, index) => <div key={command.name} className="command-rank-row">
          <span>{index + 1}</span>
          <code title={command.name}>{command.name}</code>
          <span className="command-track"><i style={{ width: `${Math.max((command.calls / maximum) * 100, 3)}%`, background: CATEGORIES.find(([id]) => id === (command.category || 'other'))?.[2] }} /></span>
          <code>{command.calls}</code>
          <code>{share(command.calls)}</code>
        </div>)}
        {rows.length > TOP_ROWS && <button type="button" className="analytics-top-link" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : `Show more (${rows.length - TOP_ROWS})`} {expanded ? <CaretUp /> : <CaretDown />}
        </button>}
      </div>

      <div className="command-models">
        <h3>Commands by model</h3>
        <div className="command-models-rows">
          {rows.slice(0, TOP_ROWS).map((command) => {
            const scale = scaleOf(command, command.calls);
            return <div key={command.name} className="command-models-row">
              <code title={command.name}>{command.name}</code>
              <span className="command-track">
                {segments.map((provider) => {
                  const value = segmentOf(command, provider) * scale;
                  return value ? <i key={provider} style={{ width: `${(value / maximum) * 100}%`, background: PROVIDER_COLORS[provider] || PROVIDER_COLORS.unknown }}
                    title={`${PROVIDER_NAMES[provider] || provider}: ${Math.round(value)}`} /> : null;
                })}
              </span>
              <code>{share(command.calls)}</code>
            </div>;
          })}
        </div>
        <div className="command-models-legend">
          {segments.map((provider) => <span key={provider}><i style={{ background: PROVIDER_COLORS[provider] || PROVIDER_COLORS.unknown }} />{PROVIDER_NAMES[provider] || provider}</span>)}
        </div>
      </div>

      <div className="command-types">
        <h3>Command type distribution</h3>
        <div className="command-types-body">
          <div className="command-donut">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={distribution} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="94%" paddingAngle={2} stroke="none">
                  {distribution.map((slice) => <Cell key={slice.id} fill={slice.color} />)}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="command-donut-center"><strong>{compact(total)}</strong><small>calls</small></div>
          </div>
          <div className="command-types-legend">
            {distribution.map((slice) => <div key={slice.id}><i style={{ background: slice.color }} /><span>{slice.name}</span><b>{share(slice.value)}</b></div>)}
          </div>
        </div>
      </div>
    </div> : <p className="empty-evidence">No commands match this filter.</p>}
  </section>;
}

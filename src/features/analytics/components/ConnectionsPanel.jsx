import { Fragment, useMemo, useState } from 'react';
import { CaretDown, DotsThree, FileCode, FolderOpen, Info, MagnifyingGlass, Terminal, X } from '@phosphor-icons/react';
import { AgentIcon } from '../../../shared/components/AgentIcon';
import { colors } from '../../../shared/components/Observability';
import { compact } from '../../../shared/lib/metrics';

const COLUMNS = [
  ['project', 'Projects', 'Ranked by number of sessions, not by tokens: a project with few but heavy sessions ranks lower here than in Top projects.'],
  ['model', 'Models', 'Ranked by number of sessions that used the model.'],
  ['command', 'Commands', 'Ranked by observed calls.'],
  ['file', 'Files', 'Ranked by times the file was touched: reads plus writes.'],
];
const ROWS = 5;
const ROW_HEIGHT = 36;
const ROW_GAP = 6;
const centerOf = (index) => index * (ROW_HEIGHT + ROW_GAP) + ROW_HEIGHT / 2;

const shortName = (node) => {
  if (node.kind !== 'file') return node.name;
  const parts = node.name.split('/').filter(Boolean);
  const file = parts.at(-1) || node.name;
  const parent = parts.at(-2);
  if (!parent) return file;
  const pair = `${parent}/${file}`;
  if (pair.length <= 26) return parts.length > 2 ? `…/${pair}` : pair;
  return file.length <= 26 ? file : `…${file.slice(-25)}`;
};

// Files are ranked by how often they were touched, so the row says with what.
const titleOf = (node) => (node.kind === 'file'
  ? `${node.name} · ${node.reads ?? 0} reads · ${node.writes ?? 0} writes`
  : node.name);

function KindIcon({ node }) {
  if (node.kind === 'project') return <FolderOpen weight="fill" />;
  if (node.kind === 'model') return <AgentIcon id={node.provider} />;
  if (node.kind === 'command') return <Terminal weight="fill" />;
  return <FileCode weight="fill" />;
}

// Each column keeps its heaviest rows and folds the rest into one "Other"
// bucket, so a link always lands on a row that is actually drawn.
function foldColumn(nodes) {
  const sorted = [...nodes].sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
  const total = sorted.reduce((sum, node) => sum + node.weight, 0);
  const head = sorted.slice(0, ROWS);
  const tail = sorted.slice(ROWS);
  const rows = head.map((node) => ({ id: node.id, name: shortName(node), title: titleOf(node), node, weight: node.weight, members: [node.id] }));
  if (tail.length) rows.push({
    id: `other:${sorted[0]?.kind}`, name: 'Other', title: `${tail.length} more`, node: { kind: sorted[0]?.kind, name: 'Other' },
    weight: tail.reduce((sum, node) => sum + node.weight, 0), members: tail.map((node) => node.id), rest: true,
  });
  return { rows, total, count: sorted.length };
}

export function ConnectionsPanel({ graph = { nodes: [], links: [] } }) {
  const [view, setView] = useState('graph');
  const [project, setProject] = useState('');
  const [model, setModel] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');

  const nodeIndex = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph]);
  const projects = graph.nodes.filter((node) => node.kind === 'project');
  const models = graph.nodes.filter((node) => node.kind === 'model');

  const visibleNodes = useMemo(() => {
    // A filter keeps what the picked node reaches downstream plus the column
    // that feeds it, so the remaining chain stays readable end to end.
    const scopeOf = (rootId) => {
      const keep = new Set([rootId]);
      for (let pass = 0; pass < 2; pass += 1) for (const link of graph.links) if (keep.has(link.source)) keep.add(link.target);
      for (const link of graph.links) if (link.target === rootId) keep.add(link.source);
      return keep;
    };
    let allowed = new Set(graph.nodes.map((node) => node.id));
    for (const root of [project, model].filter(Boolean)) {
      const scope = scopeOf(root);
      allowed = new Set([...allowed].filter((id) => scope.has(id)));
    }
    if (search) {
      const term = search.toLowerCase();
      const near = new Set(graph.nodes.filter((node) => allowed.has(node.id) && node.name.toLowerCase().includes(term)).map((node) => node.id));
      for (const link of graph.links) {
        if (near.has(link.source)) near.add(link.target);
        if (near.has(link.target)) near.add(link.source);
      }
      allowed = new Set([...allowed].filter((id) => near.has(id)));
    }
    return graph.nodes.filter((node) => allowed.has(node.id));
  }, [graph, project, model, search]);

  const columns = COLUMNS.map(([kind, label, hint]) => ({ kind, label, hint, ...foldColumn(visibleNodes.filter((node) => node.kind === kind)) }));
  const rowOf = new Map(columns.flatMap((column, columnIndex) => column.rows.flatMap((row, rowIndex) => row.members.map((id) => [id, { row, columnIndex, rowIndex }]))));
  const links = useMemo(() => {
    const merged = new Map();
    for (const link of graph.links) {
      const from = rowOf.get(link.source);
      const to = rowOf.get(link.target);
      if (!from || !to || to.columnIndex !== from.columnIndex + 1) continue;
      const key = `${from.row.id}|${to.row.id}`;
      const entry = merged.get(key) || { gap: from.columnIndex, from: from.rowIndex, to: to.rowIndex, source: from.row, target: to.row, count: 0 };
      entry.count += link.count;
      merged.set(key, entry);
    }
    return [...merged.values()];
  }, [graph, rowOf]);

  const neighbours = useMemo(() => {
    if (!selected) return null;
    const near = new Set([selected]);
    for (const link of links) {
      if (link.source.id === selected) near.add(link.target.id);
      if (link.target.id === selected) near.add(link.source.id);
    }
    return near;
  }, [links, selected]);

  const height = Math.max(...columns.map((column) => column.rows.length), 1) * (ROW_HEIGHT + ROW_GAP) - ROW_GAP;
  const dim = (id) => (neighbours && !neighbours.has(id) ? 'dim' : '');
  const tableRows = [...links].sort((a, b) => b.count - a.count).slice(0, 40);

  return <section className="panel-block connections-panel">
    <header>
      <div><h2>Observed connections</h2><small>Project → model → commands → files. A connection means use in the same session, not causality.</small></div>
      <div className="connections-controls">
        <label className="analytics-pill analytics-pill-plain"><span>Project</span><select value={project} onChange={(event) => setProject(event.target.value)} aria-label="Project">
          <option value="">All</option>{projects.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select><CaretDown /></label>
        <label className="analytics-pill analytics-pill-plain"><span>Model</span><select value={model} onChange={(event) => setModel(event.target.value)} aria-label="Model">
          <option value="">All</option>{models.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select><CaretDown /></label>
        <label className="search-field"><MagnifyingGlass /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search project, model, command or file…" aria-label="Search connections" />
          {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><X /></button>}</label>
        <div className="view-toggle">
          <button type="button" className={view === 'graph' ? 'active' : ''} onClick={() => setView('graph')}>Graph</button>
          <button type="button" className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>Table</button>
        </div>
      </div>
    </header>

    {!visibleNodes.length ? <p className="empty-evidence">No connections match this filter.</p> : view === 'graph' ? <div className="connections-grid">
      {columns.map((column, columnIndex) => <Fragment key={column.kind}>
        <div className="connections-column">
          <header><span>{column.label}</span><b>{compact(column.count)}</b>
            <span className="connections-hint" tabIndex={0} role="note" aria-label={column.hint} data-hint={column.hint}><Info /></span></header>
          <div className="connections-rows">
            {column.rows.map((row, rowIndex) => <button key={row.id} type="button" title={row.title}
              className={`connections-row ${dim(row.id)} ${selected === row.id ? 'selected' : ''}`}
              style={{ '--row-color': colors[rowIndex % colors.length] }}
              onClick={() => setSelected(selected === row.id ? '' : row.id)}>
              <i className="connections-row-icon">{row.rest ? <DotsThree weight="bold" /> : <KindIcon node={row.node} />}</i>
              <span>{row.name}</span>
              <b>{column.kind === 'file' ? compact(row.weight) : column.total ? `${Math.round((row.weight / column.total) * 100)}%` : '—'}</b>
            </button>)}
          </div>
        </div>
        {columnIndex < COLUMNS.length - 1 && <svg className="connections-ribbons" style={{ height }} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true">
          {links.filter((link) => link.gap === columnIndex).map((link) => <path key={`${link.source.id}|${link.target.id}`}
            d={`M0,${centerOf(link.from)} C42,${centerOf(link.from)} 58,${centerOf(link.to)} 100,${centerOf(link.to)}`}
            stroke={colors[link.from % colors.length]} strokeWidth={Math.min(6, 1 + Math.log2(link.count + 1))} fill="none" vectorEffect="non-scaling-stroke"
            opacity={!neighbours ? 0.32 : neighbours.has(link.source.id) && neighbours.has(link.target.id) ? 0.75 : 0.07} />)}
        </svg>}
      </Fragment>)}
    </div> : <div className="connections-table">
      <div className="connections-table-head"><span>Source</span><span>Target</span><span>Sessions</span></div>
      {tableRows.map((link) => <div key={`${link.source.id}|${link.target.id}`} className="connections-table-row">
        <span><i className="connections-row-icon" style={{ '--row-color': colors[link.from % colors.length] }}>{link.source.rest ? <DotsThree weight="bold" /> : <KindIcon node={link.source.node} />}</i><code title={link.source.title}>{link.source.name}</code></span>
        <span><i className="connections-row-icon" style={{ '--row-color': colors[link.to % colors.length] }}>{link.target.rest ? <DotsThree weight="bold" /> : <KindIcon node={link.target.node} />}</i><code title={link.target.title}>{link.target.name}</code></span>
        <code>{compact(link.count)}</code>
      </div>)}
    </div>}
    {view === 'graph' && <p className="empty-evidence">{nodeIndex.size ? `${visibleNodes.length} of ${nodeIndex.size} observed nodes. Top ${ROWS} per column; the rest is folded into “Other”.` : ''}</p>}
  </section>;
}

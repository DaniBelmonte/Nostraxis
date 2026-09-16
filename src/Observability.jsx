import { useMemo, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { compact, money } from './lib';

export const colors = ['#69b5ed', '#a69be8', '#70c5ac', '#ddb879', '#df929c', '#90a9bd'];
export function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return <div className="readable-tooltip"><strong>{label || payload[0]?.payload?.name || payload[0]?.payload?.model || 'Measurement'}</strong>{payload.filter(p => p.value != null).map((p,i) => <div key={i}><span style={{ color: p.color }}>{p.name || p.dataKey}</span><b>{/cost/i.test(p.dataKey || p.name) ? money(p.value) : compact(p.value)}</b><small>{Number(p.value).toLocaleString('en-GB', { maximumFractionDigits: 6 })}</small></div>)}</div>;
}

export function DateRange({ from, to, onChange }) {
  const preset = days => {
    if (!days) return onChange({ from: '', to: '' });
    const end = new Date(), start = new Date();
    start.setDate(start.getDate() - days + 1);
    const local = d => [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
    onChange({ from: local(start), to: local(end) });
  };
  return <div className="date-range"><span>Session start</span>{[[1,'Today'],[7,'7 days'],[30,'30 days'],[0,'All']].map(([days,label]) => <button key={label} onClick={() => preset(days)}>{label}</button>)}<label>From<input aria-label="From" type="date" value={from} max={to || undefined} onChange={e => onChange({ from: e.target.value, to })} /></label><label>To<input aria-label="To" type="date" value={to} min={from || undefined} onChange={e => onChange({ from, to: e.target.value })} /></label></div>;
}

export function CommandChart({ commands = [] }) {
  const first = commands.slice(0, 8);
  const rest = commands.slice(8).reduce((n,c) => n+c.count, 0);
  const data = rest ? [...first, { name: 'Other', count: rest }] : first;
  return <section className="panel-block"><header><h2>Most-used commands</h2><small>Observed calls · {compact(commands.reduce((n,c) => n+c.count,0))}</small></header>{data.length ? <div className="command-chart"><ResponsiveContainer width="50%" height={260}><PieChart><Pie data={data} dataKey="count" nameKey="name" innerRadius={65} outerRadius={100} paddingAngle={2}>{data.map((d,i) => <Cell key={d.name} fill={colors[i%colors.length]} />)}</Pie><Tooltip content={<ChartTooltip />} /></PieChart></ResponsiveContainer><div className="command-legend">{data.map((d,i) => <div key={d.name}><i style={{ background: colors[i%colors.length] }} /><code title={d.name}>{d.name}</code><b>{compact(d.count)}</b></div>)}</div></div> : <p className="empty-evidence">No commands captured in this period.</p>}</section>;
}

export function ConnectionGraph({ graph = { nodes: [], links: [] } }) {
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const nodes = useMemo(() => {
    const matching = graph.nodes.filter(n => n.name.toLowerCase().includes(search.toLowerCase()));
    const allowed = new Set(matching.map(n => n.id));
    if (search) for (const l of graph.links) { if (matching.some(n => n.id === l.source || n.id === l.target)) { allowed.add(l.source); allowed.add(l.target); } }
    return graph.nodes.filter(n => allowed.has(n.id));
  }, [graph, search]);
  const columns = ['project','model','command','file'];
  const displayed = columns.flatMap((kind, col) => nodes.filter(n => n.kind === kind).slice(0,12).map((n,i) => ({ ...n, x: col*260+10, y: i*47+45 })));
  const index = new Map(displayed.map(n => [n.id,n]));
  const links = graph.links.filter(l => index.has(l.source) && index.has(l.target));
  const neighbors = new Set([selected, ...links.filter(l => l.source === selected || l.target === selected).flatMap(l => [l.source,l.target])]);
  return <section className="panel-block"><header><div><h2>Observed connections</h2><small>Project → model → commands and files. A connection means use in the same session, not causality.</small></div><input aria-label="Search graph" placeholder="Search project, model or file…" value={search} onChange={e => setSearch(e.target.value)} /></header><div className="graph-scroll"><svg viewBox="0 0 1050 640" role="img" aria-label="Project, model, command and file graph">{['Projects','Models','Commands','Files'].map((name,i) => <text key={name} x={i*260+10} y={22} fill="#94aabd" fontSize="13">{name}</text>)}{links.map(l => { const a=index.get(l.source),b=index.get(l.target); return <path key={l.source+l.target} d={`M${a.x+220},${a.y+16} C${a.x+250},${a.y+16} ${b.x-30},${b.y+16} ${b.x},${b.y+16}`} fill="none" stroke={selected && neighbors.has(l.source) && neighbors.has(l.target) ? '#79bfee' : '#334755'} opacity={!selected || neighbors.has(l.source) && neighbors.has(l.target) ? .8 : .12}><title>{a.name} → {b.name}: {l.count} sessions</title></path>; })}{displayed.map(n => <g key={n.id} role="button" tabIndex="0" aria-label={n.name} onClick={() => setSelected(selected === n.id ? '' : n.id)} onKeyDown={e => { if(e.key==='Enter') setSelected(selected===n.id?'':n.id); }} opacity={!selected || neighbors.has(n.id) ? 1 : .3}><title>{n.name}</title><rect x={n.x} y={n.y} width={220} height={33} rx="4" fill="#13232f" stroke={selected===n.id?'#79bfee':'#314451'} /><text x={n.x+9} y={n.y+21} fill="#d6e3ec" fontSize="11">{n.name.length>29?n.name.slice(0,26)+'…':n.name}</text></g>)}</svg></div><p className="empty-evidence">{displayed.length} of {graph.nodes.length} nodes. Up to 12 per column; search to explore the rest. {selected && graph.nodes.find(n=>n.id===selected)?.name}</p></section>;
}

export function Conversation({ detail }) {
  const initial = detail.run.prompt || detail.events.find(e=>e.type==='agent.input')?.data?.text;
  const responses = detail.events.filter(e=>e.type==='agent.output' && e.data?.text);
  return <div className="conversation"><section><h3>Initial prompt</h3><pre>{initial || 'The available history does not expose the initial prompt.'}</pre></section><section><h3>Available final response</h3><pre>{detail.run.response || 'No final response was captured.'}</pre></section><details><summary>Observed responses ({responses.length})</summary>{responses.map(e=><article key={e.id}><time>{new Date(e.timestamp).toLocaleString('en-GB')}</time><pre>{e.data.text}</pre></article>)}</details></div>;
}

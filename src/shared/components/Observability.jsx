import { useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { compact, money } from '../lib/metrics';

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

export function Conversation({ detail }) {
  const initial = detail.run.prompt || detail.events.find(e=>e.type==='agent.input')?.data?.text;
  const responses = detail.events.filter(e=>e.type==='agent.output' && e.data?.text);
  return <div className="conversation"><section><h3>Initial prompt</h3><pre>{initial || 'The available history does not expose the initial prompt.'}</pre></section><section><h3>Available final response</h3><pre>{detail.run.response || 'No final response was captured.'}</pre></section><details><summary>Observed responses ({responses.length})</summary>{responses.map(e=><article key={e.id}><time>{new Date(e.timestamp).toLocaleString('en-GB')}</time><pre>{e.data.text}</pre></article>)}</details></div>;
}

import { useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Segmented } from './CompareCharts';
import { RunHeading } from './MetricMatrix';
import { MODEL_COLORS, OTHER_MODEL_COLOR } from '../model/comparison';

const OTHER = 'Other';
const MODES = {
  tools: { label: 'Tools', pick: (row) => row.toolBreakdown, empty: 'No tool calls reported.' },
  commands: { label: 'Shell commands', pick: (row) => row.commandBreakdown, empty: 'No shell commands reported.' },
};

function SliceTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const slice = payload[0].payload;
  return <div className="readable-tooltip"><strong>{slice.name}</strong><div><span>Calls</span><b>{slice.value}</b></div><div><span>Share</span><b>{Math.round(slice.share * 100)}%</b></div>{slice.names && <p className="tools-other">{slice.names.join(', ')}</p>}</div>;
}

// One donut per run. A tool keeps its colour in every run. The named slices
// are each run's three most used names, then the most used overall, up to the
// colours of the ramp; the rest fold into "Other".
export function CompareTools({ rows, colors }) {
  const [mode, setMode] = useState('tools');
  const { pick, empty } = MODES[mode];
  const totals = new Map();
  rows.forEach((row) => (pick(row) || []).forEach((item) => totals.set(item.name, (totals.get(item.name) || 0) + item.count)));
  const ranked = (items) => [...items].sort((a, b) => b.count - a.count).map((item) => item.name);
  const named = [...new Set([
    ...rows.flatMap((row) => ranked(pick(row) || []).slice(0, 3)),
    ...[...totals].sort((a, b) => b[1] - a[1]).map(([name]) => name),
  ])].slice(0, MODEL_COLORS.length);
  const colorOf = (name) => name === OTHER ? OTHER_MODEL_COLOR : MODEL_COLORS[named.indexOf(name)];
  const slicesOf = (row) => {
    const items = pick(row) || [];
    const total = items.reduce((sum, item) => sum + item.count, 0);
    const rest = items.filter((item) => !named.includes(item.name));
    const slices = named.map((name) => items.find((item) => item.name === name)).filter(Boolean).map((item) => ({ name: item.name, value: item.count, share: item.count / total }));
    const other = rest.reduce((sum, item) => sum + item.count, 0);
    if (other) slices.push({ name: OTHER, value: other, share: other / total, names: rest.sort((a, b) => b.count - a.count).slice(0, 12).map((item) => `${item.name} ×${item.count}`) });
    return { slices, total };
  };
  return <div className="compare-tab-grid">
    <section className="panel-block compare-wide">
      <header><div><span>Tools</span><h2>{MODES[mode].label} used by each run</h2></div><Segmented label="Show" value={mode} options={Object.entries(MODES).map(([id, item]) => [id, item.label])} onChange={setMode} /></header>
      <div className="compare-legend">{[...named, ...(rows.some((row) => slicesOf(row).slices.some((slice) => slice.name === OTHER)) ? [OTHER] : [])].map((name) => <span key={name}><i style={{ background: colorOf(name) }} />{name}</span>)}</div>
      <div className="tools-pies">{rows.map((row, index) => {
        const { slices, total } = slicesOf(row);
        return <article key={row.key} className="tools-pie" style={{ borderTopColor: colors[index] }}>
          <RunHeading row={row} color={colors[index]} />
          {total ? <>
            <div className="tools-pie-chart">
              <ResponsiveContainer width="100%" height="100%"><PieChart>
                <Pie data={slices} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="92%" paddingAngle={1} stroke="#0d202d" strokeWidth={2} isAnimationActive={false}>
                  {slices.map((slice) => <Cell key={slice.name} fill={colorOf(slice.name)} />)}
                </Pie>
                <Tooltip content={<SliceTooltip />} isAnimationActive={false} />
              </PieChart></ResponsiveContainer>
              <div className="tools-pie-total"><strong>{total}</strong><small>calls</small></div>
            </div>
            <ul className="tools-pie-list">{slices.map((slice) => <li key={slice.name}><i style={{ background: colorOf(slice.name) }} /><span title={slice.names?.join(', ') || slice.name}>{slice.name}</span><b>{slice.value}</b><small>{Math.round(slice.share * 100)}%</small></li>)}</ul>
          </> : <p className="empty-evidence">{empty}</p>}
        </article>;
      })}</div>
    </section>
  </div>;
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { duration } from '../../../shared/lib/metrics';
import { Segmented } from './CompareCharts';
import { RunHeading } from './MetricMatrix';
import { runLabel } from '../model/comparison';

const finite = Number.isFinite;
const LABEL_WIDTH = 132;
const ROW = 9;
const ROW_GAP = 2;
const MAX_ROWS = 6;
const MARKER_ROW = 16;
const AXIS_HEIGHT = 20;
const STRIP = 22;
const STEPS = [5e3, 10e3, 15e3, 30e3, 60e3, 120e3, 300e3, 600e3, 900e3, 1800e3, 3600e3, 7200e3];

// Lane families share a hue; the lane label carries the exact kind of work.
const FAMILIES = [
  ['model', 'Model', '#5d7383', (lane) => lane === 'model'],
  ['read', 'Read & search', '#199e70', (lane) => lane === 'read' || lane === 'search'],
  ['edit', 'Edit', '#d95926', (lane) => lane === 'edit'],
  ['shell', 'Shell', '#9085e9', (lane) => lane === 'shell'],
  ['web', 'Web & MCP', '#c98500', (lane) => lane === 'web' || lane === 'mcp'],
  ['agents', 'Delegation & subagents', '#d55181', (lane) => lane === 'subagent' || lane.startsWith('agent:')],
  ['other', 'Other tools', '#3987e5', () => true],
];
const familyOf = (lane) => FAMILIES.find(([, , , test]) => test(lane));

const clock = (ms) => {
  const seconds = Math.round(ms / 1000);
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}h`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
const span = (ms) => !finite(ms) ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : duration(ms);

function useWidth(ref) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return width;
}

// Packs overlapping spans of a lane into rows so parallel work is visible.
function pack(spans, x) {
  const ends = [];
  return spans.map((item) => {
    const left = x(item.start);
    let row = ends.findIndex((end) => end <= left);
    if (row === -1) row = ends.length < MAX_ROWS ? ends.length : MAX_ROWS - 1;
    ends[row] = Math.max(left + 1, x(item.end));
    return { ...item, row };
  });
}

function RunLanes({ row, color, extent, axis, zoom }) {
  const frame = useRef(null);
  const width = useWidth(frame);
  const [hover, setHover] = useState(null);
  const schedule = row.schedule;
  const plot = Math.max(240, (width - LABEL_WIDTH - 8) * zoom);
  const startOf = (item) => axis === 'active' ? item.start : item.wallStart;
  const endOf = (item) => axis === 'active' ? item.end : item.wallEnd;
  const x = (value) => (Math.max(0, value) / Math.max(extent, 1)) * plot;
  const lanes = useMemo(() => schedule.lanes.map((lane) => {
    const own = schedule.spans.filter((item) => item.lane === lane.id).map((item) => ({ ...item, start: startOf(item), end: endOf(item) }));
    const packed = pack(own.filter((item) => !item.window).sort((a, b) => a.start - b.start), x);
    const rows = Math.max(1, ...packed.map((item) => item.row + 1));
    return { ...lane, spans: packed, windows: own.filter((item) => item.window), rows, family: familyOf(lane.id) };
  }), [schedule, axis, plot, extent]);
  let top = MARKER_ROW;
  const placed = lanes.map((lane) => {
    const height = lane.rows * (ROW + ROW_GAP) + 6;
    const entry = { ...lane, top, height };
    top += height;
    return entry;
  });
  const stripTop = top + 4;
  const height = stripTop + STRIP + AXIS_HEIGHT;
  const step = STEPS.find((value) => plot / (extent / value) >= 70) || STEPS.at(-1);
  const ticks = Array.from({ length: Math.floor(extent / step) + 1 }, (_, index) => index * step);
  const levels = schedule.concurrency || [];
  const maxLevel = Math.max(1, ...levels.map((point) => point.level));
  const strip = axis === 'active' && levels.length > 1
    ? levels.map((point, index) => `${index ? 'L' : 'M'}${x(point.t).toFixed(1)},${(stripTop + STRIP - (index ? levels[index - 1].level : 0) / maxLevel * (STRIP - 4)).toFixed(1)}L${x(point.t).toFixed(1)},${(stripTop + STRIP - point.level / maxLevel * (STRIP - 4)).toFixed(1)}`).join('') + `L${x(levels.at(-1).t).toFixed(1)},${stripTop + STRIP}Z`
    : null;
  const own = axis === 'active' ? schedule.activeMs : schedule.wallMs;
  const markerColor = { input: '#e3edf3', output: '#56bcff', error: '#e66767', compaction: '#c98500' };
  const show = (event, item) => {
    const box = frame.current.getBoundingClientRect();
    setHover({ item, left: Math.max(0, Math.min(event.clientX - box.left + 12, box.width - 230)), top: event.clientY - box.top + 12 });
  };

  return <article className="timeline-run" style={{ borderLeftColor: color }}>
    <header className="timeline-run-head">
      <RunHeading row={row} color={color} />
      <dl>
        <dt>{axis === 'active' ? 'Active' : 'Wall clock'}</dt><dd>{duration(own)}</dd>
        <dt>Model</dt><dd>{schedule.activeMs ? `${Math.round(schedule.summary.modelMs / schedule.activeMs * 100)}%` : '—'}</dd>
        <dt>Tools</dt><dd>{schedule.activeMs ? `${Math.round(schedule.summary.toolMs / schedule.activeMs * 100)}%` : '—'}</dd>
        <dt>In parallel</dt><dd>{finite(schedule.summary.parallelShare) ? `${Math.round(schedule.summary.parallelShare * 100)}% · max ${schedule.summary.maxConcurrency}` : 'Not measured'}</dd>
      </dl>
    </header>
    <div className="timeline-frame" ref={frame} onMouseLeave={() => setHover(null)}>
      <div className="timeline-labels" style={{ width: LABEL_WIDTH, height }}>
        <span style={{ top: 0, height: MARKER_ROW }}>Events</span>
        {placed.map((lane) => <span key={lane.id} style={{ top: lane.top, height: lane.height }} title={`${lane.label}: ${lane.calls} calls · busy ${span(lane.busyMs)}${lane.failed ? ` · ${lane.failed} failed` : ''}`}>
          <i style={{ background: lane.family[2] }} />{lane.id.startsWith('agent:') ? `↳ ${lane.label.replace(/^Subagent · /, '')}` : lane.label}<small>{lane.id === 'model' ? span(lane.busyMs) : lane.calls}</small>
        </span>)}
        {strip && <span style={{ top: stripTop, height: STRIP }} title="Tool calls and subagents running at the same time">At once<small>max {maxLevel}</small></span>}
      </div>
      <div className="timeline-scroll">
        <svg width={plot} height={height} role="img" aria-label={`Schedule of ${runLabel(row)}: ${placed.map((lane) => `${lane.label} ${lane.calls} calls`).join(', ')}`}>
          {ticks.map((tick) => <g key={tick}>
            <line x1={x(tick)} x2={x(tick)} y1={MARKER_ROW} y2={stripTop + STRIP} stroke="#1b3040" />
            <text x={x(tick) + 3} y={height - 6} className="timeline-tick">{clock(tick)}</text>
          </g>)}
          {own < extent && <rect x={x(own)} y={MARKER_ROW} width={Math.max(0, plot - x(own))} height={stripTop + STRIP - MARKER_ROW} fill="#0a1720" />}
          {placed.map((lane, index) => <g key={lane.id}>
            {index % 2 === 1 && <rect x={0} y={lane.top} width={plot} height={lane.height} fill="#0f2230" opacity={0.6} />}
            {lane.windows.map((item) => <rect key={`w${item.start}`} x={x(item.start)} y={lane.top + 1} width={Math.max(2, x(item.end) - x(item.start))} height={lane.height - 2} fill={lane.family[2]} opacity={0.14} rx={3} />)}
            {lane.spans.map((item, spanIndex) => <rect key={spanIndex} x={x(item.start)} y={lane.top + 3 + item.row * (ROW + ROW_GAP)} width={Math.max(1.5, x(item.end) - x(item.start))} height={ROW} rx={2}
              fill={lane.family[2]} fillOpacity={item.estimated ? 0.35 : 0.95}
              stroke={item.status === 'failed' ? '#ff8a8a' : item.estimated ? lane.family[2] : 'none'} strokeWidth={item.status === 'failed' ? 1.5 : 1} strokeDasharray={item.estimated ? '2 2' : undefined}
              onMouseMove={(event) => show(event, { ...item, lane: lane.label })} />)}
          </g>)}
          {(schedule.markers || []).map((marker, index) => {
            const at = x(axis === 'active' ? marker.t : marker.wall);
            return <g key={index} onMouseMove={(event) => show(event, { marker: true, kind: marker.kind, label: marker.label, start: axis === 'active' ? marker.t : marker.wall })}>
              {marker.kind === 'input' ? <path d={`M${at - 4},2L${at + 4},2L${at},10Z`} fill={markerColor.input} />
                : marker.kind === 'compaction' ? <path d={`M${at},2L${at + 4},7L${at},12L${at - 4},7Z`} fill={markerColor.compaction} />
                  : marker.kind === 'error' ? <path d={`M${at - 3},3L${at + 3},11M${at + 3},3L${at - 3},11`} stroke={markerColor.error} strokeWidth={2} />
                    : <circle cx={at} cy={7} r={2.5} fill={markerColor.output} />}
              {marker.kind === 'input' && <line x1={at} x2={at} y1={MARKER_ROW} y2={stripTop + STRIP} stroke="#e3edf3" strokeOpacity={0.25} strokeDasharray="3 3" />}
            </g>;
          })}
          {strip && <path d={strip} fill="#56bcff" fillOpacity={0.35} stroke="#56bcff" strokeWidth={1} />}
        </svg>
      </div>
      {hover && <div className="readable-tooltip timeline-tooltip" style={{ left: hover.left, top: hover.top }}>
        {hover.item.marker
          ? <><strong>{{ input: 'User prompt', output: 'Response', error: 'Error', compaction: 'Context compacted' }[hover.item.kind]}</strong>{hover.item.label && <p>{hover.item.label}</p>}<div><span>At</span><b>{clock(hover.item.start)}</b></div></>
          : <><strong>{hover.item.lane} · {hover.item.tool === 'model' ? 'model working' : hover.item.tool}</strong>{hover.item.label && hover.item.tool !== 'model' && <p>{hover.item.label}</p>}
            <div><span>Start</span><b>{clock(hover.item.start)}</b></div>
            <div><span>Duration</span><b>{span(hover.item.end - hover.item.start)}{hover.item.estimated ? ' (estimated)' : ''}</b></div>
            {hover.item.status && <div><span>Status</span><b>{hover.item.status}</b></div>}</>}
      </div>}
    </div>
    {schedule.clipped && <p className="unavailable-note compare-chart-note">Very long run: only the first 3,000 activities are drawn.</p>}
  </article>;
}

export function RunTimeline({ rows, colors }) {
  const [axis, setAxis] = useState('active');
  const [zoom, setZoom] = useState(1);
  const runs = rows.map((row, index) => ({ row, color: colors[index] })).filter((item) => item.row.schedule);
  if (!runs.length) return <p className="empty-evidence">None of the compared runs has timed events to draw.</p>;
  // Each run fills the width with its own duration, so a short run is read as
  // closely as a long one.
  const lengthOf = (row) => axis === 'active' ? row.schedule.activeMs : row.schedule.wallMs;
  return <div className="compare-tab-grid">
    <section className="panel-block compare-wide timeline-panel">
      <header>
        <div><span>Full run, schematic</span><h2>What each run was doing, minute by minute</h2></div>
        <div className="compare-chart-controls">
          <Segmented label="Time axis" value={axis} options={[['active', 'Active time'], ['wall', 'Wall clock']]} onChange={setAxis} />
          <Segmented label="Zoom" value={String(zoom)} options={[['1', '1×'], ['2', '2×'], ['4', '4×'], ['8', '8×']]} onChange={(value) => setZoom(Number(value))} />
        </div>
      </header>
      <div className="timeline-legend">
        {FAMILIES.map(([id, label, fill]) => <span key={id}><i style={{ background: fill }} />{label}</span>)}
        <span><i className="timeline-estimated" />End not reported (estimated)</span>
        <span><i className="timeline-failed" />Failed</span>
        <span><b className="timeline-mark-input">▼</b>User prompt</span>
        <span><b className="timeline-mark-output">●</b>Response</span>
        <span><b className="timeline-mark-compaction">◆</b>Compaction</span>
      </div>
      <div className="timeline-runs">{runs.map((item) => <RunLanes key={item.row.key} row={item.row} color={item.color} axis={axis} zoom={zoom} extent={Math.max(1, lengthOf(item.row))} />)}</div>
      <p className="unavailable-note compare-chart-note">Each bar is one tool call from its start to its end as the provider logged them. "Model" is the main agent's time between events while none of its tools ran. Active time removes the wait for the user and silences longer than 20 minutes; the wall clock keeps them. Stacked bars in one lane ran at the same time.</p>
    </section>
  </div>;
}

import { activeOffsets, isUserAction, MAX_WORK_GAP_MS } from '../core/timing.mjs';
import { toolCategory } from './comparison.mjs';

// A schematic schedule of one run: what the agent was doing at each moment,
// one lane per kind of work, so overlapping work is visible. Times are kept on
// two axes: the active clock used everywhere else (silences and the wait for
// the user removed) and the wall clock.
const MAX_SPANS = 3000;
const LABEL = 120;

export const SCHEDULE_LANES = [
  ['model', 'Model'], ['read', 'Read'], ['search', 'Search'], ['edit', 'Edit'], ['shell', 'Shell'],
  ['web', 'Web'], ['mcp', 'MCP'], ['subagent', 'Delegation'], ['planning', 'Planning'], ['memory', 'Memory'], ['other', 'Other tools'],
];

const short = (value) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, LABEL) : null;
const isStart = (event) => !event.type.endsWith('completed') && !event.data?.inferred && Boolean(event.data?.tool || event.data?.command)
  && /^agent\.(?:tool_called|tool_started|command_started|file_read|file_modified)$/.test(event.type);
const isEnd = (event) => event.type === 'agent.tool_completed' || event.type === 'agent.command_completed';

// Length of the union of intervals.
const covered = (intervals) => {
  let total = 0, end = -Infinity;
  for (const [start, stop] of [...intervals].sort((a, b) => a[0] - b[0])) {
    if (stop <= end) continue;
    total += stop - Math.max(start, end);
    end = stop;
  }
  return total;
};

// Removes the parts of [start, stop] covered by sorted, merged intervals.
const subtract = (start, stop, intervals) => {
  const parts = [];
  let cursor = start;
  for (const [a, b] of intervals) {
    if (b <= cursor) continue;
    if (a >= stop) break;
    if (a > cursor) parts.push([cursor, a]);
    cursor = Math.max(cursor, b);
    if (cursor >= stop) break;
  }
  if (cursor < stop) parts.push([cursor, stop]);
  return parts;
};

const merge = (intervals) => {
  const merged = [];
  for (const [a, b] of [...intervals].sort((x, y) => x[0] - y[0])) {
    const last = merged.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
};

export function buildSchedule(events, { agentNames = {} } = {}) {
  const offsets = activeOffsets(events);
  const points = events.map((event, index) => ({ event, index, t: offsets[index], wall: Date.parse(event.timestamp || '') }))
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.wall));
  if (!points.length) return null;
  const firstWall = points[0].wall;
  const spans = [], markers = [];
  const byCall = new Map(), byTool = new Map();
  // The next point that moved on, on either clock, for every point.
  const following = new Array(points.length).fill(null);
  for (let position = points.length - 2; position >= 0; position--) {
    const next = points[position + 1];
    following[position] = next.t > points[position].t || next.wall > points[position].wall ? next : following[position + 1];
  }
  const nextPoint = (position) => following[position];
  const laneOf = (event, name) => event.data?.agent ? `agent:${event.data.agent}` : toolCategory(name, event.type);
  const agents = new Map();

  points.forEach((point, position) => {
    const { event } = point;
    const data = event.data || {};
    if (data.agent) {
      const window = agents.get(data.agent) || { start: point, end: point };
      window.end = point;
      agents.set(data.agent, window);
    }
    if (isUserAction(event)) markers.push({ kind: 'input', t: point.t, wall: point.wall - firstWall, label: short(data.text) });
    else if (event.type === 'agent.output' && !data.agent) markers.push({ kind: 'output', t: point.t, wall: point.wall - firstWall, label: short(data.text) });
    else if (event.type === 'agent.error') markers.push({ kind: 'error', t: point.t, wall: point.wall - firstWall, label: short(data.text) });
    else if (data.compaction) markers.push({ kind: 'compaction', t: point.t, wall: point.wall - firstWall, label: 'Context compacted' });
    if (isStart(event)) {
      const name = data.tool || 'shell';
      const span = {
        lane: laneOf(event, name), tool: name, label: short(data.command || data.path || data.text || name),
        start: point.t, wallStart: point.wall - firstWall, end: null, wallEnd: null,
        status: null, estimated: false, agent: data.agent || null, position, callId: data.callId || null,
      };
      spans.push(span);
      if (data.callId) byCall.set(data.callId, span);
      byTool.set(name, [...(byTool.get(name) || []), span]);
    } else if (isEnd(event)) {
      // Pair by the provider's call id. A start stored before ids and agents
      // were kept pairs with the latest open call of the same tool that began
      // within the work gap, and takes the agent from its end; older open
      // calls stay estimates rather than stretch across later work.
      const name = data.tool || (data.command ? 'shell' : '');
      let span = data.callId ? byCall.get(data.callId) : null;
      if (!span || span.end != null) {
        const open = (byTool.get(name) || []).filter((item) => item.end == null && !item.callId && point.wall - firstWall - item.wallStart <= MAX_WORK_GAP_MS).reverse();
        span = open.find((item) => (item.agent || null) === (data.agent || null)) || open.find((item) => !item.agent) || null;
      }
      if (span && span.end == null) {
        span.end = point.t; span.wallEnd = point.wall - firstWall;
        span.status = data.status || (Number.isFinite(data.exitCode) && data.exitCode !== 0 ? 'failed' : 'completed');
        if (!span.agent && data.agent) { span.agent = data.agent; span.lane = `agent:${data.agent}`; }
      }
    }
  });

  // A call whose end was not reported lasts until the run reported anything
  // else; calls logged at the same instant share that time one after another.
  // Both are estimates, and estimates never count as parallel work.
  const pending = new Map();
  for (const span of spans.filter((item) => item.end == null)) {
    const key = `${span.agent || ''}|${span.start}|${span.wallStart}`;
    pending.set(key, [...(pending.get(key) || []), span]);
  }
  for (const group of pending.values()) {
    const next = nextPoint(group.at(-1).position);
    const first = group[0];
    const length = next ? Math.max(0, next.t - first.start) / group.length : 0;
    const wallLength = next ? Math.max(0, next.wall - firstWall - first.wallStart) / group.length : 0;
    group.forEach((span, index) => {
      span.start = first.start + length * index; span.end = span.start + length;
      span.wallStart = first.wallStart + wallLength * index; span.wallEnd = span.wallStart + wallLength;
      span.estimated = true;
    });
  }

  // The main agent is waiting on the model whenever it is working and no tool
  // of its own is running.
  const mainTools = merge(spans.filter((span) => !span.agent).map((span) => [span.start, span.end]));
  const modelSpans = [];
  for (let position = 0; position < points.length - 1; position++) {
    const a = points[position], b = points[position + 1];
    if (a.event.data?.agent || isUserAction(b.event) || b.t <= a.t) continue;
    const parts = subtract(a.t, b.t, mainTools);
    const scale = (b.wall - a.wall) / (b.t - a.t);
    for (const [start, end] of parts) {
      const wallStart = a.wall - firstWall + (start - a.t) * scale;
      const wallEnd = a.wall - firstWall + (end - a.t) * scale;
      const last = modelSpans.at(-1);
      if (last && start - last.end < 1) { last.end = end; last.wallEnd = wallEnd; }
      else modelSpans.push({ lane: 'model', tool: 'model', label: 'Model working', start, end, wallStart, wallEnd, status: null, estimated: false, agent: null });
    }
  }

  const agentSpans = [...agents].map(([id, window]) => ({
    lane: `agent:${id}`, tool: 'agent', label: agentNames[id] || id, start: window.start.t, end: window.end.t,
    wallStart: window.start.wall - firstWall, wallEnd: window.end.wall - firstWall, status: null, estimated: false, agent: id, window: true,
  }));

  const all = [...modelSpans, ...spans.map(({ position, callId, ...span }) => span), ...agentSpans];
  const laneIds = [...new Set(all.map((span) => span.lane))];
  const known = SCHEDULE_LANES.map(([id]) => id);
  const lanes = laneIds.sort((a, b) => (known.includes(a) ? known.indexOf(a) : 100) - (known.includes(b) ? known.indexOf(b) : 100) || a.localeCompare(b)).map((id) => {
    const own = all.filter((span) => span.lane === id && !span.window);
    return {
      id, label: id.startsWith('agent:') ? `Subagent · ${agentNames[id.slice(6)] || id.slice(6)}` : SCHEDULE_LANES.find(([lane]) => lane === id)?.[1] || id,
      calls: own.filter((span) => span.tool !== 'model').length,
      busyMs: covered(own.map((span) => [span.start, span.end])),
      failed: own.filter((span) => span.status === 'failed').length,
    };
  });

  // Concurrency counts what runs at the same instant: measured tool calls of
  // the main agent and each subagent as one thread. A subagent's own calls and
  // the main agent's delegation call are that same thread, not extra work.
  const work = [
    ...spans.filter((span) => !span.estimated && !span.agent && !(agentSpans.length && span.lane === 'subagent')),
    ...agentSpans,
  ].filter((span) => span.end > span.start);
  const edges = work.flatMap((span) => [[span.start, 1], [span.end, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let level = 0, previous = null, maxConcurrency = work.length ? 1 : null, parallelMs = work.length ? 0 : null;
  const concurrency = [];
  for (const [t, change] of edges) {
    if (previous != null && level >= 2) parallelMs += t - previous;
    level += change;
    maxConcurrency = Math.max(maxConcurrency, level);
    if (concurrency.at(-1)?.t === t) concurrency[concurrency.length - 1].level = level;
    else concurrency.push({ t, level });
    previous = t;
  }
  const activeMs = points.at(-1).t;
  const toolSpans = spans.filter((span) => span.end > span.start);
  const longest = (items) => items.reduce((best, span) => !best || span.end - span.start > best.end - best.start ? span : best, null);
  const pick = (span) => span ? { label: span.label, tool: span.tool, ms: span.end - span.start, estimated: span.estimated } : null;
  return {
    activeMs, wallMs: points.at(-1).wall - firstWall,
    lanes, spans: all.slice(0, MAX_SPANS), clipped: all.length > MAX_SPANS, markers: markers.slice(0, 500),
    concurrency: concurrency.slice(0, 4000),
    summary: {
      maxConcurrency, parallelMs, parallelShare: activeMs > 0 && parallelMs != null ? parallelMs / activeMs : null,
      modelMs: covered(modelSpans.map((span) => [span.start, span.end])),
      toolMs: covered(toolSpans.map((span) => [span.start, span.end])),
      measuredCalls: spans.filter((span) => !span.estimated).length, estimatedCalls: spans.filter((span) => span.estimated).length,
      longestCall: pick(longest(toolSpans)), longestModel: pick(longest(modelSpans)),
    },
  };
}

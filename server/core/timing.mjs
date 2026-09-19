// Session time is measured from the real event timestamps, never from the
// distance between the first and the last line of a conversation: a session
// resumed the next day, or a provider that writes its shutdown record when the
// terminal is finally closed, would otherwise report days of execution.
//
// Events are normalised to ISO-8601, ordered and deduplicated first. What is
// then counted is the time between consecutive events of the same interaction:
// the agent is working while it keeps reporting. What is not counted is the
// time before a user action - the user reading, typing or leaving - and any
// silence longer than MAX_WORK_GAP_MS, which no longer proves work.
// A measurement that cannot be derived stays null.

export const MAX_WORK_GAP_MS = 20 * 60 * 1000;

// The dashboard's own detection marker is not provider activity.
const IGNORED_TYPES = new Set(['agent.observed']);

// Subagent prompts and transcript copies also arrive as inputs. Providers that
// can tell them apart mark them at the adapter boundary; anything unmarked is
// treated as a real user action.
export const isUserAction = (event) => event?.type === 'agent.input' && event?.data?.userAction !== false;

const epochToMs = (value) => value < 1e11 ? value * 1000
  : value < 1e14 ? value
    : value < 1e17 ? value / 1000
      : value / 1e6;

export const toIsoTimestamp = (value, fallback = null) => {
  if (value == null || value === '') return fallback;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : fallback;
  const numeric = typeof value === 'number' ? value
    : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value.trim())
      : null;
  const milliseconds = numeric == null ? Date.parse(value) : Math.round(epochToMs(numeric));
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : fallback;
};

export const mergeIntervals = (intervals) => {
  const ordered = intervals
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end >= start)
    .sort((left, right) => left[0] - right[0]);
  const merged = [];
  for (const [start, end] of ordered) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
};

export const mergedDurationMs = (intervals) => {
  const merged = mergeIntervals(intervals);
  return merged.length ? merged.reduce((total, [start, end]) => total + (end - start), 0) : null;
};

const dedupeKey = (event) => {
  const { observationKey, source, ...data } = event.data || {};
  return `${event.timestamp}|${event.type}|${JSON.stringify(data)}`;
};

// Sources are re-read from their logs on every sync, so the same line can be
// observed twice. Identical events at the identical instant are one event.
export function normalizeEvents(events = []) {
  const ordered = events.map((event, index) => {
    const timestamp = toIsoTimestamp(event.timestamp, null);
    return { ...event, timestamp, index, at: timestamp ? Date.parse(timestamp) : null };
  });
  // An unreadable instant keeps its place in the stream and stays unknown; it
  // never borrows the time of its neighbours.
  let previousAt = Number.NEGATIVE_INFINITY;
  for (const event of ordered) {
    if (event.at == null) event.sortAt = previousAt;
    else { event.sortAt = event.at; previousAt = event.at; }
  }
  const seen = new Set();
  return ordered
    .sort((left, right) => (left.sortAt - right.sortAt) || (left.index - right.index))
    .filter((event) => {
      if (!event.timestamp) return true;
      const key = dedupeKey(event);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ index, at, sortAt, ...event }) => event);
}

// A turn is one interaction: it opens with a user action and runs until the
// next one. Inside it, the gap between two consecutive events is execution
// time; a gap nobody reported anything in for longer than MAX_WORK_GAP_MS is
// not.
export function sessionTurns(events = []) {
  const points = events
    .filter((event) => !IGNORED_TYPES.has(event.type))
    .map((event) => ({ at: Date.parse(event.timestamp || ''), user: isUserAction(event) }))
    .filter((point) => Number.isFinite(point.at));
  const turns = [];
  for (const point of points) {
    const current = turns.at(-1);
    // Providers announce the task before they log the prompt, and a user can
    // send two messages in a row: while the turn has no answer yet, it is
    // measured from the last user action rather than split into fragments.
    if (current && point.user && (!current.hasUser || !current.answered)) {
      current.startedAt = point.at;
      current.lastAt = point.at;
      current.activeMs = 0;
      current.steps += 1;
      current.hasUser = true;
      continue;
    }
    if (!current || point.user) {
      turns.push({ startedAt: point.at, lastAt: point.at, steps: 1, activeMs: 0, hasUser: point.user, answered: false });
      continue;
    }
    const gap = point.at - current.lastAt;
    if (gap <= MAX_WORK_GAP_MS) current.activeMs += gap;
    current.lastAt = point.at;
    current.steps += 1;
    current.answered = true;
  }
  return turns.map((turn) => ({
    startedAt: new Date(turn.startedAt).toISOString(),
    endedAt: new Date(turn.lastAt).toISOString(),
    steps: turn.steps,
    // A turn whose events share a single instant has an unknown length, not a
    // length of zero.
    durationMs: turn.activeMs > 0 ? turn.activeMs : null,
  }));
}

export function timingFromEvents(events = []) {
  const normalized = normalizeEvents(events);
  const turns = sessionTurns(normalized);
  const measured = turns.map((turn) => turn.durationMs).filter(Number.isFinite);
  const times = normalized.map((event) => Date.parse(event.timestamp || '')).filter(Number.isFinite);
  return {
    turns,
    turnCount: turns.length,
    firstEventAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    lastEventAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
    activeMs: measured.length ? measured.reduce((total, value) => total + value, 0) : null,
    lastTurnMs: turns.length ? turns.at(-1).durationMs : null,
    totalMs: times.length > 1 ? Math.max(...times) - Math.min(...times) : null,
  };
}

// Elapsed time of the whole conversation, idle time included. Reported next to
// the active time, never instead of it.
export const totalSpanMs = (run) => {
  const startedAt = Date.parse(toIsoTimestamp(run?.startedAt, '') || '');
  const lastAt = Date.parse(toIsoTimestamp(run?.endedAt || run?.updatedAt, '') || '');
  return Number.isFinite(startedAt) && Number.isFinite(lastAt) && lastAt > startedAt ? lastAt - startedAt : null;
};

export const runDurationMs = (run) => {
  if (Number.isFinite(run?.activeDurationMs)) return run.activeDurationMs;
  // A session with no measured activity reports nothing rather than passing
  // its conversation span off as execution time.
  if (run?.origin === 'external') return null;
  const startedAt = Date.parse(toIsoTimestamp(run?.startedAt, '') || '');
  const endedAt = Date.parse(toIsoTimestamp(run?.endedAt, '') || '');
  if (Number.isFinite(startedAt) && Number.isFinite(endedAt)) return Math.max(0, endedAt - startedAt);
  return null;
};

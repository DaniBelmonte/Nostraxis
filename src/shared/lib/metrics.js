// Pure formatting and metric helpers shared across scenes.
export const compact = (value) => Number.isFinite(value)
  ? (Math.abs(value) >= 1e6 ? `${Number((value / 1e6).toFixed(2))}M` : Math.abs(value) >= 1e3 ? `${Number((value / 1e3).toFixed(1))}k` : String(value))
  : '—';

export const money = (value) => Number.isFinite(value)
  ? `$${value.toFixed(value < 1 ? 3 : 2)}`
  : 'Not reported';

export const credits = (value) => Number.isFinite(value)
  ? value.toFixed(1)
  : '—';

export const percent = (value) => Number.isFinite(value)
  ? `${Math.round(value * 100)}%`
  : 'Not reported';

export const duration = (value) => {
  if (!Number.isFinite(value)) return '—';
  // A measured interval shorter than a second is not zero time.
  if (value > 0 && value < 1000) return '<1s';
  const seconds = Math.round(value / 1000);
  return seconds >= 3600
    ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
    : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

export const formatDate = (value) => value
  ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '—';

export const statusTone = (status) => status === 'running' || status === 'queued'
  ? 'live'
  : status === 'completed' ? 'done' : 'warning';

export const statusLabel = (status) => ({
  running: 'Live', queued: 'Queued', completed: 'Completed', failed: 'Failed',
  cancelled: 'Cancelled', stopped: 'Stopped', unknown: 'Unconfirmed', idle: 'Idle', draft: 'Draft',
}[status] || status);

// Mirrors server/core/timing.mjs: the active time is what was measured from
// the events, the conversation span is shown beside it and never in its place.
const parseAt = (value) => {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
};

export const runDurationMs = (run) => {
  if (Number.isFinite(run?.activeDurationMs)) return run.activeDurationMs;
  if (run?.origin === 'external') return null;
  const startedAt = parseAt(run?.startedAt);
  const endedAt = parseAt(run?.endedAt);
  return startedAt != null && endedAt != null ? Math.max(0, endedAt - startedAt) : null;
};

export const totalSpanMs = (run) => {
  const startedAt = parseAt(run?.startedAt);
  const lastAt = parseAt(run?.endedAt || run?.updatedAt);
  return startedAt != null && lastAt != null && lastAt > startedAt ? lastAt - startedAt : null;
};

export const metricsOf = (run) => {
  const input = Number.isFinite(run?.usage?.input) ? run.usage.input : null;
  const output = Number.isFinite(run?.usage?.output) ? run.usage.output : null;
  const cached = Number.isFinite(run?.usage?.cached) ? run.usage.cached : null;
  const explicitTotal = Number.isFinite(run?.usage?.total) ? run.usage.total : null;
  const observedTokens = Number.isFinite(run?.usage?.observedTokens) ? run.usage.observedTokens : null;
  return {
    input,
    output,
    cached,
    total: input != null && output != null ? input + output : explicitTotal,
    observedTokens,
    observedTokenScope: run?.usage?.observedTokenScope || null,
    cacheHit: input > 0 && cached != null ? cached / input : null,
    cost: Number.isFinite(run?.usage?.cost) ? run.usage.cost : null,
    credits: Number.isFinite(run?.usage?.credits) ? run.usage.credits : null,
    creditUnit: run?.usage?.creditUnit || null,
    creditCoverage: run?.usage?.creditCoverage || null,
    usageSource: run?.usage?.source || null,
    contextTokens: Number.isFinite(run?.usage?.contextTokens) ? run.usage.contextTokens : null,
    contextWindowTokens: Number.isFinite(run?.usage?.contextWindowTokens) ? run.usage.contextWindowTokens : null,
    durationMs: runDurationMs(run),
    totalDurationMs: totalSpanMs(run),
    lastTurnDurationMs: Number.isFinite(run?.lastTurnDurationMs) ? run.lastTurnDurationMs : null,
  };
};

export const buildUsageChartPoints = (detail) => {
  const preferredCreditUnit = detail?.run?.usage?.creditUnit || null;
  let input = null;
  let output = null;
  let explicitTotal = null;
  let observedTokens = null;
  let contextTokens = null;
  let cost = null;
  let providerCredits = null;
  const points = [];

  for (const [index, event] of (detail?.events || []).entries()) {
    const usage = event.data?.usage || {};
    const at = Date.parse(event.timestamp);
    if (!Number.isFinite(at)) continue;

    const previous = { input, output, contextTokens, cost, providerCredits };
    let changed = false;
    const update = (current, next, assign) => {
      if (!Number.isFinite(next) || next === current) return current;
      changed = true;
      assign(next);
      return next;
    };

    if (Number.isFinite(usage.input)) input = update(input, usage.input, (value) => { input = value; });
    else if (Number.isFinite(event.data?.tokensDelta)) {
      input = (input ?? 0) + event.data.tokensDelta;
      changed = true;
    }
    if (Number.isFinite(usage.output)) output = update(output, usage.output, (value) => { output = value; });
    if (Number.isFinite(usage.total)) explicitTotal = update(explicitTotal, usage.total, (value) => { explicitTotal = value; });
    if (Number.isFinite(usage.observedTokens)) observedTokens = update(observedTokens, usage.observedTokens, (value) => { observedTokens = value; });
    if (Number.isFinite(usage.contextTokens)) contextTokens = update(contextTokens, usage.contextTokens, (value) => { contextTokens = value; });
    if (Number.isFinite(usage.cost)) cost = update(cost, usage.cost, (value) => { cost = value; });
    else if (Number.isFinite(event.data?.costDelta)) {
      cost = (cost ?? 0) + event.data.costDelta;
      changed = true;
    }
    const isPreferredCreditUnit = !preferredCreditUnit || usage.creditUnit === preferredCreditUnit;
    if (isPreferredCreditUnit && Number.isFinite(usage.credits)) {
      providerCredits = update(providerCredits, usage.credits, (value) => { providerCredits = value; });
    }

    if (!changed) continue;
    const total = input != null && output != null ? input + output : explicitTotal;
    const point = {
      id: event.id || index,
      at,
      input,
      output,
      total,
      observedTokens,
      contextTokens,
      cost,
      credits: providerCredits,
      displayedTokens: total ?? observedTokens,
      inputDelta: input != null && previous.input != null && input > previous.input ? input - previous.input : null,
      outputDelta: output != null && previous.output != null && output > previous.output ? output - previous.output : null,
      contextTokensDelta: contextTokens != null && previous.contextTokens != null && contextTokens !== previous.contextTokens ? contextTokens - previous.contextTokens : null,
      costDelta: cost != null && previous.cost != null && cost > previous.cost ? cost - previous.cost : null,
      creditsDelta: providerCredits != null && previous.providerCredits != null && providerCredits > previous.providerCredits
        ? providerCredits - previous.providerCredits
        : null,
    };
    const last = points.at(-1);
    if (last?.at === at) {
      points[points.length - 1] = {
        ...last,
        ...point,
        inputDelta: point.inputDelta ?? last.inputDelta,
        outputDelta: point.outputDelta ?? last.outputDelta,
        contextTokensDelta: point.contextTokensDelta ?? last.contextTokensDelta,
        costDelta: point.costDelta ?? last.costDelta,
        creditsDelta: point.creditsDelta ?? last.creditsDelta,
      };
    } else {
      points.push(point);
    }
  }

  return points;
};

export const paddedChartDomain = (values) => {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [0, 1];
  const minimum = Math.min(...finite);
  const maximum = Math.max(...finite);
  const padding = minimum === maximum
    ? Math.max(Math.abs(maximum) * 0.12, 1)
    : Math.max((maximum - minimum) * 0.1, Number.EPSILON);
  return [Math.max(0, minimum - padding), maximum + padding];
};

// Deviation analysis of compared runs against the group median. It only does
// arithmetic on what the runs reported: a metric missing from a run gives
// that run no deviation, never a zero.
const finite = Number.isFinite;

export const median = (values) => {
  const known = values.filter(finite).sort((a, b) => a - b);
  if (!known.length) return null;
  const middle = Math.floor(known.length / 2);
  return known.length % 2 ? known[middle] : (known[middle - 1] + known[middle]) / 2;
};

const tokensOf = (row) => row.metrics.totalTokens ?? row.metrics.observedTokens;
const counted = (row, value) => row.activity.events ? value : null;

// Metrics measured against the median. `unit` groups runs that can be
// compared: provider credits only meet runs reporting the same credit unit.
export const DEVIATION_METRICS = [
  { id: 'tokens', label: 'Total tokens', group: 'Usage', format: 'tokens', get: tokensOf, headline: true },
  { id: 'credits', label: 'Provider credits', group: 'Usage', format: 'credits', get: (row) => row.metrics.providerCredits, unit: (row) => row.metrics.creditUnit, headline: true },
  { id: 'cost', label: 'Estimated cost', group: 'Usage', format: 'usd', get: (row) => row.metrics.costUsd, headline: true },
  { id: 'duration', label: 'Active time', group: 'Time', format: 'ms', get: (row) => row.metrics.durationMs, headline: true },
  { id: 'requests', label: 'Model requests', group: 'Calls', format: 'count', get: (row) => row.usageDetail.requests, headline: true },
  { id: 'toolCalls', label: 'Tool calls', group: 'Calls', format: 'count', get: (row) => counted(row, row.activity.toolCalls), headline: true },
  { id: 'inputPerRequest', label: 'Input per request', group: 'Calls', format: 'tokens', get: (row) => row.usageDetail.inputPerRequest },
  { id: 'outputPerRequest', label: 'Output per request', group: 'Calls', format: 'tokens', get: (row) => row.usageDetail.outputPerRequest },
  { id: 'creditsPerRequest', label: 'Credits per request', group: 'Calls', format: 'credits', get: (row) => row.usageDetail.creditsPerRequest, unit: (row) => row.metrics.creditUnit },
  { id: 'input', label: 'Input tokens', group: 'Usage', format: 'tokens', get: (row) => row.metrics.inputTokens },
  { id: 'uncachedInput', label: 'Uncached input', group: 'Cache', format: 'tokens', get: (row) => row.usageDetail.composition?.uncachedInput ?? null },
  { id: 'cacheRead', label: 'Cache reads', group: 'Cache', format: 'tokens', get: (row) => row.metrics.cachedTokens },
  { id: 'cacheWrite', label: 'Cache writes', group: 'Cache', format: 'tokens', get: (row) => row.usageDetail.cacheWrite },
  { id: 'cacheHit', label: 'Cache hit', group: 'Cache', format: 'ratio', get: (row) => row.metrics.cacheHit },
  { id: 'output', label: 'Output tokens', group: 'Usage', format: 'tokens', get: (row) => row.metrics.outputTokens },
  { id: 'reasoning', label: 'Reasoning tokens', group: 'Usage', format: 'tokens', get: (row) => row.metrics.reasoningTokens },
  { id: 'subagentTokens', label: 'Subagent tokens', group: 'Agents', format: 'tokens', get: (row) => row.usageDetail.subagentTokens },
  { id: 'contextPeak', label: 'Peak context', group: 'Context', format: 'tokens', get: (row) => row.context.peakTokens },
  { id: 'compactions', label: 'Compactions', group: 'Context', format: 'count', get: (row) => counted(row, row.context.compactions.length) },
  { id: 'turns', label: 'Turns', group: 'Time', format: 'count', get: (row) => row.activity.turns },
  { id: 'avgTurn', label: 'Average turn', group: 'Time', format: 'ms', get: (row) => row.efficiency.averageTurnMs },
  { id: 'filesRead', label: 'Files read', group: 'Files', format: 'count', get: (row) => counted(row, row.activity.filesRead) },
  { id: 'repeatedReads', label: 'Repeated reads', group: 'Files', format: 'count', get: (row) => counted(row, row.activity.repeatedReads) },
  { id: 'filesModified', label: 'Files modified', group: 'Files', format: 'count', get: (row) => counted(row, row.activity.filesModified) },
  { id: 'commands', label: 'Shell commands', group: 'Calls', format: 'count', get: (row) => counted(row, row.activity.commandCalls) },
  { id: 'subagentCalls', label: 'Subagent calls', group: 'Agents', format: 'count', get: (row) => counted(row, row.activity.subagentCalls) },
  { id: 'thinking', label: 'Reasoning steps', group: 'Calls', format: 'count', get: (row) => counted(row, row.activity.thinkingSteps) },
  { id: 'errors', label: 'Errors', group: 'Retries', format: 'count', get: (row) => counted(row, row.activity.errors) },
  { id: 'failedCommands', label: 'Failed commands', group: 'Retries', format: 'count', get: (row) => row.usageDetail.failedCommands },
  { id: 'failedTools', label: 'Failed tools', group: 'Retries', format: 'count', get: (row) => row.usageDetail.failedTools },
  { id: 'apiErrors', label: 'API errors', group: 'Retries', format: 'count', get: (row) => row.usageDetail.apiErrors },
];

// The deviation of a value from its median. Against a zero median only "no
// change" can be stated; any other value is unbounded and reported as such.
const deviationOf = (value, reference) => {
  if (!finite(value) || !finite(reference)) return null;
  if (reference === 0) return value === 0 ? 0 : null;
  return (value - reference) / Math.abs(reference);
};

export function deviationTable(rows) {
  return DEVIATION_METRICS.map((metric) => {
    const units = new Map();
    for (const row of rows) {
      const value = metric.get(row);
      if (!finite(value)) continue;
      const unit = metric.unit ? metric.unit(row) || 'provider-defined' : null;
      units.set(unit, [...(units.get(unit) || []), value]);
    }
    const medians = new Map([...units].map(([unit, values]) => [unit, values.length > 1 ? median(values) : null]));
    const values = rows.map((row) => {
      const value = metric.get(row);
      const unit = metric.unit ? metric.unit(row) || 'provider-defined' : null;
      const reference = finite(value) ? medians.get(unit) ?? null : null;
      return { key: row.key, value: finite(value) ? value : null, unit, median: reference, deviation: deviationOf(value, reference), unbounded: finite(value) && reference === 0 && value !== 0 };
    });
    const spread = values.map((item) => item.unbounded ? Infinity : Math.abs(item.deviation ?? 0));
    return {
      id: metric.id, label: metric.label, group: metric.group, format: metric.format, headline: Boolean(metric.headline),
      compared: values.filter((item) => item.median != null).length,
      maxDeviation: Math.max(0, ...spread), values,
    };
  }).filter((metric) => metric.compared > 1);
}

export function deviationAnalysis(rows) {
  const table = deviationTable(rows);
  // The run that departs most from the group, by its largest headline deviation.
  const score = (row) => Math.max(0, ...table.filter((metric) => metric.headline).map((metric) => {
    const cell = metric.values.find((value) => value.key === row.key);
    return cell?.unbounded ? 10 : Math.abs(cell?.deviation ?? 0);
  }));
  const outlier = rows.length ? [...rows].sort((a, b) => score(b) - score(a))[0].key : null;
  return { reference: { kind: 'median', runs: rows.length, note: rows.length === 2 ? 'With two runs the median is their mean.' : null }, metrics: table, outlier };
}

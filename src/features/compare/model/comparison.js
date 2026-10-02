import { compact, credits, duration, money, percent } from '../../../shared/lib/metrics';

// One fixed hue per comparison slot, in selection order; adjacent slots are
// validated for colour vision deficiency on the dark comparison surface. A
// run keeps its colour when another one is removed because the colour follows
// the slot. Five hues cannot all stay apart under every deficiency, so runs
// are always labelled by name beside their colour.
export const RUN_COLORS = ['#2e95e6', '#c28427', '#9a6fe0', '#2fa877', '#cc66aa'];
export const MAX_COMPARED_RUNS = RUN_COLORS.length;

// Models get their own categorical ramp so a model is never read as a run.
export const MODEL_COLORS = ['#199e70', '#d95926', '#9085e9', '#c98500', '#d55181', '#3987e5', '#e66767'];
export const OTHER_MODEL_COLOR = '#6b7f8e';

// Diverging scale for deviations: below the median cool, above warm, a grey
// midpoint for "as the median".
export const DEVIATION_BELOW = '#3987e5';
export const DEVIATION_ABOVE = '#e66767';

const finite = Number.isFinite;
const count = (value) => finite(value) ? value.toLocaleString('en-US') : '—';
const decimal = (value) => finite(value) ? (Number.isInteger(value) || value >= 100 ? Math.round(value).toLocaleString('en-US') : value.toFixed(value >= 10 ? 1 : 2)) : '—';
const score = (value) => finite(value) ? value.toFixed(2) : '—';
const ratio = (value) => finite(value) ? `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%` : '—';
const tokensOf = (row) => row.metrics.totalTokens ?? row.metrics.observedTokens;

export const formatValue = (format, value, unit) => {
  if (!finite(value)) return '—';
  if (format === 'tokens') return compact(Math.round(value));
  if (format === 'credits') return `${value >= 100 ? Math.round(value).toLocaleString('en-US') : value.toFixed(value < 10 ? 2 : 1)}${unit ? ` ${unit}` : ''}`;
  if (format === 'usd') return money(value);
  if (format === 'ms') return duration(value);
  if (format === 'ratio') return ratio(value);
  return decimal(value);
};

export const median = (values) => {
  const known = values.filter(finite).sort((a, b) => a - b);
  if (!known.length) return null;
  const middle = Math.floor(known.length / 2);
  return known.length % 2 ? known[middle] : (known[middle - 1] + known[middle]) / 2;
};

// `better` says which direction is an improvement; null rows are shown
// without a verdict because more or less is not better by itself.
export const METRIC_GROUPS = [
  { id: 'usage', label: 'Usage', rows: [
    { id: 'tokens', label: 'Total tokens', get: tokensOf, format: compact, better: 'lower', hint: 'Input plus output reported by the provider' },
    { id: 'input', label: 'Input tokens', get: (row) => row.metrics.inputTokens, format: compact, better: 'lower' },
    { id: 'output', label: 'Output tokens', get: (row) => row.metrics.outputTokens, format: compact, better: null },
    { id: 'cached', label: 'Cached input', get: (row) => row.metrics.cachedTokens, format: compact, better: 'higher' },
    { id: 'cacheHit', label: 'Cache hit', get: (row) => row.metrics.cacheHit, format: percent, better: 'higher' },
    { id: 'reasoning', label: 'Reasoning tokens', get: (row) => row.metrics.reasoningTokens, format: compact, better: null },
  ] },
  { id: 'cost', label: 'Cost', rows: [
    { id: 'cost', label: 'Estimated cost', get: (row) => row.metrics.costUsd, format: money, better: 'lower', hint: 'Provider cost, or your Settings prices' },
    { id: 'credits', label: 'Provider credits', get: (row) => row.metrics.providerCredits, format: (value, row) => finite(value) ? `${credits(value)} ${row.metrics.creditUnit || ''}` : '—', better: 'lower', unit: (row) => row.metrics.creditUnit },
    { id: 'costPerTurn', label: 'Cost per turn', get: (row) => row.efficiency.costPerTurn, format: money, better: 'lower' },
  ] },
  { id: 'time', label: 'Time', rows: [
    { id: 'duration', label: 'Active time', get: (row) => row.metrics.durationMs, format: duration, better: 'lower' },
    { id: 'span', label: 'Conversation span', get: (row) => row.metrics.totalDurationMs, format: duration, better: null },
    { id: 'turns', label: 'Turns', get: (row) => row.activity.turns, format: count, better: null },
    { id: 'avgTurn', label: 'Average turn', get: (row) => row.efficiency.averageTurnMs, format: duration, better: 'lower' },
    { id: 'lastTurn', label: 'Last turn', get: (row) => row.metrics.lastTurnDurationMs, format: duration, better: null },
  ] },
  { id: 'context', label: 'Context', rows: [
    { id: 'contextPeak', label: 'Peak context', get: (row) => row.context.peakTokens, format: compact, better: 'lower' },
    { id: 'contextWindow', label: 'Context window', get: (row) => row.context.windowTokens, format: compact, better: null },
    { id: 'contextUse', label: 'Peak window use', get: (row) => row.context.peakUtilization, format: ratio, better: 'lower' },
    { id: 'compactions', observed: true, label: 'Compactions', get: (row) => row.context.compactions.length, format: count, better: 'lower' },
    { id: 'memory', observed: true, label: 'Memory files', get: (row) => row.memory.length, format: count, better: null },
  ] },
  { id: 'activity', label: 'Activity', rows: [
    { id: 'toolCalls', observed: true, label: 'Tool calls', get: (row) => row.activity.toolCalls, format: count, better: 'lower' },
    { id: 'uniqueTools', observed: true, label: 'Distinct tools', get: (row) => row.activity.uniqueTools, format: count, better: null },
    { id: 'commands', observed: true, label: 'Shell commands', get: (row) => row.activity.commandCalls, format: count, better: null },
    { id: 'subagents', observed: true, label: 'Subagent calls', get: (row) => row.activity.subagentCalls, format: count, better: null },
    { id: 'filesRead', observed: true, label: 'Files read', get: (row) => row.activity.filesRead, format: count, better: null },
    { id: 'filesModified', observed: true, label: 'Files modified', get: (row) => row.activity.filesModified, format: count, better: null },
    { id: 'repeatedReads', observed: true, label: 'Repeated reads', get: (row) => row.activity.repeatedReads, format: count, better: 'lower', hint: 'Reads of a file the run had already read' },
    { id: 'thinking', observed: true, label: 'Reasoning steps', get: (row) => row.activity.thinkingSteps, format: count, better: null },
    { id: 'errors', observed: true, label: 'Errors', get: (row) => row.activity.errors, format: count, better: 'lower' },
    { id: 'failedCommands', observed: true, label: 'Failed commands', get: (row) => row.activity.failedCommands, format: count, better: 'lower' },
    { id: 'warnings', observed: true, label: 'Sensitive warnings', get: (row) => row.activity.warnings, format: count, better: 'lower' },
  ] },
  { id: 'efficiency', label: 'Efficiency', rows: [
    { id: 'tokensPerTurn', label: 'Tokens per turn', get: (row) => row.efficiency.tokensPerTurn, format: compact, better: 'lower' },
    { id: 'tokensPerTool', label: 'Tokens per tool call', get: (row) => row.efficiency.tokensPerToolCall, format: compact, better: 'lower' },
    { id: 'toolsPerTurn', label: 'Tool calls per turn', get: (row) => row.efficiency.toolCallsPerTurn, format: decimal, better: null },
    { id: 'outputShare', label: 'Output share', get: (row) => row.efficiency.outputShare, format: ratio, better: null },
    { id: 'readsPerWrite', label: 'Reads per edit', get: (row) => row.efficiency.readsPerWrite, format: decimal, better: null },
    { id: 'evaluation', label: 'Evaluation score', get: (row) => row.metrics.evaluationScore, format: score, better: 'higher' },
  ] },
];

// Counts taken from the event stream are unknown, not zero, for a run that
// recorded no events.
export const metricValue = (definition, row) => definition.observed && !row.activity.events ? null : definition.get(row);
const valueOf = metricValue;

// The reference of a metric is the median of the runs that report it in the
// same unit; with fewer than two such runs there is nothing to deviate from.
export function metricReference(definition, rows, unit = null) {
  const values = rows.filter((item) => !definition.unit || definition.unit(item) === unit).map((item) => valueOf(definition, item)).filter(finite);
  return values.length > 1 ? median(values) : null;
}

// A difference is only computed between values in the same unit; provider
// credits of different units are never compared.
export function metricCell(definition, row, rows) {
  const value = valueOf(definition, row);
  const base = metricReference(definition, rows, definition.unit ? definition.unit(row) : null);
  const delta = finite(value) && finite(base) && base !== 0 ? (value - base) / Math.abs(base) : null;
  const comparable = rows.filter((item) => finite(valueOf(definition, item)) && (!definition.unit || definition.unit(item) === definition.unit(row)));
  const values = comparable.map((item) => valueOf(definition, item));
  const best = definition.better && values.length > 1 && new Set(values).size > 1 && finite(value)
    && value === (definition.better === 'lower' ? Math.min(...values) : Math.max(...values));
  const tone = delta == null || !definition.better || Math.abs(delta) < 0.005 ? 'neutral'
    : (delta < 0) === (definition.better === 'lower') ? 'better' : 'worse';
  return { value, text: definition.format(value, row), delta, tone, best };
}

export const formatDelta = (delta) => finite(delta)
  ? `${delta > 0 ? '▲' : delta < 0 ? '▼' : '='} ${delta >= 10 ? `${Math.round(1 + delta)}×` : `${Math.abs(delta * 100).toFixed(Math.abs(delta) < 0.1 ? 1 : 0)}%`}`
  : '';

export const runLabel = (row) => row.run.displayName || row.run.name || row.run.id;

// Runs of one benchmark often share a long name prefix; charts show the part
// that tells them apart, and the full name stays in titles and tables.
export function withDisplayNames(rows) {
  const names = rows.map((row) => row.run.name || row.run.id || '');
  if (names.length < 2) return rows;
  let prefix = names[0];
  for (const name of names) while (prefix && !name.startsWith(prefix)) prefix = prefix.slice(0, -1);
  const cut = Math.max(prefix.lastIndexOf('-'), prefix.lastIndexOf(' '), prefix.lastIndexOf('_')) + 1;
  const trimmed = names.map((name) => name.slice(cut).trim());
  const usable = cut >= 6 && trimmed.every(Boolean) && new Set(trimmed).size === names.length;
  return usable ? rows.map((row, index) => ({ ...row, run: { ...row.run, displayName: trimmed[index] } })) : rows;
}

export function relativeFilePath(filePath, repositoryPath = '') {
  const normalized = String(filePath || '').replaceAll('\\', '/');
  const root = String(repositoryPath || '').replaceAll('\\', '/').replace(/\/$/, '');
  return root && normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized.replace(/^\.\//, '');
}

// Differences that make a comparison less like-for-like, stated plainly
// instead of hidden behind a single score.
export function comparabilityNotes(rows) {
  if (rows.length < 2) return [];
  const notes = [];
  const distinct = (get) => new Set(rows.map(get).map((value) => value ?? '—'));
  if (distinct((row) => `${row.run.provider}/${row.run.model || 'auto'}`).size > 1) notes.push('Runs use different agents or models.');
  const efforts = rows.map((row) => row.conditions.effort?.join(' → ') || row.conditions.declaredEffort || null);
  if (efforts.some((value) => !value)) notes.push('Reasoning effort is not reported for some runs.');
  if (new Set(rows.map((row) => row.metrics.creditUnit).filter(Boolean)).size > 1) notes.push('Runs report credits in different units; credits are compared only within the same unit.');
  else if (new Set(efforts).size > 1) notes.push('Runs used different reasoning effort.');
  if (distinct((row) => row.prompt?.trim().slice(0, 500)).size > 1) notes.push('The first prompts differ.');
  if (distinct((row) => row.run.repositoryName).size > 1) notes.push('Runs belong to different repositories.');
  if (distinct((row) => row.context.windowTokens).size > 1) notes.push('Context windows differ or are not reported for every run.');
  if (rows.some((row) => row.conditions.usageScope === 'observed')) notes.push('Some usage is partial: only what the log exposed was measured.');
  if (rows.some((row) => row.source === 'imported')) notes.push('Imported runs are priced with your Settings unless their provider reported the cost.');
  return notes;
}

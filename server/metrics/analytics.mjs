import { runDurationMs, totalSpanMs } from '../core/timing.mjs';

export const metricDefinitions = [
  { id: 'tokens', label: 'Total tokens', unit: 'tokens', source: 'provider' },
  { id: 'cachedTokens', label: 'Cached input', unit: 'tokens', source: 'provider' },
  { id: 'cacheHit', label: 'Cache hit', unit: 'ratio', source: 'derived' },
  { id: 'cost', label: 'Estimated cost', unit: 'USD', source: 'provider-or-configured-estimate' },
  { id: 'providerCredits', label: 'Provider credits', unit: 'provider-defined', source: 'provider' },
  { id: 'duration', label: 'Active duration', unit: 'ms', source: 'event-timestamps' },
  { id: 'totalSpan', label: 'Conversation span', unit: 'ms', source: 'event-timestamps' },
  { id: 'evaluation', label: 'Evaluation score', unit: 'ratio', source: 'evaluator' },
];

const sumNullable = (values) => {
  const known = values.filter(Number.isFinite);
  return known.length ? known.reduce((total, value) => total + value, 0) : null;
};

export function metricsOf(run) {
  const input = Number.isFinite(run.usage?.input) ? run.usage.input : null;
  const output = Number.isFinite(run.usage?.output) ? run.usage.output : null;
  const cached = Number.isFinite(run.usage?.cached) ? run.usage.cached : null;
  const explicitTotal = Number.isFinite(run.usage?.total) ? run.usage.total : null;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input != null && output != null ? input + output : explicitTotal,
    observedTokens: Number.isFinite(run.usage?.observedTokens) ? run.usage.observedTokens : null,
    observedTokenScope: run.usage?.observedTokenScope || null,
    cachedTokens: cached,
    cacheHit: input != null && input > 0 && cached != null ? cached / input : null,
    reasoningTokens: Number.isFinite(run.usage?.reasoning) ? run.usage.reasoning : null,
    costUsd: Number.isFinite(run.usage?.cost) ? run.usage.cost : null,
    costSource: run.usage?.costSource || null,
    providerCredits: Number.isFinite(run.usage?.credits) ? run.usage.credits : null,
    creditUnit: run.usage?.creditUnit || null,
    creditCoverage: run.usage?.creditCoverage || null,
    usageSource: run.usage?.source || null,
    contextTokens: Number.isFinite(run.usage?.contextTokens) ? run.usage.contextTokens : null,
    contextWindowTokens: Number.isFinite(run.usage?.contextWindowTokens) ? run.usage.contextWindowTokens : null,
    durationMs: runDurationMs(run),
    totalDurationMs: totalSpanMs(run),
    lastTurnDurationMs: Number.isFinite(run.lastTurnDurationMs) ? run.lastTurnDurationMs : null,
    evaluationScore: Number.isFinite(run.evaluation?.score) ? run.evaluation.score : null,
  };
}

export function matches(run, filters) {
  if (filters.repository && run.repositoryId !== filters.repository && run.repositoryName !== filters.repository) return false;
  if (filters.provider && run.provider !== filters.provider) return false;
  if (filters.model && run.model !== filters.model) return false;
  if (filters.from && run.startedAt < filters.from) return false;
  if (filters.to && run.startedAt > filters.to) return false;
  return true;
}

export function buildAnalytics(runs, filters = {}) {
  const selected = runs.filter((run) => matches(run, filters));
  const dimensions = {};
  for (const dimension of ['repositoryName', 'provider', 'model']) {
    const groups = new Map();
    for (const run of selected) {
      const key = run[dimension] || 'unreported';
      const group = groups.get(key) || [];
      group.push(run);
      groups.set(key, group);
    }
    dimensions[dimension] = [...groups.entries()].map(([key, groupRuns]) => summarizeGroup(key, groupRuns));
  }
  return {
    filters,
    runCount: selected.length,
    summary: summarizeGroup('all', selected),
    dimensions,
    timeseries: selected.map((run) => ({ runId: run.id, at: run.startedAt, provider: run.provider, model: run.model, repository: run.repositoryName, ...metricsOf(run) })).sort((a, b) => a.at.localeCompare(b.at)),
  };
}

function summarizeGroup(key, runs) {
  const metrics = runs.map(metricsOf);
  const totalTokens = sumNullable(metrics.map((item) => item.totalTokens));
  const totalCostUsd = sumNullable(metrics.map((item) => item.costUsd));
  const creditMetrics = metrics.filter((item) => Number.isFinite(item.providerCredits));
  const creditUnits = new Set(creditMetrics.map((item) => item.creditUnit || 'provider-defined'));
  const totalProviderCredits = creditUnits.size <= 1 ? sumNullable(creditMetrics.map((item) => item.providerCredits)) : null;
  const providerCreditUnit = creditUnits.size === 1 ? [...creditUnits][0] : null;
  const totalObservedTokens = sumNullable(metrics.map((item) => item.observedTokens));
  const knownDurations = metrics.map((item) => item.durationMs).filter(Number.isFinite);
  const knownScores = metrics.map((item) => item.evaluationScore).filter(Number.isFinite);
  const input = sumNullable(metrics.map((item) => item.inputTokens));
  const cached = sumNullable(metrics.map((item) => item.cachedTokens));
  return {
    key, runs: runs.length, totalTokens, totalObservedTokens, totalCostUsd, totalProviderCredits, providerCreditUnit,
    averageDurationMs: knownDurations.length ? knownDurations.reduce((a, b) => a + b, 0) / knownDurations.length : null,
    averageEvaluationScore: knownScores.length ? knownScores.reduce((a, b) => a + b, 0) / knownScores.length : null,
    cacheHit: input && cached != null ? cached / input : null,
  };
}

export function compareRuns(runs) {
  return runs.map((run) => ({
    run: { id: run.id, name: run.name, repositoryName: run.repositoryName, repositoryPath: run.repositoryPath, provider: run.provider, model: run.model, status: run.status, startedAt: run.startedAt },
    metrics: metricsOf(run),
    tools: run.tools || null,
    files: run.files || null,
    output: run.response,
    evaluation: run.evaluation,
    contextDigest: run.contextSnapshot?.digest || null,
    unavailable: metricDefinitions.filter((definition) => {
      const map = { tokens: 'totalTokens', cachedTokens: 'cachedTokens', cacheHit: 'cacheHit', cost: 'costUsd', providerCredits: 'providerCredits', duration: 'durationMs', totalSpan: 'totalDurationMs', evaluation: 'evaluationScore' };
      return metricsOf(run)[map[definition.id]] == null;
    }).map((definition) => definition.id),
  }));
}

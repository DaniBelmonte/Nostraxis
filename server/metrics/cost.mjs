function configuredPricing() {
  try { return JSON.parse(process.env.NOSTRAXIS_PRICING_JSON || '{}'); }
  catch { return {}; }
}

export function withEstimatedCost(usage, model) {
  if (!usage || Number.isFinite(usage.cost)) return usage ? { ...usage, costSource: usage.cost != null ? 'provider' : null } : null;
  const rates = configuredPricing()[model];
  if (!rates || !Number.isFinite(usage.input) || !Number.isFinite(usage.output)) return { ...usage, cost: null, costSource: null };
  const uncached = Math.max(0, usage.input - (usage.cached || 0));
  const value = (
    uncached * rates.inputPerMillion
    + (usage.cached || 0) * (rates.cachedInputPerMillion ?? rates.inputPerMillion)
    + usage.output * rates.outputPerMillion
  ) / 1_000_000;
  return { ...usage, cost: Number(value.toFixed(8)), costSource: 'configured-estimate' };
}

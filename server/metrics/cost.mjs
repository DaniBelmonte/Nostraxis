// Prices are applied when runs are read, never written into the stored usage,
// so a price changed in Settings re-prices every session. A cost the provider
// reported always wins over a configured price.
export const PRICING_SETTING = 'pricing';
const CONFIGURED = new Set(['configured-estimate', 'configured-credits']);
const RATE_FIELDS = ['inputPerMillion', 'cachedInputPerMillion', 'outputPerMillion'];
const COPILOT_BASES = new Set(['credits', 'tokens']);
const CREDIT_FIELDS = { 'AI credits': 'aiCreditUsd', 'premium requests': 'premiumRequestUsd' };

const rate = (value, label) => {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a non-negative number.`);
  return number;
};

// A credit is priced from the subscription that includes it: plan price
// divided by the credits the account receives for that price.
function plan(value, unit) {
  const usd = rate(value?.usd, `Plan price for ${unit}`);
  const credits = rate(value?.credits, `Included ${unit}`);
  if (usd == null && credits == null) return null;
  if (usd == null || credits == null) throw new Error(`Set both the plan price and the included ${unit}.`);
  if (credits === 0) throw new Error(`Included ${unit} must be greater than zero.`);
  return { usd, credits };
}

const unitPrice = (value) => value ? value.usd / value.credits : null;

export function normalizePricing(value = {}) {
  const models = {};
  for (const [key, rates] of Object.entries(value?.models || {})) {
    const model = String(key).trim();
    if (!model) continue;
    if (model.length > 200) throw new Error('Model ids must have at most 200 characters.');
    const entry = Object.fromEntries(RATE_FIELDS.map((field) => [field, rate(rates?.[field], `${model} ${field}`)]));
    if (entry.inputPerMillion == null && entry.outputPerMillion == null && entry.cachedInputPerMillion == null) continue;
    if (entry.inputPerMillion == null || entry.outputPerMillion == null) throw new Error(`${model} needs both input and output prices.`);
    models[model] = entry;
  }
  const aiCreditPlan = plan(value?.aiCreditPlan, 'AI credits');
  const premiumRequestPlan = plan(value?.premiumRequestPlan, 'premium requests');
  if (value?.copilotBasis != null && !COPILOT_BASES.has(value.copilotBasis)) throw new Error('Copilot cost basis must be credits or tokens.');
  return { copilotBasis: value?.copilotBasis || 'credits', aiCreditPlan, premiumRequestPlan, aiCreditUsd: unitPrice(aiCreditPlan), premiumRequestUsd: unitPrice(premiumRequestPlan), models };
}

function environmentModels() {
  try { return normalizePricing({ models: JSON.parse(process.env.NOSTRAXIS_PRICING_JSON || '{}') }).models; }
  catch { return {}; }
}

export const savedPricing = (store) => normalizePricing(store.setting(PRICING_SETTING, {}) || {});

// Settings override the environment table model by model.
export function pricingFrom(store) {
  const saved = savedPricing(store);
  return { ...saved, models: { ...environmentModels(), ...saved.models } };
}

export const environmentPricedModels = () => Object.keys(environmentModels());

const ratesFor = (models, model) => models[model]
  || Object.entries(models).find(([id]) => id.toLowerCase() === String(model || '').toLowerCase())?.[1]
  || null;

const creditRate = (usage, pricing) => Number.isFinite(usage?.credits) ? pricing[CREDIT_FIELDS[usage.creditUnit]] ?? null : null;

// Import boundary: only a provider-reported cost is kept in storage.
export function withReportedCost(usage) {
  if (!usage) return null;
  const reported = Number.isFinite(usage.cost) && !CONFIGURED.has(usage.costSource);
  return { ...usage, cost: reported ? usage.cost : null, costSource: reported ? usage.costSource || 'provider' : null };
}

// Copilot bills either through the subscription credits or, behind them, the
// tokens of the model it routes to. Settings picks one basis for every Copilot
// run and it is never mixed or used as a fallback for the other.
export function priceUsage(usage, model, pricing, basis = 'tokens') {
  if (!usage) return usage;
  if (Number.isFinite(usage.cost) && !CONFIGURED.has(usage.costSource)) return usage;
  const stale = CONFIGURED.has(usage.costSource) ? { ...usage, cost: null, costSource: null } : usage;
  if (basis === 'credits') {
    const value = creditRate(usage, pricing);
    return value == null ? stale : { ...usage, cost: Number((usage.credits * value).toFixed(8)), costSource: 'configured-credits' };
  }
  const rates = ratesFor(pricing.models, model);
  if (!rates || !Number.isFinite(usage.input) || !Number.isFinite(usage.output)) return stale;
  const cached = Math.min(usage.input, usage.cached || 0);
  const value = (
    (usage.input - cached) * rates.inputPerMillion
    + cached * (rates.cachedInputPerMillion ?? rates.inputPerMillion)
    + usage.output * rates.outputPerMillion
  ) / 1_000_000;
  return { ...usage, cost: Number(value.toFixed(8)), costSource: 'configured-estimate' };
}

export const pricingBasis = (run, pricing) => run?.provider === 'copilot' ? pricing.copilotBasis || 'credits' : 'tokens';

export const priceRun = (run, pricing) => run?.usage ? { ...run, usage: priceUsage(run.usage, run.model, pricing, pricingBasis(run, pricing)) } : run;

export function priceEvents(events, run, pricing) {
  const basis = pricingBasis(run, pricing);
  return events.map((event) => event.data?.usage
    ? { ...event, data: { ...event.data, usage: priceUsage(event.data.usage, run?.model, pricing, basis) } }
    : event);
}

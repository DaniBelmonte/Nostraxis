import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { normalizePricing, priceEvents, priceUsage, pricingFrom, withReportedCost } from '../server/metrics/cost.mjs';
import { openDatabase } from '../server/persistence/database.mjs';
import { EventBus } from '../server/core/event-bus.mjs';
import { createRepositoryService } from '../server/repositories/service.mjs';
import { createRunManager } from '../server/runtime/run-manager.mjs';
import { createApi } from '../server/api.mjs';

const pricing = normalizePricing({
  aiCreditPlan: { usd: 400, credits: 10_000 },
  models: { 'gpt-5': { inputPerMillion: 1.25, cachedInputPerMillion: 0.125, outputPerMillion: 10 } },
});

test('model prices estimate cost from uncached, cached and output tokens', () => {
  const usage = priceUsage({ input: 1_000_000, cached: 400_000, output: 100_000, cost: null, costSource: null }, 'GPT-5', pricing);
  assert.equal(usage.cost, 1.8);
  assert.equal(usage.costSource, 'configured-estimate');
});

test('a provider-reported cost is never replaced by a configured price', () => {
  const usage = { input: 1_000_000, output: 1_000_000, cost: 3.5, costSource: 'provider' };
  assert.equal(priceUsage(usage, 'gpt-5', pricing), usage);
});

test('Copilot credits are priced in their own unit and never mixed', () => {
  const credits = priceUsage({ input: 900, output: 100, credits: 12.5, creditUnit: 'AI credits', cost: null }, 'gpt-5', pricing);
  assert.equal(credits.cost, 0.5);
  assert.equal(credits.costSource, 'configured-credits');
  // No premium request price is configured, so the unit is not converted with
  // the AI credit price and the run falls back to its model prices.
  const premium = priceUsage({ input: 1_000_000, output: 0, credits: 3, creditUnit: 'premium requests', cost: null }, 'gpt-5', pricing);
  assert.equal(premium.costSource, 'configured-estimate');
  assert.equal(premium.cost, 1.25);
});

test('missing prices keep cost unreported instead of zero', () => {
  const usage = { input: 10, output: 5, cost: null, costSource: null };
  assert.equal(priceUsage(usage, 'unknown-model', pricing), usage);
  assert.deepEqual(priceUsage({ input: 10, output: 5, cost: 0.2, costSource: 'configured-estimate' }, 'unknown-model', pricing), { input: 10, output: 5, cost: null, costSource: null });
  assert.deepEqual(withReportedCost({ input: 10, output: 5, cost: 0.2, costSource: 'configured-estimate' }), { input: 10, output: 5, cost: null, costSource: null });
});

test('every measurement of a run is priced on the same basis', () => {
  const run = { model: 'gpt-5', usage: { input: 2_000_000, output: 0, credits: 2, creditUnit: 'AI credits' } };
  const events = priceEvents([
    { id: 1, data: { usage: { input: 1_000_000, output: 0 } } },
    { id: 2, data: { usage: { input: 2_000_000, output: 0, credits: 2, creditUnit: 'AI credits' } } },
    { id: 3, data: { text: 'no usage' } },
  ], run, pricing);
  assert.equal(events[0].data.usage.cost, undefined);
  assert.equal(events[1].data.usage.cost, 0.08);
  assert.deepEqual(events[2], { id: 3, data: { text: 'no usage' } });
});

test('the credit price is the plan price divided by the credits it includes', () => {
  const plans = normalizePricing({ aiCreditPlan: { usd: '300', credits: '30000' }, premiumRequestPlan: { usd: 39, credits: 1500 } });
  assert.deepEqual(plans.aiCreditPlan, { usd: 300, credits: 30_000 });
  assert.equal(plans.aiCreditUsd, 0.01);
  assert.equal(plans.premiumRequestUsd, 0.026);
  assert.equal(priceUsage({ credits: 250, creditUnit: 'AI credits', cost: null }, 'any', plans).cost, 2.5);
});

test('invalid prices are rejected and empty rows are dropped', () => {
  assert.throws(() => normalizePricing({ aiCreditPlan: { usd: -1, credits: 10 } }), /non-negative/);
  assert.throws(() => normalizePricing({ aiCreditPlan: { usd: 300 } }), /both the plan price/);
  assert.throws(() => normalizePricing({ premiumRequestPlan: { usd: 10, credits: 0 } }), /greater than zero/);
  assert.throws(() => normalizePricing({ models: { m: { inputPerMillion: 1 } } }), /both input and output/);
  assert.deepEqual(normalizePricing({ aiCreditPlan: { usd: '', credits: '' }, models: { m: { inputPerMillion: '', outputPerMillion: '' } } }), { aiCreditPlan: null, premiumRequestPlan: null, aiCreditUsd: null, premiumRequestUsd: null, models: {} });
});

test('saved prices re-price stored runs and their events when read', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nostraxis-pricing-'));
  const previous = process.env.NOSTRAXIS_PRICING_JSON;
  process.env.NOSTRAXIS_PRICING_JSON = JSON.stringify({ 'gpt-5': { inputPerMillion: 2, outputPerMillion: 20 }, 'env-only': { inputPerMillion: 1, outputPerMillion: 1 } });
  const store = openDatabase(path.join(dir, 'data'));
  try {
    const runs = createRunManager({ store, bus: new EventBus(), repositories: createRepositoryService(store) });
    store.saveRun({
      id: 'priced', name: 'priced', repositoryPath: dir, provider: 'codex', model: 'gpt-5', status: 'completed', prompt: 'Synthetic',
      startedAt: '2026-09-28T10:00:00.000Z', updatedAt: '2026-09-28T10:05:00.000Z',
      usage: { input: 1_000_000, output: 100_000, cached: 0, cost: null, costSource: null }, contextSnapshot: {}, permissions: {},
    });
    store.insertEvent({ runId: 'priced', timestamp: '2026-09-28T10:01:00.000Z', type: 'agent.usage', provider: 'codex', data: { usage: { input: 500_000, output: 50_000 } } });
    assert.equal(runs.list()[0].usage.cost, 4);
    store.saveSetting('pricing', pricing);
    assert.deepEqual(Object.keys(pricingFrom(store).models).sort(), ['env-only', 'gpt-5']);
    assert.equal(runs.list()[0].usage.cost, 1.25 + 1);
    const detail = runs.detail('priced');
    assert.equal(detail.run.usage.cost, 2.25);
    assert.equal(detail.events[0].data.usage.cost, 1.125);
    assert.equal(store.getRun('priced').usage.cost, null);
  } finally {
    store.close();
    if (previous == null) delete process.env.NOSTRAXIS_PRICING_JSON; else process.env.NOSTRAXIS_PRICING_JSON = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('pricing settings are saved through a JSON-only API route', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nostraxis-pricing-api-'));
  process.env.NOSTRAXIS_SEED = '0';
  process.env.NOSTRAXIS_SESSION_ROOTS_JSON = '[]';
  for (const provider of ['CODEX', 'CLAUDE', 'COPILOT']) process.env[`NOSTRAXIS_${provider}_BIN`] = '/bin/echo';
  const api = createApi({ dataDir: path.join(dir, 'data') });
  const call = async ({ method, headers = {}, body = null }) => {
    const result = { status: 200, body: '' };
    const req = Object.assign(Readable.from(body == null ? [] : [Buffer.from(body)]), { method, url: '/api/settings/pricing', headers: { host: 'localhost:4173', ...headers } });
    await api.handle(req, {
      setHeader() {}, on() {}, write(chunk) { result.body += chunk; return true; },
      writeHead(status) { result.status = status; }, end(chunk) { if (chunk) result.body += chunk; },
    });
    return { status: result.status, json: JSON.parse(result.body) };
  };
  try {
    const body = JSON.stringify({ aiCreditPlan: { usd: '300', credits: '30000' }, models: { 'gpt-5': { inputPerMillion: '1.25', outputPerMillion: '10' } } });
    assert.equal((await call({ method: 'PUT', headers: { 'content-type': 'text/plain' }, body })).status, 403);
    const saved = await call({ method: 'PUT', headers: { 'content-type': 'application/json' }, body });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.json.aiCreditPlan, { usd: 300, credits: 30_000 });
    assert.equal(saved.json.aiCreditUsd, 0.01);
    assert.deepEqual(saved.json.models['gpt-5'], { inputPerMillion: 1.25, cachedInputPerMillion: null, outputPerMillion: 10 });
    const invalid = await call({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ premiumRequestPlan: { usd: 'free', credits: 10 } }) });
    assert.equal(invalid.status, 400);
    assert.equal((await call({ method: 'GET' })).json.aiCreditUsd, 0.01);
  } finally {
    await api.close();
    await rm(dir, { recursive: true, force: true });
  }
});

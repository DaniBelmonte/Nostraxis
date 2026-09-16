import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProviderUsageSnapshot, calculateCopilotRangeUsage, parseCodexUsageRecords, parseCopilotQuota } from '../server/sources/provider-usage.mjs';

test('Codex usage exposes real rate windows, reset timestamps, plan and session tokens', () => {
  const parsed = parseCodexUsageRecords([
    { type: 'turn_context', timestamp: '2026-09-11T10:00:00.000Z', payload: { model: 'gpt-test' } },
    {
      type: 'event_msg', timestamp: '2026-09-11T10:01:00.000Z', payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 1200, output_tokens: 300, total_tokens: 1500 } },
        rate_limits: {
          primary: { used_percent: 20, window_minutes: 300, resets_at: 1789128000 },
          secondary: { used_percent: 91, window_minutes: 10080, resets_at: 1789732800 },
          credits: { has_credits: true, balance: '4.25' },
          plan_type: 'plus',
        },
      },
    },
    { type: 'turn_context', timestamp: '2026-09-11T10:02:00.000Z', payload: { model: 'codex-auto-review' } },
    {
      type: 'event_msg', timestamp: '2026-09-11T10:03:00.000Z', payload: {
        type: 'token_count',
        info: { total_token_usage: { total_tokens: 99 } },
        rate_limits: {
          primary: { used_percent: 99, window_minutes: 300, resets_at: 1789128600 },
          secondary: { used_percent: 95, window_minutes: 10080, resets_at: 1789733400 },
          credits: { has_credits: true, balance: '4.25' },
          plan_type: 'plus',
        },
      },
    },
  ]);

  assert.equal(parsed.model, 'gpt-test');
  assert.equal(parsed.tokensUsed, 1500);
  assert.equal(parsed.plan, 'plus');
  assert.equal(parsed.creditBalance, 4.25);
  assert.deepEqual(parsed.windows.map(({ label, usedPercent, availablePercent }) => ({ label, usedPercent, availablePercent })), [
    { label: '5 hours', usedPercent: 99, availablePercent: 1 },
    { label: '7 days', usedPercent: 95, availablePercent: 5 },
  ]);
  assert.equal(parsed.windows[0].resetsAt, new Date(1789128600 * 1000).toISOString());
});

test('provider snapshot keeps unsupported quota and reset fields unavailable', () => {
  const snapshot = buildProviderUsageSnapshot({
    refreshedAt: '2026-09-11T12:00:00.000Z',
    providers: [
      { id: 'claude', available: true, version: 'Claude 1' },
      { id: 'copilot', available: true, version: 'Copilot 1' },
    ],
    sources: [{ provider: 'copilot', available: true, lastSyncAt: '2026-09-11T11:59:00.000Z' }],
    claudeAuth: { loggedIn: false },
    runs: [
      { provider: 'claude', model: 'claude-test', updatedAt: '2026-09-11T11:00:00.000Z', usage: { input: 50, output: 20, source: 'provider-log' } },
      { provider: 'copilot', model: 'copilot-test', updatedAt: '2026-09-11T11:30:00.000Z', usage: { observedTokens: 900, observedTokenScope: 'subagents', credits: 2.55, creditUnit: 'AI credits', source: 'opentelemetry' } },
    ],
  });
  const claude = snapshot.providers.find(({ id }) => id === 'claude');
  const copilot = snapshot.providers.find(({ id }) => id === 'copilot');

  assert.equal(claude.connection, 'disconnected');
  assert.equal(claude.tokensUsed, 70);
  assert.deepEqual(claude.windows, []);
  assert.equal(claude.plan, null);
  assert.equal(copilot.connection, 'local-data');
  assert.equal(copilot.tokensUsed, 900);
  assert.equal(copilot.tokenScope, 'observed agents');
  assert.equal(copilot.creditsUsed, 2.55);
  assert.deepEqual(copilot.windows, []);
});

test('Copilot Business quota uses the account-wide AI credit limit rather than a local CLI session total', () => {
  const quota = parseCopilotQuota({
    copilot_plan: 'business',
    token_based_billing: true,
    quota_reset_date_utc: '2026-10-01T00:00:00.000Z',
    quota_snapshots: {
      premium_interactions: {
        entitlement: 13_000,
        remaining: 9_749.3,
        timestamp_utc: '2026-09-14T16:18:00.000Z',
      },
    },
  });
  const snapshot = buildProviderUsageSnapshot({
    providers: [{ id: 'copilot', available: true, version: 'Copilot 1.0.54' }],
    runs: [{ provider: 'copilot', model: 'claude-sonnet-5', updatedAt: '2026-09-14T16:17:00.000Z', usage: { credits: 633.4, creditUnit: 'AI credits', source: 'opentelemetry' } }],
    copilotQuota: quota,
  });
  const copilot = snapshot.providers.find(({ id }) => id === 'copilot');

  assert.equal(copilot.connection, 'connected');
  assert.equal(copilot.plan, 'Copilot Business');
  assert.equal(copilot.creditsUsed, 3_250.7);
  assert.equal(copilot.creditBalance, 9_749.3);
  assert.equal(copilot.creditUnit, 'AI credits');
  assert.equal(copilot.windows[0].label, 'Monthly AI credits');
  assert.equal(copilot.windows[0].usedPercent, 25.005384615384614);
  assert.equal(copilot.windows[0].resetsAt, '2026-10-01T00:00:00.000Z');
  assert.equal(copilot.source, 'GitHub Copilot account quota');
});

test('Copilot date range usage sums every observed chat by its start date and uses the entitlement as denominator', () => {
  const usage = calculateCopilotRangeUsage({
    from: '2026-09-10', to: '2026-09-11', creditUnit: 'AI credits', limit: 100,
    runs: [
      { provider: 'copilot', startedAt: '2026-09-09T23:59:59.000Z', usage: { credits: 40, creditUnit: 'AI credits' } },
      { provider: 'copilot', startedAt: '2026-09-10T12:00:00.000Z', updatedAt: '2026-09-14T12:00:00.000Z', usage: { credits: 12.5, creditUnit: 'AI credits' } },
      { provider: 'copilot', startedAt: '2026-09-11T23:59:59.000Z', usage: { credits: 7.5, creditUnit: 'AI credits' } },
      { provider: 'copilot', startedAt: '2026-09-11T10:00:00.000Z', usage: { credits: 3, creditUnit: 'premium requests' } },
    ],
  });

  assert.equal(usage.creditsUsed, 20);
  assert.equal(usage.usedPercent, 20);
  assert.equal(usage.sessionCount, 2);
});

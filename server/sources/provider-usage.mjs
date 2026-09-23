import { execFile } from 'node:child_process';
import { open, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const MAX_TAIL_BYTES = 4 * 1024 * 1024;
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const timestamp = (value) => {
  const result = Date.parse(value || '');
  return Number.isFinite(result) ? result : 0;
};

function usageWindow(value, index) {
  if (!value || !finite(value.used_percent)) return null;
  const minutes = finite(value.window_minutes) ? value.window_minutes : null;
  const knownLabel = minutes === 300 ? '5 hours' : minutes === 10_080 ? '7 days' : null;
  return {
    id: index === 0 ? 'primary' : 'secondary',
    label: knownLabel || (minutes == null ? `Limit ${index + 1}` : `${minutes} min`),
    usedPercent: value.used_percent,
    availablePercent: Math.max(0, 100 - value.used_percent),
    resetsAt: finite(value.resets_at) ? new Date(value.resets_at * 1000).toISOString() : null,
    windowMinutes: minutes,
  };
}

const isoDate = (value) => {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};

function quotaNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function rangeBoundary(value, end = false) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function runTimestamp(run) {
  return timestamp(run?.startedAt || run?.updatedAt || run?.endedAt);
}

/**
 * Sum the Copilot credit measurements captured by every observed Copilot chat.
 * The subscription entitlement is deliberately kept separate: it is a live
 * account value, whereas the range total is evidence from local session logs.
 */
export function calculateCopilotRangeUsage({ runs = [], creditUnit = null, limit = null, from = null, to = null } = {}) {
  const fromAt = rangeBoundary(from);
  const toAt = rangeBoundary(to, true);
  const matchingRuns = runs.filter((run) => {
    if (run?.provider !== 'copilot') return false;
    const at = runTimestamp(run);
    if (!at || (fromAt != null && at < fromAt) || (toAt != null && at > toAt)) return false;
    const credits = run.usage?.credits;
    return finite(credits) && (!creditUnit || !run.usage?.creditUnit || run.usage.creditUnit === creditUnit);
  });
  if (!matchingRuns.length) {
    return { from, to, creditsUsed: null, usedPercent: null, sessionCount: 0, source: 'Observed Copilot chats' };
  }
  const creditsUsed = Number(matchingRuns.reduce((total, run) => total + run.usage.credits, 0).toFixed(6));
  return {
    from,
    to,
    creditsUsed,
    usedPercent: finite(limit) && limit > 0 ? creditsUsed * 100 / limit : null,
    sessionCount: matchingRuns.length,
    source: 'Observed Copilot chats',
  };
}

/**
 * Normalise the account-level quota that VS Code gets from GitHub Copilot.
 *
 * `premium_interactions` is a historical key retained by the endpoint. For
 * token-based Business and Enterprise billing its entitlement is measured in
 * AI credits, not in legacy premium requests.
 */
export function parseCopilotQuota(payload, observedAt = new Date().toISOString()) {
  if (!payload || typeof payload !== 'object') return null;
  const quota = payload.quota_snapshots?.premium_interactions;
  const planId = typeof payload.copilot_plan === 'string' ? payload.copilot_plan.toLowerCase() : null;
  const plan = planId === 'business' ? 'Copilot Business'
    : planId === 'enterprise' ? 'Copilot Enterprise'
      : planId === 'individual' ? 'Copilot Individual'
        : planId === 'free' ? 'Copilot Free' : null;
  if (!quota || typeof quota !== 'object') {
    return plan ? { plan, updatedAt: isoDate(observedAt), source: 'GitHub Copilot account quota' } : null;
  }

  const entitlement = quotaNumber(quota.entitlement);
  const remaining = quotaNumber(quota.remaining ?? quota.quota_remaining);
  const percentRemaining = quotaNumber(quota.percent_remaining);
  const rawUsed = entitlement != null && remaining != null
    ? Math.max(0, entitlement - remaining)
    : entitlement != null && percentRemaining != null
      ? entitlement * Math.max(0, 100 - percentRemaining) / 100
      : null;
  const used = rawUsed == null ? null : Number(rawUsed.toFixed(6));
  const usedPercent = entitlement != null && entitlement > 0 && used != null
    ? Math.min(100, used * 100 / entitlement)
    : percentRemaining != null ? Math.min(100, Math.max(0, 100 - percentRemaining)) : null;
  const resetAt = isoDate(payload.quota_reset_date_utc || payload.quota_reset_date);
  const isAiCreditBilling = payload.token_based_billing === true || planId === 'business' || planId === 'enterprise';
  const creditUnit = isAiCreditBilling ? 'AI credits' : 'premium requests';
  const updatedAt = isoDate(quota.timestamp_utc) || isoDate(observedAt);

  return {
    plan,
    windows: quota.unlimited || entitlement == null || usedPercent == null ? [] : [{
      id: 'copilot-monthly-credits',
      label: isAiCreditBilling ? 'Monthly AI credits' : 'Monthly premium requests',
      limit: entitlement,
      used,
      available: remaining,
      usedPercent,
      availablePercent: Math.max(0, 100 - usedPercent),
      resetsAt: resetAt,
      windowMinutes: null,
    }],
    creditsUsed: used,
    creditUnit,
    creditBalance: remaining,
    updatedAt,
    source: 'GitHub Copilot account quota',
  };
}

async function probeCopilotQuota() {
  const explicitToken = process.env.NOSTRAXIS_COPILOT_TOKEN;
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2025-05-01',
  };
  try {
    if (explicitToken) {
      const response = await fetch('https://api.github.com/copilot_internal/user', {
        headers: { ...headers, Authorization: `Bearer ${explicitToken}` },
        signal: AbortSignal.timeout(4_000),
      });
      if (response.ok) return parseCopilotQuota(await response.json());
    }
  } catch { /* fall back to the user's GitHub CLI session */ }

  try {
    const { stdout } = await exec('gh', [
      'api', '/copilot_internal/user',
      '-H', 'Accept: application/vnd.github+json',
      '-H', 'X-GitHub-Api-Version: 2025-05-01',
    ], { timeout: 4_000, maxBuffer: 64_000 });
    return parseCopilotQuota(JSON.parse(stdout || '{}'));
  } catch {
    return null;
  }
}

export function parseCodexUsageRecords(records) {
  let model = null;
  let activeModel = null;
  let modelAt = 0;
  let usage = null;
  let usageAt = 0;
  for (const record of records || []) {
    const at = timestamp(record?.timestamp);
    if (record?.type === 'turn_context' && record.payload?.model) {
      activeModel = record.payload.model;
      if (!/auto-review/i.test(activeModel) && at >= modelAt) {
        model = activeModel;
        modelAt = at;
      }
    }
    if (record?.type !== 'event_msg' || record.payload?.type !== 'token_count' || at < usageAt) continue;
    const isAdministrativeModel = /auto-review/i.test(activeModel || '');
    const limits = record.payload.rate_limits;
    const tokenUsage = record.payload.info?.total_token_usage;
    if (!limits && !tokenUsage) continue;
    const totalTokens = finite(tokenUsage?.total_tokens)
      ? tokenUsage.total_tokens
      : finite(tokenUsage?.input_tokens) && finite(tokenUsage?.output_tokens)
        ? tokenUsage.input_tokens + tokenUsage.output_tokens
        : null;
    const windows = [limits?.primary, limits?.secondary]
      .map(usageWindow)
      .filter(Boolean);
    const creditBalance = limits?.credits?.has_credits && finite(Number(limits.credits.balance))
      ? Number(limits.credits.balance)
      : null;
    usage = {
      windows: windows.length ? windows : usage?.windows || [],
      tokensUsed: isAdministrativeModel ? usage?.tokensUsed ?? null : totalTokens,
      tokenScope: isAdministrativeModel ? usage?.tokenScope || null : totalTokens == null ? null : 'current session',
      creditsUsed: null,
      creditUnit: null,
      creditBalance: creditBalance ?? usage?.creditBalance ?? null,
      plan: limits?.plan_type || usage?.plan || null,
      updatedAt: record.timestamp || null,
      source: 'Local Codex events',
    };
    usageAt = at;
  }
  if (!usage && !model) return null;
  return { ...(usage || {}), model, updatedAt: usage?.updatedAt || (modelAt ? new Date(modelAt).toISOString() : null) };
}

async function newestJsonl(root) {
  let newest = null;
  async function visit(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch { return; }
    await Promise.all(entries.map(async (entry) => {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) return visit(filename);
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) return;
      try {
        const info = await stat(filename);
        if (!newest || info.mtimeMs > newest.modified) newest = { filename, modified: info.mtimeMs };
      } catch { /* file rotated during discovery */ }
    }));
  }
  await visit(root);
  return newest?.filename || null;
}

async function readTailRecords(filename) {
  if (!filename) return [];
  const info = await stat(filename);
  const start = Math.max(0, info.size - MAX_TAIL_BYTES);
  const file = await open(filename, 'r');
  try {
    const buffer = Buffer.alloc(info.size - start);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    if (start > 0) text = text.slice(Math.max(0, text.indexOf('\n') + 1));
    return text.split('\n').filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; }
      catch { return []; }
    });
  } finally { await file.close(); }
}

function latestRunFor(provider, runs) {
  return (runs || [])
    .filter((run) => run.provider === provider)
    .sort((a, b) => timestamp(b.updatedAt || b.endedAt || b.startedAt) - timestamp(a.updatedAt || a.endedAt || a.startedAt))[0] || null;
}

function usageFromRun(run) {
  const usage = run?.usage;
  if (!run) return {};
  let tokensUsed = null;
  let tokenScope = null;
  if (finite(usage?.input) && finite(usage?.output)) {
    tokensUsed = usage.input + usage.output;
    tokenScope = 'observed session';
  } else if (finite(usage?.total)) {
    tokensUsed = usage.total;
    tokenScope = 'observed session';
  } else if (finite(usage?.observedTokens)) {
    tokensUsed = usage.observedTokens;
    tokenScope = usage.observedTokenScope === 'subagents' ? 'observed agents' : 'observed';
  }
  return {
    model: run.model || null,
    windows: [],
    tokensUsed,
    tokenScope,
    creditsUsed: finite(usage?.credits) ? usage.credits : null,
    creditUnit: usage?.creditUnit || null,
    creditBalance: null,
    plan: null,
    updatedAt: run.updatedAt || run.endedAt || run.startedAt || null,
    source: usage?.source?.includes('opentelemetry') ? 'OpenTelemetry' : 'Local session log',
  };
}

function connectionFor(id, cli, source, auth, usage) {
  if (id === 'claude' && auth?.loggedIn === true) return 'connected';
  if (id === 'claude' && auth?.loggedIn === false) return 'disconnected';
  if (id === 'copilot' && usage?.source === 'GitHub Copilot account quota') return 'connected';
  if (usage?.updatedAt || source?.available) return 'local-data';
  if (cli?.available) return 'cli-available';
  return 'unavailable';
}

export function buildProviderUsageSnapshot({ runs = [], providers = [], sources = [], codex = null, claudeAuth = null, copilotQuota = null, range = {}, refreshedAt = new Date().toISOString() } = {}) {
  const providerIds = [...new Set(['codex', 'claude', 'copilot', ...providers.map((provider) => provider.id)])]
    .filter((id) => id !== 'custom');
  const result = providerIds.map((id) => {
    const cli = providers.find((item) => item.id === id) || null;
    const source = sources.find((item) => item.provider === id && item.available) || null;
    const runUsage = usageFromRun(latestRunFor(id, runs));
    const usage = id === 'codex' && codex ? { ...runUsage, ...codex }
      : id === 'copilot' && copilotQuota ? { ...runUsage, ...copilotQuota }
        : runUsage;
    const windows = usage.windows || [];
    const primaryLimit = id === 'copilot' ? windows.find((window) => finite(window.limit))?.limit ?? null : null;
    return {
      id,
      name: cli?.name || (id === 'codex' ? 'Codex / ChatGPT' : id === 'claude' ? 'Claude' : id === 'copilot' ? 'GitHub Copilot' : id),
      version: cli?.version || null,
      connection: connectionFor(id, cli, source, claudeAuth, usage),
      model: usage.model || null,
      plan: usage.plan || null,
      windows,
      tokensUsed: usage.tokensUsed ?? null,
      tokenScope: usage.tokenScope || null,
      creditsUsed: usage.creditsUsed ?? null,
      creditUnit: usage.creditUnit || null,
      creditBalance: usage.creditBalance ?? null,
      updatedAt: usage.updatedAt || source?.lastSyncAt || null,
      source: usage.updatedAt ? usage.source : source?.available ? 'Local session detector' : null,
      ...(id === 'copilot' ? {
        rangeUsage: calculateCopilotRangeUsage({
          runs,
          creditUnit: usage.creditUnit || null,
          limit: primaryLimit,
          from: range.from || null,
          to: range.to || null,
        }),
      } : {}),
    };
  });
  return { refreshedAt, providers: result };
}

async function probeClaudeAuth() {
  const executable = process.env.NOSTRAXIS_CLAUDE_BIN || 'claude';
  try {
    const { stdout } = await exec(executable, ['auth', 'status', '--json'], { timeout: 4000, maxBuffer: 64_000 });
    return JSON.parse(stdout || '{}');
  } catch (error) {
    try { return JSON.parse(error.stdout || '{}'); }
    catch { return null; }
  }
}

export function createProviderUsageService({ runs, getProviders, getSources, codexRoot, authProbe = probeClaudeAuth, copilotQuotaProbe = probeCopilotQuota, ttlMs = 20_000 } = {}) {
  let cached = null;
  let cachedAt = 0;
  let pending = null;
  async function collect() {
    const root = codexRoot || process.env.NOSTRAXIS_CODEX_HOME || path.join(os.homedir(), '.codex', 'sessions');
    const [codex, claudeAuth, copilotQuota] = await Promise.all([
      newestJsonl(root).then(readTailRecords).then(parseCodexUsageRecords).catch(() => null),
      authProbe().catch(() => null),
      copilotQuotaProbe().catch(() => null),
    ]);
    cached = buildProviderUsageSnapshot({
      runs: runs?.list?.() || [],
      providers: getProviders?.() || [],
      sources: getSources?.() || [],
      codex,
      claudeAuth,
      copilotQuota,
    });
    cachedAt = Date.now();
    return cached;
  }
  return {
    async get({ force = false, from = null, to = null } = {}) {
      if (force || !cached || Date.now() - cachedAt >= ttlMs) {
        if (!pending) pending = collect().finally(() => { pending = null; });
        await pending;
      }
      const copilot = cached.providers.find((provider) => provider.id === 'copilot');
      if (!copilot) return cached;
      return {
        ...cached,
        providers: cached.providers.map((provider) => provider.id === 'copilot' ? {
          ...provider,
          rangeUsage: calculateCopilotRangeUsage({
            runs: runs?.list?.() || [], creditUnit: provider.creditUnit, limit: provider.windows.find((window) => finite(window.limit))?.limit ?? null,
            from, to,
          }),
        } : provider),
      };
    },
  };
}

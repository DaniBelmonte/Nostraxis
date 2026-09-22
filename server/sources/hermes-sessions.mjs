import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { toIsoTimestamp } from '../core/timing.mjs';

const MAX_TEXT = 250_000;
const REQUIRED_SESSION_COLUMNS = new Set([
  'id', 'source', 'model', 'started_at', 'ended_at', 'end_reason', 'cwd',
  'input_tokens', 'output_tokens', 'cache_read_tokens', 'reasoning_tokens',
  'hidden', 'archived',
]);
const REQUIRED_MESSAGE_COLUMNS = new Set([
  'id', 'session_id', 'role', 'content', 'tool_calls', 'tool_name', 'timestamp', 'active',
]);
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const short = (value, length = 80) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, length);

const parseJson = (value, fallback = null) => {
  if (typeof value !== 'string') return value ?? fallback;
  try { return JSON.parse(value); }
  catch { return fallback; }
};

function textOf(value) {
  if (value == null) return '';
  if (typeof value === 'string') {
    const parsed = parseJson(value);
    return parsed == null ? value : textOf(parsed);
  }
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    for (const key of ['text', 'content', 'message', 'result', 'output', 'stdout', 'stderr']) {
      const text = textOf(value[key]);
      if (text) return text;
    }
  }
  return '';
}

export function hermesWorkload(source) {
  if (source === 'cron') return 'automation';
  if (source === 'cli' || source === 'tui' || source === 'desktop') return 'interactive';
  return 'messaging';
}

function observedId(nativeId) {
  return `external-${createHash('sha256').update(`hermes:${nativeId}`).digest('hex').slice(0, 24)}`;
}

function usageOf(row) {
  const usageRows = Array.isArray(row.modelUsage) && row.modelUsage.length ? row.modelUsage : [row];
  const sum = (key) => {
    const values = usageRows.map((item) => item[key]).filter(finite);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };
  const input = sum('input_tokens');
  const output = sum('output_tokens');
  const cached = sum('cache_read_tokens');
  const cacheWrite = sum('cache_write_tokens');
  const reasoning = sum('reasoning_tokens');
  const apiCalls = sum('api_call_count');
  const hasUsage = (apiCalls || 0) > 0
    || [input, output, cached, cacheWrite, reasoning].some((value) => finite(value) && value > 0)
    || usageRows.some((item) => item.cost_status != null);
  if (!hasUsage) return null;
  const costValues = usageRows.map((item) => item.cost_status === 'estimated'
    ? item.estimated_cost_usd
    : finite(item.actual_cost_usd) ? item.actual_cost_usd : item.estimated_cost_usd).filter(finite);
  const cost = costValues.length ? costValues.reduce((total, value) => total + value, 0) : null;
  const billingProviders = [...new Set(usageRows.map((item) => item.billing_provider).filter(Boolean))];
  return {
    input,
    output,
    cached,
    cacheWrite,
    reasoning,
    cost,
    apiCalls,
    billingProvider: billingProviders.length === 1 ? billingProviders[0] : billingProviders.length ? 'mixed' : null,
    costStatus: usageRows.find((item) => item.cost_status)?.cost_status || null,
    source: 'hermes-state',
    costSource: usageRows.find((item) => item.cost_source)?.cost_source || null,
  };
}

function statusOf(row, now) {
  if (row.end_reason === 'cron_incomplete_no_output' || /(?:error|fail)/i.test(row.end_reason || '')) return 'failed';
  if (row.ended_at != null || row.end_reason) return 'completed';
  const lastActivity = Number(row.last_activity_at ?? row.started_at);
  return finite(lastActivity) && now - lastActivity * 1000 <= 300_000 ? 'running' : 'unknown';
}

function toolData(name, argumentsValue, fallbackText = '') {
  const input = parseJson(argumentsValue, argumentsValue) || {};
  const object = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const command = typeof object.command === 'string' ? object.command
    : typeof object.cmd === 'string' ? object.cmd : null;
  const file = object.file_path || object.path || object.file || null;
  const write = /write|edit|patch|create|delete|move/i.test(name || '');
  const read = /read|search|glob|grep|find|list/i.test(name || '');
  return {
    text: command || (file ? `${name} · ${file}` : fallbackText || name || 'tool'),
    tool: name || 'tool',
    command,
    path: typeof file === 'string' ? file : null,
    access: write ? 'write' : read ? 'read' : 'unknown',
  };
}

export function normalizeHermesSession(row, messages, now = Date.now()) {
  const source = row.source || 'unknown';
  const workload = hermesWorkload(source);
  const events = [];
  const calls = new Map();
  let prompt = '';
  let response = '';
  let lastMessageAt = toIsoTimestamp(row.started_at, new Date(now).toISOString());

  for (const message of messages) {
    const at = toIsoTimestamp(message.timestamp, lastMessageAt);
    lastMessageAt = at || lastMessageAt;
    const text = textOf(message.content).trim().slice(-MAX_TEXT);
    if (message.role === 'user') {
      prompt ||= text;
      events.push({ type: 'agent.input', timestamp: at, data: { text, userAction: workload !== 'automation', hermesSource: source } });
    }
    if (message.role === 'assistant') {
      if (text) {
        response = text;
        events.push({ type: 'agent.output', timestamp: at, data: { text } });
      }
      const toolCalls = parseJson(message.tool_calls, []);
      for (const call of Array.isArray(toolCalls) ? toolCalls : []) {
        const name = call?.function?.name || call?.name || 'tool';
        const data = toolData(name, call?.function?.arguments ?? call?.arguments);
        const type = data.command ? 'agent.command_started'
          : data.path ? (data.access === 'write' ? 'agent.file_modified' : 'agent.file_read')
            : 'agent.tool_called';
        calls.set(call?.id || `${message.id}:${name}`, data);
        events.push({ type, timestamp: at, data: { ...data, toolCallId: call?.id || null } });
      }
    }
    if (message.role === 'tool') {
      const started = calls.get(message.tool_call_id);
      const data = started || toolData(message.tool_name, null, short(text, 1000));
      events.push({ type: 'agent.tool_completed', timestamp: at, data: { ...data, text: short(text, 1000) || `${data.tool} completed`, toolCallId: message.tool_call_id || null } });
    }
  }

  const usage = usageOf(row);
  const usageAt = (row.modelUsage || []).reduce((latest, item) => Math.max(latest, Number(item.last_seen) || 0), 0);
  let activitySeconds = Math.max(Number(row.last_activity_at) || 0, Number(row.started_at) || 0, usageAt);
  for (const message of messages) activitySeconds = Math.max(activitySeconds, Number(message.timestamp) || 0);
  const activityRow = { ...row, last_activity_at: activitySeconds };
  const usageTimestamp = usageAt ? toIsoTimestamp(usageAt, lastMessageAt) : lastMessageAt;
  if (usage) events.push({ type: 'agent.usage', timestamp: usageTimestamp, data: { text: 'Hermes usage reported', usage } });
  if (statusOf(activityRow, now) === 'completed') events.push({ type: 'agent.completed', timestamp: lastMessageAt, data: { text: row.end_reason || 'Hermes session completed' } });
  if (statusOf(activityRow, now) === 'failed') events.push({ type: 'agent.error', timestamp: lastMessageAt, data: { text: row.end_reason || 'Hermes session failed' } });

  const nativeSessionId = String(row.id);
  const repositoryPath = row.git_repo_root || row.cwd || '';
  const startedAt = toIsoTimestamp(row.started_at, lastMessageAt);
  const updatedAt = toIsoTimestamp(activitySeconds, lastMessageAt) || lastMessageAt;
  return {
    snapshot: {
      id: observedId(nativeSessionId),
      nativeSessionId,
      provider: 'hermes',
      model: row.model || '',
      name: short(row.title, 80) || short(prompt, 80) || `Hermes ${workload}`,
      prompt,
      response,
      repositoryPath,
      startedAt,
      endedAt: row.ended_at == null ? null : toIsoTimestamp(row.ended_at, updatedAt),
      updatedAt,
      status: statusOf(activityRow, now),
      usage,
      usageScope: usage ? 'session' : 'unavailable',
      sourcePath: row.databasePath || '',
      sourceKind: source,
      workload,
      sourceKindLabel: source === 'cron' ? 'Hermes cron' : source === 'cli' ? 'Hermes CLI' : `Hermes ${source}`,
      billingProvider: row.billing_provider || null,
      sourceKindMetadata: {
        hermesSource: source,
        endReason: row.end_reason || null,
        usageRoutes: (row.modelUsage || []).map((item) => ({
          model: item.model || null,
          billingProvider: item.billing_provider || null,
          task: item.task || null,
        })),
      },
      clipped: false,
    },
    events,
  };
}

function columns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function assertSchema(db) {
  const sessionColumns = columns(db, 'sessions');
  const messageColumns = columns(db, 'messages');
  const missing = [
    ...[...REQUIRED_SESSION_COLUMNS].filter((column) => !sessionColumns.has(column)).map((column) => `sessions.${column}`),
    ...[...REQUIRED_MESSAGE_COLUMNS].filter((column) => !messageColumns.has(column)).map((column) => `messages.${column}`),
  ];
  if (missing.length) throw new Error(`Unsupported Hermes state schema; missing ${missing.join(', ')}`);
}

export function readHermesSessions(databasePath, {
  now = Date.now(), maxAgeMs = 14 * 86_400_000, maxSessions = 80,
  sources = process.env.NOSTRAXIS_HERMES_SOURCES
    ? String(process.env.NOSTRAXIS_HERMES_SOURCES).split(',').map((value) => value.trim()).filter(Boolean)
    : [],
} = {}) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000;');
    assertSchema(db);
    const cutoff = maxAgeMs == null ? 0 : (now - maxAgeMs) / 1000;
    const placeholders = sources.map(() => '?').join(',');
    const rows = db.prepare(`SELECT * FROM sessions
      WHERE hidden=0 AND archived=0
        AND COALESCE(last_activity_at, ended_at, started_at) >= ?
        ${sources.length ? `AND source IN (${placeholders})` : ''}
      ORDER BY COALESCE(last_activity_at, ended_at, started_at) DESC
      LIMIT ?`).all(cutoff, ...sources, maxSessions);
    const messageQuery = db.prepare(`SELECT id,session_id,role,content,tool_call_id,tool_calls,tool_name,timestamp,token_count,finish_reason
      FROM messages WHERE session_id=? AND active=1 ORDER BY timestamp,id`);
    const usageColumns = columns(db, 'session_model_usage');
    const modelUsageQuery = ['session_id', 'model', 'billing_provider', 'task', 'api_call_count', 'input_tokens',
      'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'reasoning_tokens', 'estimated_cost_usd',
      'actual_cost_usd', 'cost_status', 'cost_source', 'first_seen', 'last_seen']
      .every((column) => usageColumns.has(column))
      ? db.prepare('SELECT * FROM session_model_usage WHERE session_id=? ORDER BY COALESCE(last_seen,first_seen),model,task')
      : null;
    return rows.map((row) => normalizeHermesSession(
      { ...row, databasePath: path.resolve(databasePath), modelUsage: modelUsageQuery?.all(row.id) || [] },
      messageQuery.all(row.id),
      now,
    ));
  } finally {
    db.close();
  }
}

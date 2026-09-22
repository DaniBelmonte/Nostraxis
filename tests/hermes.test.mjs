import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hermesWorkload, normalizeHermesSession, readHermesSessions } from '../server/sources/hermes-sessions.mjs';

const at = (value) => Date.parse(value) / 1000;

function createHermesDatabase(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`
    CREATE TABLE sessions(
      id TEXT PRIMARY KEY, source TEXT NOT NULL, model TEXT, started_at REAL NOT NULL,
      ended_at REAL, end_reason TEXT, cwd TEXT, git_repo_root TEXT, title TEXT,
      last_activity_at REAL, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0,
      reasoning_tokens INTEGER DEFAULT 0, api_call_count INTEGER DEFAULT 0,
      billing_provider TEXT, estimated_cost_usd REAL, actual_cost_usd REAL,
      cost_status TEXT, cost_source TEXT, hidden INTEGER DEFAULT 0, archived INTEGER DEFAULT 0
    );
    CREATE TABLE messages(
      id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT,
      tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL NOT NULL,
      token_count INTEGER, finish_reason TEXT, active INTEGER DEFAULT 1
    );
    CREATE TABLE session_model_usage(
      session_id TEXT NOT NULL, model TEXT NOT NULL, billing_provider TEXT NOT NULL DEFAULT '',
      billing_base_url TEXT NOT NULL DEFAULT '', billing_mode TEXT NOT NULL DEFAULT '',
      task TEXT NOT NULL DEFAULT '', api_call_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0, estimated_cost_usd REAL NOT NULL DEFAULT 0,
      actual_cost_usd REAL NOT NULL DEFAULT 0, cost_status TEXT, cost_source TEXT,
      first_seen REAL, last_seen REAL,
      PRIMARY KEY(session_id,model,billing_provider,billing_base_url,billing_mode,task)
    );
  `);
  return db;
}

test('Hermes SQLite sessions preserve activity type, tools, usage and billing route', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nostraxis-hermes-'));
  const filename = path.join(dir, 'state.db');
  const db = createHermesDatabase(filename);
  const started = at('2026-09-21T10:00:00.000Z');
  const ended = at('2026-09-21T10:02:00.000Z');
  db.prepare(`INSERT INTO sessions(
    id,source,model,started_at,ended_at,end_reason,cwd,title,last_activity_at,
    input_tokens,output_tokens,cache_read_tokens,reasoning_tokens,api_call_count,
    billing_provider,estimated_cost_usd,cost_status,cost_source
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'hermes-1', 'cron', 'gpt-test', started, ended, 'cron_complete', '/workspace/demo',
    'Daily audit', ended, 120, 30, 40, 5, 2, 'openai-codex', 0.004, 'estimated', 'test-pricing',
  );
  const insert = db.prepare('INSERT INTO messages(id,session_id,role,content,tool_call_id,tool_calls,tool_name,timestamp) VALUES (?,?,?,?,?,?,?,?)');
  insert.run(1, 'hermes-1', 'user', 'Run the daily audit.', null, null, null, started);
  insert.run(2, 'hermes-1', 'assistant', '', null, JSON.stringify([{ id: 'call-1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'README.md' }) } }]), null, started + 20);
  insert.run(3, 'hermes-1', 'tool', 'File contents', 'call-1', null, 'read_file', started + 30);
  insert.run(4, 'hermes-1', 'assistant', 'Audit complete.', null, null, null, ended);
  db.close();

  try {
    const [result] = readHermesSessions(filename, { now: Date.parse('2026-09-22T10:00:00.000Z'), maxAgeMs: 7 * 86_400_000 });
    assert.equal(result.snapshot.provider, 'hermes');
    assert.equal(result.snapshot.workload, 'automation');
    assert.equal(result.snapshot.sourceKind, 'cron');
    assert.equal(result.snapshot.status, 'completed');
    assert.equal(result.snapshot.response, 'Audit complete.');
    assert.equal(result.snapshot.usage.billingProvider, 'openai-codex');
    assert.equal(result.snapshot.usage.cost, 0.004);
    assert.equal(result.events.find((event) => event.type === 'agent.input').data.userAction, false);
    assert.equal(result.events.find((event) => event.type === 'agent.file_read').data.path, 'README.md');
    assert.ok(result.events.some((event) => event.type === 'agent.tool_completed'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Hermes sessions keep unavailable usage null and classify non-code channels', () => {
  const result = normalizeHermesSession({
    id: 'message-1', source: 'telegram', model: '', started_at: at('2026-09-21T10:00:00.000Z'),
    ended_at: null, end_reason: null, cwd: null, input_tokens: 0, output_tokens: 0,
    cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0, api_call_count: 0,
    estimated_cost_usd: null, actual_cost_usd: null, cost_status: null,
    last_activity_at: at('2026-09-21T10:00:10.000Z'), databasePath: '/tmp/state.db',
  }, [{ id: 1, role: 'user', content: 'What is on my calendar?', timestamp: at('2026-09-21T10:00:00.000Z') }], Date.parse('2026-09-22T10:00:00.000Z'));
  assert.equal(hermesWorkload('telegram'), 'messaging');
  assert.equal(hermesWorkload('desktop'), 'interactive');
  assert.equal(result.snapshot.workload, 'messaging');
  assert.equal(result.snapshot.usage, null);
  assert.equal(result.snapshot.usageScope, 'unavailable');
});

test('Hermes imports new desktop sessions and aggregates its model usage routes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nostraxis-hermes-desktop-'));
  const filename = path.join(dir, 'state.db');
  const db = createHermesDatabase(filename);
  const started = at('2026-09-22T11:57:43.000Z');
  const latest = at('2026-09-22T12:02:35.000Z');
  db.prepare(`INSERT INTO sessions(
    id,source,model,started_at,cwd,title,last_activity_at,input_tokens,output_tokens,
    cache_read_tokens,reasoning_tokens,api_call_count,billing_provider,cost_status
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'desktop-1', 'desktop', 'gpt-test', started, '', 'Desktop chat', started,
    100, 10, 20, 2, 1, 'openai-codex', 'included',
  );
  const insertUsage = db.prepare(`INSERT INTO session_model_usage(
    session_id,model,billing_provider,billing_mode,task,api_call_count,input_tokens,
    output_tokens,cache_read_tokens,reasoning_tokens,cost_status,cost_source,first_seen,last_seen
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insertUsage.run('desktop-1', 'gpt-test', 'openai-codex', 'subscription_included', '', 3, 300, 30, 60, 4, 'included', 'none', started, latest - 10);
  insertUsage.run('desktop-1', 'gpt-test', 'openai-codex', '', 'background_review', 1, 80, 8, 10, 1, null, null, latest, latest);
  db.close();

  try {
    const [result] = readHermesSessions(filename, {
      now: Date.parse('2026-09-22T12:03:00.000Z'), maxAgeMs: 86_400_000,
    });
    assert.equal(result.snapshot.sourceKind, 'desktop');
    assert.equal(result.snapshot.workload, 'interactive');
    assert.equal(result.snapshot.status, 'running');
    assert.equal(result.snapshot.usage.input, 380);
    assert.equal(result.snapshot.usage.output, 38);
    assert.equal(result.snapshot.usage.apiCalls, 4);
    assert.equal(result.snapshot.updatedAt, '2026-09-22T12:02:35.000Z');
    assert.equal(result.events.find((event) => event.type === 'agent.usage').timestamp, '2026-09-22T12:02:35.000Z');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

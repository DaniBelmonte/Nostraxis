import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { normalizeEvents, timingFromEvents, toIsoTimestamp } from '../core/timing.mjs';

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS repositories(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  branch TEXT,
  head_sha TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repository_id TEXT,
  repository_name TEXT,
  repository_path TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL,
  prompt TEXT NOT NULL,
  response TEXT,
  native_session_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  updated_at TEXT NOT NULL,
  usage_json TEXT,
  context_snapshot_json TEXT NOT NULL,
  evaluation_json TEXT,
  permissions_json TEXT NOT NULL,
  experiment_id TEXT,
  demo INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL DEFAULT 'dashboard',
  source_path TEXT,
  usage_scope TEXT,
  active_duration_ms INTEGER,
  last_turn_ms INTEGER,
  FOREIGN KEY(repository_id) REFERENCES repositories(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS runs_dimensions ON runs(repository_id, provider, model, started_at);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  data TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS events_run_time ON events(run_id, id);
CREATE TABLE IF NOT EXISTS experiments(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  task TEXT NOT NULL,
  repository_id TEXT,
  evaluator_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  FOREIGN KEY(repository_id) REFERENCES repositories(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS experiment_variants(
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  label TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  prompt_template TEXT NOT NULL,
  context_strategy TEXT NOT NULL,
  context_snapshot_json TEXT NOT NULL,
  run_id TEXT,
  status TEXT NOT NULL,
  FOREIGN KEY(experiment_id) REFERENCES experiments(id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS variants_experiment ON experiment_variants(experiment_id);
`;

const parse = (value, fallback = null) => {
  if (value == null) return fallback;
  try { return JSON.parse(value); }
  catch { return fallback; }
};

const runFromRow = (row) => row ? ({
  id: row.id,
  name: row.name,
  repositoryId: row.repository_id,
  repositoryName: row.repository_name,
  repositoryPath: row.repository_path,
  provider: row.provider,
  model: row.model || '',
  status: row.status,
  prompt: row.prompt,
  response: row.response,
  nativeSessionId: row.native_session_id,
  startedAt: row.started_at,
  endedAt: row.ended_at,
  updatedAt: row.updated_at,
  usage: parse(row.usage_json),
  contextSnapshot: parse(row.context_snapshot_json, {}),
  evaluation: parse(row.evaluation_json),
  permissions: parse(row.permissions_json, {}),
  experimentId: row.experiment_id,
  demo: row.demo === 1,
  origin: row.origin || 'dashboard',
  external: row.origin === 'external',
  sourcePath: row.source_path || null,
  usageScope: row.usage_scope || null,
  activeDurationMs: Number.isFinite(row.active_duration_ms) ? row.active_duration_ms : null,
  lastTurnDurationMs: Number.isFinite(row.last_turn_ms) ? row.last_turn_ms : null,
}) : null;

const repositoryFromRow = (row) => row ? ({ id: row.id, name: row.name, path: row.path, branch: row.branch, headSha: row.head_sha, createdAt: row.created_at }) : null;

const variantFromRow = (row) => ({
  id: row.id, experimentId: row.experiment_id, label: row.label,
  provider: row.provider, model: row.model || '', promptTemplate: row.prompt_template,
  contextStrategy: row.context_strategy, contextSnapshot: parse(row.context_snapshot_json, {}),
  runId: row.run_id, status: row.status,
});

const ISO_PATTERN = '____-__-__T%';
// Bumped whenever the way time is measured changes, so stored runs are
// re-derived from their events instead of keeping a number from an older rule.
const TIMING_MIGRATION = 2;

// Instants written before they were normalised - Codex reports epoch seconds -
// sort before every ISO timestamp and render as an unknown time.
function repairTimestamps(db) {
  const rewrite = (table, column) => {
    const rows = db.prepare(`SELECT rowid AS rowid, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL AND ${column} NOT LIKE ?`).all(ISO_PATTERN);
    const update = db.prepare(`UPDATE ${table} SET ${column}=? WHERE rowid=?`);
    for (const row of rows) {
      const normalized = toIsoTimestamp(row.value, null);
      if (normalized) update.run(normalized, row.rowid);
    }
  };
  rewrite('events', 'timestamp');
  for (const column of ['started_at', 'ended_at', 'updated_at']) rewrite('runs', column);
  // A re-read of a source can persist the same line twice; identical events at
  // the identical instant are one observation.
  db.exec(`DELETE FROM events WHERE id NOT IN (
    SELECT MIN(id) FROM events GROUP BY run_id, timestamp, type, data
  )`);
}

// Runs stored before the turn model existed carry no measured time. Deriving
// it once from their own events replaces the conversation span with the time
// the agent was actually working.
function recomputeRunTiming(db) {
  const stored = db.prepare("SELECT value FROM settings WHERE key='timing.migration'").get();
  if (stored && parse(stored.value, 0) >= TIMING_MIGRATION) return;
  const events = db.prepare('SELECT timestamp, type, data FROM events WHERE run_id=? ORDER BY timestamp, id');
  const update = db.prepare('UPDATE runs SET active_duration_ms=?, last_turn_ms=? WHERE id=?');
  for (const row of db.prepare('SELECT id FROM runs').all()) {
    const timing = timingFromEvents(events.all(row.id).map((event) => ({ timestamp: event.timestamp, type: event.type, data: parse(event.data, {}) })));
    update.run(timing.activeMs, timing.lastTurnMs, row.id);
  }
  db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)').run('timing.migration', JSON.stringify(TIMING_MIGRATION));
}

export function openDatabase(dataDir = path.resolve('.nostraxis')) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, 'dashboard.sqlite'));
  db.exec(SCHEMA);
  const runColumns = new Set(db.prepare('PRAGMA table_info(runs)').all().map((column) => column.name));
  if (!runColumns.has('origin')) db.exec("ALTER TABLE runs ADD COLUMN origin TEXT NOT NULL DEFAULT 'dashboard'");
  if (!runColumns.has('source_path')) db.exec('ALTER TABLE runs ADD COLUMN source_path TEXT');
  if (!runColumns.has('usage_scope')) db.exec('ALTER TABLE runs ADD COLUMN usage_scope TEXT');
  if (!runColumns.has('active_duration_ms')) db.exec('ALTER TABLE runs ADD COLUMN active_duration_ms INTEGER');
  if (!runColumns.has('last_turn_ms')) db.exec('ALTER TABLE runs ADD COLUMN last_turn_ms INTEGER');
  repairTimestamps(db);
  recomputeRunTiming(db);
  const statements = {
    listRuns: db.prepare('SELECT * FROM runs ORDER BY started_at DESC'),
    getRun: db.prepare('SELECT * FROM runs WHERE id=?'),
    deleteRun: db.prepare('DELETE FROM runs WHERE id=?'),
    listEvents: db.prepare('SELECT * FROM events WHERE run_id=? ORDER BY timestamp, id'),
    insertEvent: db.prepare('INSERT INTO events(run_id,timestamp,type,provider,data) VALUES (?,?,?,?,?)'),
    listRepositories: db.prepare('SELECT * FROM repositories ORDER BY name'),
    getRepository: db.prepare('SELECT * FROM repositories WHERE id=?'),
    listExperiments: db.prepare('SELECT * FROM experiments ORDER BY created_at DESC'),
    getExperiment: db.prepare('SELECT * FROM experiments WHERE id=?'),
    variants: db.prepare('SELECT * FROM experiment_variants WHERE experiment_id=? ORDER BY rowid'),
    runSummaries: db.prepare(`
      SELECT run_id,
        COUNT(DISTINCT CASE WHEN type IN ('agent.file_read','agent.file_modified')
          THEN json_extract(data,'$.path') END) AS file_count,
        SUM(CASE WHEN type NOT LIKE '%completed'
          AND COALESCE(json_extract(data,'$.tool'), json_extract(data,'$.command')) IS NOT NULL
          THEN 1 ELSE 0 END) AS tool_count
      FROM events GROUP BY run_id
    `),
  };

  const store = {
    db,
    dataDir,
    setting(key, fallback = null) {
      const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
      return row ? parse(row.value, fallback) : fallback;
    },
    saveSetting(key, value) {
      db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)').run(key, JSON.stringify(value));
    },
    listRuns: () => {
      const summaries = new Map(statements.runSummaries.all().map((row) => [row.run_id, row]));
      return statements.listRuns.all().map(runFromRow).map((run) => {
        const summary = summaries.get(run.id);
        return { ...run, toolCount: summary?.tool_count || 0, fileCount: summary?.file_count || 0 };
      });
    },
    getRun: (id) => runFromRow(statements.getRun.get(id)),
    saveRun(run) {
      db.prepare(`INSERT INTO runs(
        id,name,repository_id,repository_name,repository_path,provider,model,status,prompt,response,
        native_session_id,started_at,ended_at,updated_at,usage_json,context_snapshot_json,
        evaluation_json,permissions_json,experiment_id,demo,origin,source_path,usage_scope,
        active_duration_ms,last_turn_ms
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, repository_id=excluded.repository_id,
        repository_name=excluded.repository_name, repository_path=excluded.repository_path,
        provider=excluded.provider, model=excluded.model, status=excluded.status,
        prompt=excluded.prompt, response=excluded.response,
        native_session_id=excluded.native_session_id, started_at=excluded.started_at,
        ended_at=excluded.ended_at, updated_at=excluded.updated_at,
        usage_json=excluded.usage_json, context_snapshot_json=excluded.context_snapshot_json,
        evaluation_json=excluded.evaluation_json, permissions_json=excluded.permissions_json,
        experiment_id=excluded.experiment_id, demo=excluded.demo, origin=excluded.origin,
        source_path=excluded.source_path, usage_scope=excluded.usage_scope,
        active_duration_ms=excluded.active_duration_ms, last_turn_ms=excluded.last_turn_ms`).run(
        run.id, run.name, run.repositoryId || null, run.repositoryName || null,
        run.repositoryPath, run.provider, run.model || null, run.status, run.prompt || '',
        run.response || null, run.nativeSessionId || null, toIsoTimestamp(run.startedAt, run.startedAt),
        toIsoTimestamp(run.endedAt, null), toIsoTimestamp(run.updatedAt, run.updatedAt),
        run.usage ? JSON.stringify(run.usage) : null,
        JSON.stringify(run.contextSnapshot || {}), run.evaluation ? JSON.stringify(run.evaluation) : null,
        JSON.stringify(run.permissions || {}), run.experimentId || null, run.demo ? 1 : 0,
        run.origin || 'dashboard', run.sourcePath || null, run.usageScope || null,
        Number.isFinite(run.activeDurationMs) ? run.activeDurationMs : null,
        Number.isFinite(run.lastTurnDurationMs) ? run.lastTurnDurationMs : null,
      );
      return run;
    },
    deleteRun: (id) => statements.deleteRun.run(id),
    insertEvent(event) {
      // Providers report instants as ISO strings, epoch seconds or epoch
      // nanoseconds; the column only ever stores ISO-8601 so ordering and
      // duration stay comparable across sources.
      const timestamp = toIsoTimestamp(event.timestamp, null) || new Date().toISOString();
      const result = statements.insertEvent.run(event.runId, timestamp, event.type, event.provider, JSON.stringify(event.data || {}));
      return { ...event, timestamp, id: Number(result.lastInsertRowid) };
    },
    eventsFor(runId) {
      return normalizeEvents(statements.listEvents.all(runId).map((row) => ({ id: row.id, runId: row.run_id, timestamp: row.timestamp, type: row.type, provider: row.provider, data: parse(row.data, {}) })));
    },
    listRepositories: () => statements.listRepositories.all().map(repositoryFromRow),
    getRepository: (id) => repositoryFromRow(statements.getRepository.get(id)),
    saveRepository(repo) {
      db.prepare(`INSERT INTO repositories(id,name,path,branch,head_sha,created_at)
        VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,
        path=excluded.path, branch=excluded.branch, head_sha=excluded.head_sha`).run(
        repo.id, repo.name, repo.path, repo.branch || null, repo.headSha || null, repo.createdAt,
      );
      return repo;
    },
    listExperiments() {
      return statements.listExperiments.all().map((row) => ({
        id: row.id, name: row.name, task: row.task, repositoryId: row.repository_id,
        evaluatorId: row.evaluator_id, status: row.status, createdAt: row.created_at,
        updatedAt: row.updated_at, metadata: parse(row.metadata_json, {}),
        variants: statements.variants.all(row.id).map(variantFromRow),
      }));
    },
    getExperiment(id) {
      const row = statements.getExperiment.get(id);
      return row ? { id: row.id, name: row.name, task: row.task, repositoryId: row.repository_id, evaluatorId: row.evaluator_id, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, metadata: parse(row.metadata_json, {}), variants: statements.variants.all(id).map(variantFromRow) } : null;
    },
    saveExperiment(experiment) {
      db.prepare('INSERT OR REPLACE INTO experiments(id,name,task,repository_id,evaluator_id,status,created_at,updated_at,metadata_json) VALUES (?,?,?,?,?,?,?,?,?)').run(experiment.id, experiment.name, experiment.task, experiment.repositoryId || null, experiment.evaluatorId, experiment.status, experiment.createdAt, experiment.updatedAt, JSON.stringify(experiment.metadata || {}));
      db.prepare('DELETE FROM experiment_variants WHERE experiment_id=?').run(experiment.id);
      const insert = db.prepare('INSERT INTO experiment_variants(id,experiment_id,label,provider,model,prompt_template,context_strategy,context_snapshot_json,run_id,status) VALUES (?,?,?,?,?,?,?,?,?,?)');
      for (const variant of experiment.variants) insert.run(variant.id, experiment.id, variant.label, variant.provider, variant.model || null, variant.promptTemplate, variant.contextStrategy, JSON.stringify(variant.contextSnapshot || {}), variant.runId || null, variant.status);
      return experiment;
    },
    close: () => db.close(),
  };

  if (process.env.NOSTRAXIS_SEED === '1') {
    if (store.listRuns().length === 0) seedDemo(store);
  } else if (!store.setting('realDataDefaultV1', false)) {
    db.exec(`
      DELETE FROM runs WHERE demo=1;
      DELETE FROM experiments WHERE repository_id='repo-payments-api';
      DELETE FROM repositories WHERE id='repo-payments-api'
        AND NOT EXISTS (SELECT 1 FROM runs WHERE repository_id='repo-payments-api')
        AND NOT EXISTS (SELECT 1 FROM experiments WHERE repository_id='repo-payments-api');
    `);
    store.saveSetting('realDataDefaultV1', true);
  }
  return store;
}

function seedDemo(store) {
  const createdAt = '2026-09-09T14:45:00.000Z';
  const repo = { id: 'repo-payments-api', name: 'payments-api', path: '/workspace/payments-api', branch: 'codex/cache-pass', headSha: 'b8b4f4d79f21', createdAt };
  store.saveRepository(repo);
  const runs = [
    ['checkout-refactor', 'checkout-refactor', 'codex', 'gpt-5', 'running', '2026-09-09T14:45:00.000Z', null, { input: 126432, output: 14832, cached: 34136, reasoning: 4200, cost: 1.92, costSource: 'demo' }, 0.92],
    ['user-onboarding', 'user-onboarding', 'claude', 'sonnet-4', 'running', '2026-09-09T15:59:00.000Z', null, { input: 28410, output: 4820, cached: 17300, reasoning: null, cost: 0.37, costSource: 'demo' }, 0.89],
    ['fix-webhook-retry', 'fix-webhook-retry', 'codex', 'gpt-5-mini', 'running', '2026-09-09T16:10:00.000Z', null, { input: 18200, output: 3100, cached: 12100, reasoning: 810, cost: 0.21, costSource: 'demo' }, 0.95],
    ['repeated-file-reads', 'repeated-file-reads', 'codex', 'gpt-5', 'failed', '2026-09-09T13:48:00.000Z', '2026-09-09T14:25:00.000Z', { input: 118300, output: 11900, cached: 22100, reasoning: 3900, cost: 1.76, costSource: 'demo' }, 0.63],
    ['update-readme', 'update-readme', 'codex', 'gpt-5-mini', 'completed', '2026-09-09T12:58:00.000Z', '2026-09-09T13:03:00.000Z', { input: 8900, output: 1400, cached: 6100, reasoning: 220, cost: 0.12, costSource: 'demo' }, 0.98],
    ['bump-dependencies', 'bump-dependencies', 'claude', 'sonnet-4', 'completed', '2026-09-09T12:30:00.000Z', '2026-09-09T12:48:00.000Z', { input: 21600, output: 3920, cached: null, reasoning: null, cost: 0.28, costSource: 'demo' }, 0.87],
  ].map(([id, name, provider, model, status, startedAt, endedAt, usage, score]) => ({
    id, name, repositoryId: repo.id, repositoryName: repo.name, repositoryPath: repo.path,
    provider, model, status, prompt: 'Run integration tests, diagnose the checkout regression and implement the smallest safe fix.',
    response: status === 'completed' ? 'Implemented the fix and verified the integration suite.' : null,
    startedAt, endedAt, updatedAt: endedAt || '2026-09-09T16:27:00.000Z', usage,
    contextSnapshot: { version: 1, strategy: id === 'checkout-refactor' ? 'raw-repo' : 'knowledge-base', capturedAt: startedAt, repository: { ...repo }, prompt: 'Run integration tests, diagnose the checkout regression and implement the smallest safe fix.', items: [], reproducible: true },
    evaluation: { evaluatorId: 'manual', score, source: 'demo', notes: 'Seeded demonstration result.' },
    permissions: { readFiles: true, modifyFiles: true, runCommands: true }, demo: true,
  }));
  for (const run of runs) store.saveRun(run);

  const rows = [
    ['agent.started', 'Session started', null, 0, 0],
    ['agent.input', 'Run integration tests and diagnose checkout regression', null, 2100, 0.03],
    ['agent.thinking', 'Planning integration test execution', null, 320, 0.004],
    ['agent.file_read', 'Reading tests/checkout.test.ts', 'tests/checkout.test.ts', 2100, 0.032],
    ['agent.file_read', 'Reading src/payments/validator.ts', 'src/payments/validator.ts', 3400, 0.051],
    ['agent.file_read', 'Reading package-lock.json (repeated)', 'package-lock.json', 6800, 0.102],
    ['agent.thinking', 'Analyzing dependencies for the tests', null, 1200, 0.018],
    ['agent.file_read', 'Reading src/payments/processor.ts', 'src/payments/processor.ts', 4100, 0.062],
    ['agent.file_read', 'Reading package-lock.json (repeated)', 'package-lock.json', 6800, 0.101],
    ['agent.file_read', 'Reading package-lock.json (repeated)', 'package-lock.json', 6900, 0.103],
    ['agent.command_started', 'npm run test:integration', null, 512, 0.008],
    ['agent.command_completed', 'Tests started (312 tests)', null, 0, 0],
    ['agent.command_completed', 'Tests in progress (38/312)', null, 0, 0],
    ['agent.thinking', 'Reviewing failures and stack traces', null, 2100, 0.031],
    ['agent.file_read', 'Reading tests/utils/test-helpers.ts', 'tests/utils/test-helpers.ts', 3800, 0.057],
    ['agent.thinking', 'Proposing validation fix', null, 1400, 0.022],
  ];
  rows.forEach((row, index) => store.insertEvent({ runId: 'checkout-refactor', timestamp: new Date(Date.parse('2026-09-09T15:52:10.000Z') + index * 31_000).toISOString(), type: row[0], provider: 'codex', data: { text: row[1], path: row[2], tokensDelta: row[3], costDelta: row[4], source: 'demo', repeated: row[2] === 'package-lock.json' } }));

  const experiment = {
    id: 'exp-cache-strategies', name: 'Checkout context strategy', task: 'Diagnose and fix checkout total rounding.', repositoryId: repo.id,
    evaluatorId: 'manual', status: 'draft', createdAt, updatedAt: createdAt, metadata: { demo: true },
    variants: [
      { id: 'variant-raw', label: 'Raw repository', provider: 'codex', model: 'gpt-5', promptTemplate: '{{task}}', contextStrategy: 'raw-repo', contextSnapshot: { strategy: 'raw-repo', repository: { ...repo }, items: [] }, status: 'draft' },
      { id: 'variant-kb', label: 'Knowledge Base', provider: 'codex', model: 'gpt-5-mini', promptTemplate: '{{context}}\n\n{{task}}', contextStrategy: 'knowledge-base', contextSnapshot: { strategy: 'knowledge-base', repository: { ...repo }, items: [{ type: 'knowledge-base', name: 'checkout-architecture', content: 'Checkout totals are rounded only at the payment boundary.', sha256: 'demo' }] }, status: 'draft' },
      { id: 'variant-wiki', label: 'LLM Wiki', provider: 'claude', model: 'sonnet-4', promptTemplate: '{{context}}\n\n{{task}}', contextStrategy: 'llm-wiki', contextSnapshot: { strategy: 'llm-wiki', repository: { ...repo }, items: [{ type: 'llm-wiki', name: 'payments-domain', content: 'Validator owns currency precision rules.', sha256: 'demo' }] }, status: 'draft' },
    ],
  };
  store.saveExperiment(experiment);
}

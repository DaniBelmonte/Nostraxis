import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/persistence/database.mjs';
import { buildAnalytics, compareRuns } from '../server/metrics/analytics.mjs';
import { materializeContext } from '../server/experiments/context.mjs';
import { EventBus } from '../server/core/event-bus.mjs';
import { createRepositoryService } from '../server/repositories/service.mjs';
import { createRunManager } from '../server/runtime/run-manager.mjs';
import { createExternalSessionService } from '../server/sources/external-session-service.mjs';
import { collectCopilotOtel, parseCopilotUsageText } from '../server/sources/copilot-otel.mjs';

test('repository registration rejects missing and invalid paths with safe messages', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nostraxis-repositories-'));
  process.env.NOSTRAXIS_SEED = '0';
  const store = openDatabase(path.join(dir, 'data'));
  const repositories = createRepositoryService(store);
  await assert.rejects(() => repositories.add(''), /Enter the absolute repository path/);
  await assert.rejects(() => repositories.add('relative/repo'), /must be absolute/);
  await assert.rejects(() => repositories.add(path.join(dir, 'missing')), /does not exist or cannot be read/);
  store.close();
  await rm(dir, { recursive: true });
});

test('external Codex sessions are discovered, normalized and associated with a registered repository', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nostraxis-external-'));
  const repositoryPath = path.join(dir, 'product-api');
  const sourceRoot = path.join(dir, 'codex-sessions');
  await mkdir(repositoryPath);
  await mkdir(sourceRoot);
  const timestamp = new Date().toISOString();
  const log = [
    { type: 'session_meta', payload: { id: 'team-session-1', cwd: repositoryPath, timestamp } },
    { type: 'turn_context', timestamp, payload: { cwd: repositoryPath, model: 'gpt-test' } },
    { type: 'event_msg', timestamp, payload: { type: 'user_message', message: 'Review the real payment repository.' } },
    { type: 'response_item', timestamp, payload: { type: 'function_call', name: 'read_file', arguments: JSON.stringify({ path: 'src/payment.js' }) } },
    { type: 'event_msg', timestamp, payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 120, output_tokens: 30, cached_input_tokens: 80 } } } },
    { type: 'event_msg', timestamp, payload: { type: 'agent_message', message: 'Payment repository reviewed.' } },
    { type: 'event_msg', timestamp, payload: { type: 'task_complete', completed_at: timestamp } },
  ].map((item) => JSON.stringify(item)).join('\n') + '\n';
  await writeFile(path.join(sourceRoot, 'session.jsonl'), log);

  process.env.NOSTRAXIS_SEED = '0';
  const store = openDatabase(path.join(dir, 'data'));
  const repositories = createRepositoryService(store);
  const repository = await repositories.add(repositoryPath);
  const service = createExternalSessionService({
    store,
    bus: new EventBus(),
    repositories,
    roots: [{ provider: 'codex', root: sourceRoot }],
    observerOptions: { maxFiles: 10, maxAgeMs: 86_400_000 },
  });
  const result = await service.sync();
  const run = store.listRuns().find((item) => item.origin === 'external');
  assert.equal(result.imported, 1);
  assert.equal(run.repositoryId, repository.id);
  assert.equal(run.nativeSessionId, 'team-session-1');
  assert.equal(run.model, 'gpt-test');
  assert.equal(run.response, 'Payment repository reviewed.');
  assert.deepEqual(run.usage, { input: 120, output: 30, cached: 80, reasoning: null, cost: null, source: 'provider-log', costSource: null });
  assert.ok(store.eventsFor(run.id).some((event) => event.type === 'agent.file_read' && event.data.path === 'src/payment.js'));
  await service.close();
  store.close();
  await rm(dir, { recursive: true });
});

test('Copilot live checkpoints and final usage expose output tokens and premium credits', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nostraxis-copilot-'));
  const repositoryPath = path.join(dir, 'copilot-product');
  const sourceRoot = path.join(dir, 'copilot-sessions');
  const sessionRoot = path.join(sourceRoot, 'session-1');
  await mkdir(repositoryPath);
  await mkdir(sessionRoot, { recursive: true });
  const timestamp = new Date().toISOString();
  const events = [
    { type: 'session.start', timestamp, data: { sessionId: 'copilot-session-1', context: { cwd: repositoryPath }, selectedModel: 'gpt-copilot', startTime: timestamp } },
    { type: 'user.message', timestamp, data: { content: 'Inspect the live Copilot session.' } },
    { type: 'assistant.turn_start', timestamp, data: {} },
    { type: 'assistant.message', timestamp, data: { messageId: 'message-1', model: 'gpt-copilot', content: 'Working on it.', outputTokens: 40 } },
    { type: 'session.usage_checkpoint', timestamp, data: { totalPremiumRequests: 2 } },
    { type: 'subagent.completed', id: 'subagent-event-1', timestamp, data: { agentDisplayName: 'Repository scanner', totalTokens: 1250 } },
  ];
  const filename = path.join(sessionRoot, 'events.jsonl');
  await writeFile(filename, events.map(JSON.stringify).join('\n'));

  process.env.NOSTRAXIS_SEED = '0';
  const store = openDatabase(path.join(dir, 'data'));
  const repositories = createRepositoryService(store);
  await repositories.add(repositoryPath);
  const service = createExternalSessionService({
    store,
    bus: new EventBus(),
    repositories,
    roots: [{ provider: 'copilot', root: sourceRoot }],
    observerOptions: { maxFiles: 10, maxAgeMs: 86_400_000 },
  });
  await service.sync();
  let run = store.listRuns().find((item) => item.provider === 'copilot');
  assert.equal(run.status, 'running');
  assert.equal(run.usageScope, 'observed');
  assert.deepEqual(run.usage, {
    input: null, output: 40, cached: null, reasoning: null, cost: null,
    credits: 2, creditUnit: 'premium requests', creditCoverage: 'session', source: 'provider-log-live', costSource: null,
    observedTokens: 1250, observedTokenScope: 'subagents',
  });

  events.push({
    type: 'session.shutdown', timestamp, data: {
      currentModel: 'gpt-copilot', totalPremiumRequests: 2,
      tokenDetails: { input: { tokenCount: 100 }, cache_read: { tokenCount: 60 }, cache_write: { tokenCount: 10 }, output: { tokenCount: 40 } },
      modelMetrics: { 'gpt-copilot': { usage: { reasoningTokens: 8 } } },
    },
  });
  await writeFile(filename, events.map(JSON.stringify).join('\n'));
  await service.sync();
  run = store.listRuns().find((item) => item.provider === 'copilot');
  assert.equal(run.status, 'completed');
  assert.equal(run.usageScope, 'session');
  assert.deepEqual(run.usage, {
    input: 170, output: 40, cached: 60, reasoning: 8, cost: null,
    credits: 2, creditUnit: 'premium requests', creditCoverage: 'session', source: 'provider-log', costSource: null,
    observedTokens: 1250, observedTokenScope: 'subagents',
  });
  assert.ok(store.eventsFor(run.id).some((event) => event.type === 'agent.usage' && event.data.usage?.credits === 2));
  await service.close();
  store.close();
  await rm(dir, { recursive: true });
});

test('Copilot OpenTelemetry uses invoke_agent spans once and separates subagent tokens', () => {
  const attribute = (key, value) => ({ key, value: typeof value === 'number' ? { intValue: String(value) } : { stringValue: value } });
  const span = (id, parentSpanId, values) => ({
    name: values.operation,
    traceId: 'trace-1', spanId: id, parentSpanId,
    startTimeUnixNano: '1780000000000000000', endTimeUnixNano: '1780000001000000000',
    attributes: Object.entries(values).map(([key, value]) => attribute(key === 'operation' ? 'gen_ai.operation.name' : key, value)),
  });
  const records = [{ resourceSpans: [{ scopeSpans: [{ spans: [
    span('root', null, {
      operation: 'invoke_agent', 'gen_ai.conversation.id': 'copilot-otel-1',
      'gen_ai.request.model': 'gpt-copilot', 'server.address': 'api.githubcopilot.com',
      'gen_ai.usage.input_tokens': 1000, 'gen_ai.usage.output_tokens': 100,
      'gen_ai.usage.cache_read.input_tokens': 400, 'github.copilot.nano_aiu': 2500000000,
    }),
    span('subagent', 'root', {
      operation: 'invoke_agent', 'gen_ai.conversation.id': 'copilot-otel-1',
      'gen_ai.agent.name': 'explore', 'gen_ai.usage.input_tokens': 300,
      'gen_ai.usage.output_tokens': 50, 'gen_ai.usage.cache_read.input_tokens': 100,
    }),
    span('chat', 'root', {
      operation: 'chat', 'gen_ai.conversation.id': 'copilot-otel-1',
      'gen_ai.usage.input_tokens': 9999, 'gen_ai.usage.output_tokens': 9999,
      'github.copilot.nano_aiu': 2500000000,
    }),
  ] }] }] }];
  const [summary] = collectCopilotOtel(records);
  assert.equal(summary.conversationId, 'copilot-otel-1');
  assert.equal(summary.model, 'gpt-copilot');
  assert.deepEqual(summary.usage, {
    input: 1300, output: 150, cached: 500, cacheWrite: null, reasoning: null,
    cost: null, credits: 2.5, creditUnit: 'AI credits', creditCoverage: 'main-agent-only',
    observedTokens: 350, observedTokenScope: 'subagents', source: 'opentelemetry', costSource: null,
  });
});

test('Copilot slash-command fallback accepts only labelled usage and context values', () => {
  assert.deepEqual(parseCopilotUsageText([
    'Session usage', 'AI Credits used: 14.10', 'Input tokens: 49,000',
    'Output tokens: 461', 'Cached tokens: 12,000', 'Total tokens: 49,461',
  ].join('\n')), {
    input: 49000, output: 461, total: 49461, cached: 12000, reasoning: null, cost: null,
    credits: 14.1, creditUnit: 'AI credits', contextTokens: null, contextWindowTokens: null,
    source: '/usage', costSource: null,
  });
  assert.deepEqual(parseCopilotUsageText('Context window usage: 42,000 / 200,000 tokens', '/context'), {
    input: null, output: null, total: null, cached: null, reasoning: null, cost: null,
    credits: null, creditUnit: null, contextTokens: 42000, contextWindowTokens: 200000,
    source: '/context', costSource: null,
  });
  assert.equal(parseCopilotUsageText('Quota remaining: 73%'), null);
});

test('external Copilot OpenTelemetry files are discovered by conversation ID', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nostraxis-external-copilot-otel-'));
  const otelFile = path.join(dir, 'copilot-otel.jsonl');
  const timestamp = new Date().toISOString();
  await writeFile(otelFile, `${JSON.stringify({
    name: 'invoke_agent', traceId: 'external-trace', spanId: 'external-root',
    startTime: timestamp, endTime: timestamp,
    attributes: {
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.conversation.id': 'external-copilot-otel-session',
      'gen_ai.request.model': 'copilot-model',
      'gen_ai.usage.input_tokens': 900,
      'gen_ai.usage.output_tokens': 90,
      'github.copilot.nano_aiu': 500000000,
      'server.address': 'api.githubcopilot.com',
    },
  })}\n`);
  const store = openDatabase(path.join(dir, 'data'));
  const repositories = createRepositoryService(store);
  const service = createExternalSessionService({
    store, bus: new EventBus(), repositories,
    roots: [{ provider: 'copilot', root: otelFile, format: 'copilot-otel' }],
    observerOptions: { maxFiles: 10, maxAgeMs: 86_400_000 },
  });
  try {
    const result = await service.sync();
    const run = store.listRuns().find((item) => item.nativeSessionId === 'external-copilot-otel-session');
    assert.equal(result.imported, 1);
    assert.equal(run.provider, 'copilot');
    assert.equal(run.model, 'copilot-model');
    assert.equal(run.usageScope, 'session');
    assert.equal(run.usage.source, 'opentelemetry');
    assert.equal(run.usage.input + run.usage.output, 990);
    assert.equal(run.usage.credits, 0.5);
  } finally {
    await service.close();
    store.close();
    await rm(dir, { recursive: true });
  }
});

test('SQLite store is standalone and persists exact context snapshots', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nostraxis-'));
  process.env.NOSTRAXIS_SEED = '0';
  const store = openDatabase(dir);
  const repository = { id: 'repo-1', name: 'demo', path: dir, branch: 'main', headSha: 'abc123', createdAt: new Date().toISOString() };
  store.saveRepository(repository);
  const snapshot = materializeContext({ strategy: 'knowledge-base', task: 'Fix the bug', repository, contextItems: [{ name: 'contract', content: 'Return HTTP 409 on conflict.' }] });
  const run = { id: 'run-1', name: 'demo', repositoryId: repository.id, repositoryName: repository.name, repositoryPath: repository.path, provider: 'custom', model: '', status: 'completed', prompt: 'Fix the bug', response: 'Done', startedAt: '2026-09-09T10:00:00.000Z', endedAt: '2026-09-09T10:00:02.000Z', updatedAt: '2026-09-09T10:00:02.000Z', usage: null, contextSnapshot: snapshot, evaluation: null, permissions: { readFiles: true }, demo: false };
  store.saveRun(run);
  assert.deepEqual(store.getRun('run-1').contextSnapshot, snapshot);
  store.close();
  await rm(dir, { recursive: true });
});

test('unknown provider metrics remain unavailable instead of becoming zero', () => {
  const run = { id: 'unknown', name: 'unknown', repositoryName: 'repo', provider: 'custom', model: '', status: 'completed', startedAt: '2026-09-09T10:00:00.000Z', endedAt: '2026-09-09T10:00:01.000Z', usage: null, evaluation: null, contextSnapshot: {} };
  const analytics = buildAnalytics([run]);
  assert.equal(analytics.summary.totalTokens, null);
  assert.equal(analytics.summary.totalCostUsd, null);
  assert.deepEqual(
    compareRuns([run])[0].unavailable.sort(),
    ['tokens', 'cachedTokens', 'cacheHit', 'cost', 'providerCredits', 'evaluation'].sort(),
  );
});

test('invalid provider configuration becomes a failed run instead of staying queued', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nostraxis-runtime-'));
  process.env.NOSTRAXIS_SEED = '0';
  const store = openDatabase(path.join(dir, 'data'));
  const repositories = createRepositoryService(store);
  const repository = await repositories.add(dir);
  const manager = createRunManager({ store, bus: new EventBus(), repositories });
  const created = await manager.create({
    repositoryId: repository.id,
    provider: 'custom',
    prompt: 'test',
    executable: '',
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const saved = store.getRun(created.id);
  assert.equal(saved.status, 'failed');
  assert.ok(saved.endedAt);
  assert.equal(store.eventsFor(created.id).at(-1).type, 'agent.error');
  manager.terminate();
  store.close();
  await rm(dir, { recursive: true });
});

test('custom JSONL provider persists a complete observable run', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nostraxis-custom-'));
  process.env.NOSTRAXIS_SEED = '0';
  const store = openDatabase(path.join(dir, 'data'));
  const repositories = createRepositoryService(store);
  const repository = await repositories.add(dir);
  const manager = createRunManager({ store, bus: new EventBus(), repositories });
  const fixture = path.resolve('tests/fixtures/custom-provider.mjs');
  const created = await manager.create({
    repositoryId: repository.id,
    provider: 'custom',
    prompt: 'Find an optimization.',
    executable: process.execPath,
    args: [fixture],
  });
  let run;
  for (let attempt = 0; attempt < 40; attempt++) {
    run = store.getRun(created.id);
    if (run.status === 'completed') break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const detail = manager.detail(created.id);
  assert.equal(run.status, 'completed');
  assert.equal(run.response, 'Optimization complete.');
  assert.deepEqual(run.usage, { input: 120, output: 30, cached: 80, reasoning: null, cost: null, source: 'tokens', provider: 'custom', costSource: null });
  assert.equal(detail.files[0].path, 'src/example.js');
  assert.equal(detail.tools[0].name, 'npm test');
  assert.ok(detail.events.some((event) => event.type === 'agent.thinking'));
  manager.terminate();
  store.close();
  await rm(dir, { recursive: true });
});

test('managed Copilot runs enable and ingest isolated OpenTelemetry output', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nostraxis-managed-copilot-'));
  process.env.NOSTRAXIS_SEED = '0';
  const previousBinary = process.env.NOSTRAXIS_COPILOT_BIN;
  process.env.NOSTRAXIS_COPILOT_BIN = path.resolve('tests/fixtures/copilot-provider.mjs');
  const store = openDatabase(path.join(dir, 'data'));
  const repositories = createRepositoryService(store);
  const repository = await repositories.add(dir);
  const manager = createRunManager({ store, bus: new EventBus(), repositories });
  try {
    const created = await manager.create({
      repositoryId: repository.id,
      provider: 'copilot',
      prompt: 'Verify Copilot telemetry.',
    });
    let run;
    for (let attempt = 0; attempt < 80; attempt++) {
      run = store.getRun(created.id);
      if (run.status === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(run.status, 'completed');
    assert.equal(run.nativeSessionId, 'managed-copilot-otel-session');
    assert.equal(run.model, 'gpt-copilot-test');
    assert.deepEqual(run.usage, {
      input: 700, output: 80, cached: 200, cacheWrite: null, reasoning: null,
      cost: null, credits: 1.25, creditUnit: 'AI credits', creditCoverage: 'session',
      observedTokens: null, observedTokenScope: null, source: 'opentelemetry', costSource: null,
    });
    assert.ok(store.eventsFor(run.id).some((event) => event.type === 'agent.usage'
      && event.data.text.includes('OpenTelemetry')));
  } finally {
    manager.terminate();
    store.close();
    if (previousBinary == null) delete process.env.NOSTRAXIS_COPILOT_BIN;
    else process.env.NOSTRAXIS_COPILOT_BIN = previousBinary;
    await rm(dir, { recursive: true });
  }
});

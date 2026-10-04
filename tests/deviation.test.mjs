import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { consumeObservedEvent, newObservedSession, observedSnapshot } from '../server/sources/session-observer.mjs';
import { collectCopilotOtel } from '../server/sources/copilot-otel.mjs';
import { comparisonProfile } from '../server/metrics/comparison.mjs';
import { deviationAnalysis, median } from '../server/metrics/deviation.mjs';
import { buildRunJsonl } from '../server/exports/run-jsonl.mjs';
import { parseRunJsonl } from '../server/exports/run-import.mjs';
import { createExternalSessionService } from '../server/sources/external-session-service.mjs';
import { openDatabase } from '../server/persistence/database.mjs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const at = (seconds) => new Date(Date.parse('2026-10-01T09:00:00.000Z') + seconds * 1000).toISOString();

test('Copilot shutdown keeps usage per model and per agent, and both credit units apart', () => {
  const session = newObservedSession('copilot', 'events.jsonl', Date.parse(at(0)));
  consumeObservedEvent(session, { type: 'session.start', timestamp: at(0), data: { sessionId: 'copilot-1', selectedModel: 'model-a', contextTier: 'standard', context: { cwd: '/work/app' } } });
  consumeObservedEvent(session, { type: 'session.auto_mode_resolved', timestamp: at(1), data: { chosenModel: 'model-b', candidateModels: ['model-a', 'model-b'], routingMethod: 'classifier', fallback: false } });
  consumeObservedEvent(session, { type: 'session.model_change', timestamp: at(2), data: { previousModel: 'model-a', newModel: 'model-b', reasoningEffort: 'high', source: 'user' } });
  consumeObservedEvent(session, { type: 'tool.execution_complete', timestamp: at(3), data: { toolCallId: 't1', success: false } });
  consumeObservedEvent(session, { type: 'tool.execution_complete', timestamp: at(4), data: { toolCallId: 't2', success: true } });
  consumeObservedEvent(session, { type: 'session.compaction_complete', timestamp: at(5), data: { trigger: 'auto', preCompactionTokens: 90000, tokensRemoved: 60000, compactionTokensUsed: { inputTokens: 1000, outputTokens: 200, copilotUsage: { totalNanoAiu: 500_000_000 } } } });
  consumeObservedEvent(session, { type: 'session.shutdown', timestamp: at(6), data: {
    tokenDetails: { input: { tokenCount: 300 }, output: { tokenCount: 900 }, cache_read: { tokenCount: 9000 }, cache_write: { tokenCount: 700 } },
    totalNanoAiu: 3_000_000_000, totalPremiumRequests: 2, totalApiDurationMs: 40000,
    systemTokens: 4000, toolDefinitionsTokens: 12000, conversationTokens: 20000, currentTokens: 36000,
    codeChanges: { linesAdded: 10, linesRemoved: 4, filesModified: ['a.js', 'b.js'] },
    modelMetrics: {
      'model-a': { requests: { count: 3, cost: 1 }, usage: { inputTokens: 4000, outputTokens: 300, cacheReadTokens: 3800, cacheWriteTokens: 100, reasoningTokens: 50 }, totalNanoAiu: 1_000_000_000 },
      'model-b': { requests: { count: 7, cost: 1 }, usage: { inputTokens: 6000, outputTokens: 600, cacheReadTokens: 5200, cacheWriteTokens: 600, reasoningTokens: 0 }, totalNanoAiu: 2_000_000_000 },
    },
    agentMetrics: {
      main: { agentName: 'main', totalApiDurationMs: 30000, totalNanoAiu: 2_500_000_000, modelMetrics: { 'model-b': { requests: { count: 6 }, usage: { inputTokens: 5000, outputTokens: 500 } } } },
      explore: { agentDisplayName: 'Explore', totalApiDurationMs: 10000, totalNanoAiu: 500_000_000, modelMetrics: { 'model-a': { requests: { count: 4 }, usage: { inputTokens: 5000, outputTokens: 400 } } } },
    },
  } });
  const details = observedSnapshot(session).providerDetails;
  assert.equal(details.provider, 'copilot');
  assert.equal(details.requests, 10);
  const [first, second] = details.models;
  assert.equal(first.model, 'model-b');
  assert.equal(first.credits, 2);
  assert.equal(first.requests, 7);
  assert.equal(first.premiumRequests, 1);
  assert.equal(second.cacheWrite, 100);
  assert.equal(details.premiumRequests, 2);
  assert.deepEqual(details.agents.map((agent) => [agent.name, agent.credits, agent.source]), [['Main agent', 2.5, 'main-agent'], ['Explore', 0.5, 'agent-metrics']]);
  assert.equal(details.failedTools, 1);
  assert.equal(details.toolResults, 2);
  assert.equal(details.compactionCost.credits, 0.5);
  assert.equal(details.contextBreakdown.toolDefinitions, 12000);
  assert.deepEqual(details.codeChanges, { linesAdded: 10, linesRemoved: 4, files: 2 });
  assert.equal(details.routing[0].chosen, 'model-b');
  assert.equal(details.modelChanges[0].to, 'model-b');
  assert.equal(details.contextTier, 'standard');
  assert.equal(session.usage.credits, 3);
});

test('Claude keeps cache writes, models, stop reasons, cache misses and tool errors', () => {
  const session = newObservedSession('claude', '/home/x/.claude/projects/p/claude-1.jsonl', Date.parse(at(0)));
  const assistant = (id, seconds, usage, extra = {}) => ({ type: 'assistant', sessionId: 'claude-1', timestamp: at(seconds), effort: 'high', ...extra, message: { id, model: extra.model || 'claude-a', stop_reason: extra.stop || 'tool_use', content: [], usage, diagnostics: extra.diagnostics } });
  consumeObservedEvent(session, { type: 'user', sessionId: 'claude-1', timestamp: at(0), message: { content: 'Fix it.' } });
  consumeObservedEvent(session, assistant('m1', 1, { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 5000, cache_creation: { ephemeral_5m_input_tokens: 5000 }, output_tokens: 100, server_tool_use: { web_search_requests: 2 } }, { diagnostics: { cache_miss_reason: { type: 'system_changed', cache_missed_input_tokens: 5000 } } }));
  consumeObservedEvent(session, { type: 'user', sessionId: 'claude-1', timestamp: at(2), toolUseResult: {}, message: { content: [{ type: 'tool_result', tool_use_id: 'u1', is_error: true }, { type: 'tool_result', tool_use_id: 'u2' }] } });
  consumeObservedEvent(session, assistant('m2', 3, { input_tokens: 20, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0, output_tokens: 3000 }, { model: 'claude-b', stop: 'max_tokens' }));
  consumeObservedEvent(session, { type: 'permission-mode', sessionId: 'claude-1', permissionMode: 'acceptEdits' });
  consumeObservedEvent(session, { type: 'cost-state', sessionId: 'claude-1', totalCostUSD: 0.42, totalAPIDuration: 9000, totalAPIDurationWithoutRetries: 6000, modelUsage: { 'claude-b': { costUSD: 0.3 } } });
  const details = observedSnapshot(session).providerDetails;
  assert.equal(session.usage.cacheWrite, 5000);
  assert.equal(details.requests, 2);
  assert.deepEqual(details.models.map((model) => [model.model, model.requests]).sort(), [['claude-a', 1], ['claude-b', 1]]);
  assert.equal(details.models.find((model) => model.model === 'claude-b').costUsd, 0.3);
  assert.deepEqual(details.stopReasons, { tool_use: 1, max_tokens: 1 });
  assert.deepEqual(details.cacheMisses, { system_changed: { count: 1, tokens: 5000 } });
  assert.equal(details.failedTools, 1);
  assert.equal(details.webSearches, 2);
  assert.equal(details.cacheWrite5m, 5000);
  assert.equal(details.permissionMode, 'acceptEdits');
  assert.equal(details.apiDurationWithoutRetriesMs, 6000);
  assert.equal(session.events.find((event) => event.data.modelSettings)?.data.modelSettings.effort, 'high');
});

test('a Claude subagent log joins its parent run as an agent instead of replacing it', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nostraxis-subagent-'));
  const root = path.join(dir, 'projects');
  await mkdir(path.join(root, 'p', 'parent-1', 'subagents'), { recursive: true });
  const lines = (records) => `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  await writeFile(path.join(root, 'p', 'parent-1.jsonl'), lines([
    { type: 'user', sessionId: 'parent-1', cwd: '/work/app', timestamp: at(0), message: { content: 'Plan the refactor.' } },
    { type: 'assistant', sessionId: 'parent-1', timestamp: at(1), message: { id: 'p1', model: 'claude-a', content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50 } } },
  ]));
  await writeFile(path.join(root, 'p', 'parent-1', 'subagents', 'agent-ax.jsonl'), lines([
    { type: 'user', sessionId: 'parent-1', agentId: 'ax', isSidechain: true, timestamp: at(2), message: { content: 'Explore the code.' } },
    { type: 'assistant', sessionId: 'parent-1', agentId: 'ax', isSidechain: true, timestamp: at(3), message: { id: 's1', model: 'claude-small', content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/work/app/a.js' } }], usage: { input_tokens: 4000, output_tokens: 200 } } },
  ]));
  const store = openDatabase(path.join(dir, 'data'));
  const service = createExternalSessionService({ store, bus: { publish() {} }, repositories: { match: async () => null }, roots: [{ provider: 'claude', root }] });
  try {
    await service.sync();
    await service.sync();
    const runs = store.listRuns();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].prompt, 'Plan the refactor.');
    assert.equal(runs[0].usage.input, 100);
    const agent = runs[0].providerDetails.agents.find((item) => item.id === 'ax');
    assert.equal(agent.input, 4000);
    assert.equal(agent.source, 'subagent-log');
    assert.ok(store.eventsFor(runs[0].id).some((event) => event.data.path === '/work/app/a.js'));
  } finally {
    await service.close();
    store.close();
    await rm(dir, { recursive: true });
  }
});

test('a Codex subagent thread joins its parent run with its own lane', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nostraxis-codex-subagent-'));
  const root = path.join(dir, 'sessions');
  await mkdir(root, { recursive: true });
  const lines = (records) => `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  await writeFile(path.join(root, 'rollout-parent.jsonl'), lines([
    { type: 'session_meta', timestamp: at(0), payload: { id: 'parent-thread', cwd: '/work/app', timestamp: at(0) } },
    { type: 'event_msg', timestamp: at(1), payload: { type: 'user_message', message: 'Audit the repo.' } },
    { type: 'event_msg', timestamp: at(9), payload: { type: 'task_complete' } },
  ]));
  await writeFile(path.join(root, 'rollout-child.jsonl'), lines([
    { type: 'session_meta', timestamp: at(2), payload: { id: 'child-thread', cwd: '/work/app', timestamp: at(2), parent_thread_id: 'parent-thread', agent_nickname: 'Explorer', source: { subagent: { thread_spawn: {} } } } },
    { type: 'event_msg', timestamp: at(2), payload: { type: 'user_message', message: 'Map the modules.' } },
    { type: 'response_item', timestamp: at(3), payload: { type: 'function_call', call_id: 'f1', name: 'exec_command', arguments: '{"cmd":"ls"}' } },
    { type: 'response_item', timestamp: at(5), payload: { type: 'function_call_output', call_id: 'f1', output: 'ok' } },
  ]));
  const store = openDatabase(path.join(dir, 'data'));
  const service = createExternalSessionService({ store, bus: { publish() {} }, repositories: { match: async () => null }, roots: [{ provider: 'codex', root }] });
  try {
    await service.sync();
    await service.sync();
    const runs = store.listRuns();
    assert.deepEqual(runs.map((run) => run.prompt), ['Audit the repo.']);
    const agent = runs[0].providerDetails.agents.find((item) => item.source === 'subagent-log');
    assert.equal(agent.name, 'Explorer');
    assert.ok(store.eventsFor(runs[0].id).some((event) => event.data.agent === 'child-thread' && event.type === 'agent.tool_completed'));
  } finally {
    await service.close();
    store.close();
    await rm(dir, { recursive: true });
  }
});

test('Codex reports requests per model, rate-limit consumption, policies and failures', () => {
  const session = newObservedSession('codex', 'rollout.jsonl', Date.parse(at(0)));
  consumeObservedEvent(session, { type: 'session_meta', timestamp: at(0), payload: { id: 'codex-1', cwd: '/work/app' } });
  consumeObservedEvent(session, { type: 'turn_context', timestamp: at(1), payload: { model: 'codex-a', effort: 'medium', approval_policy: 'on-request', sandbox_policy: { type: 'workspace-write' } } });
  const tokens = (seconds, total, last, used) => consumeObservedEvent(session, { type: 'event_msg', timestamp: at(seconds), payload: { type: 'token_count',
    info: { total_token_usage: { input_tokens: total, cached_input_tokens: total / 2, output_tokens: 10, total_tokens: total + 10 }, last_token_usage: { input_tokens: last, cached_input_tokens: last / 2, output_tokens: 5, total_tokens: last + 5 } },
    rate_limits: { primary: { used_percent: used, window_minutes: 300, resets_at: 999 }, plan_type: 'pro' } } });
  tokens(2, 1000, 1000, 10);
  tokens(3, 1000, 1000, 10);
  tokens(4, 3000, 2000, 14);
  consumeObservedEvent(session, { type: 'event_msg', timestamp: at(5), payload: { type: 'item_completed', item: { id: 'c1', type: 'CommandExecution', status: 'failed', exit_code: 1 } } });
  consumeObservedEvent(session, { type: 'event_msg', timestamp: at(6), payload: { type: 'item_completed', item: { id: 'm1', type: 'McpToolCall', server: 'docs', status: 'completed', result: { isError: true } } } });
  consumeObservedEvent(session, { type: 'event_msg', timestamp: at(7), payload: { type: 'task_complete', duration_ms: 7000, time_to_first_token_ms: 800 } });
  consumeObservedEvent(session, { type: 'event_msg', timestamp: at(8), payload: { type: 'turn_aborted', reason: 'interrupted' } });
  const details = observedSnapshot(session).providerDetails;
  assert.equal(details.requests, 2);
  assert.equal(details.models[0].model, 'codex-a');
  assert.equal(details.models[0].input, 3000);
  assert.deepEqual(details.rateLimits, [{ window: 'primary', windowMinutes: 300, startPercent: 10, endPercent: 14, reset: false, consumedPercent: 4 }]);
  assert.deepEqual(details.policies, { approval: 'on-request', sandbox: 'workspace-write', collaborationMode: null });
  assert.equal(details.failedCommands, 1);
  assert.equal(details.failedTools, 1);
  assert.deepEqual(details.mcpServers, { docs: 1 });
  assert.equal(details.turnTimings.medianFirstTokenMs, 800);
  assert.deepEqual(details.abortReasons, { interrupted: 1 });
  assert.equal(details.plan, 'pro');
});

test('OpenTelemetry spans are summed per model and per agent', () => {
  const span = (id, parent, model, agent, input, output, nano) => ({ traceId: 't', spanId: id, parentSpanId: parent, name: 'invoke_agent', startTimeUnixNano: 1e18, endTimeUnixNano: 1e18 + 2e9,
    attributes: { 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.conversation.id': 'conv', 'gen_ai.response.model': model, 'gen_ai.agent.name': agent, 'gen_ai.usage.input_tokens': input, 'gen_ai.usage.output_tokens': output, ...(nano ? { 'github.copilot.nano_aiu': nano, 'server.address': 'api' } : {}) } });
  const [summary] = collectCopilotOtel([{ resourceSpans: [{ scopeSpans: [{ spans: [span('a', null, 'model-a', 'main', 100, 10, 2e9), span('b', 'a', 'model-b', 'explore', 400, 40)] }] }] }]);
  const details = summary.providerDetails;
  assert.deepEqual(details.models.map((model) => [model.model, model.input, model.credits]), [['model-a', 100, 2], ['model-b', 400, null]]);
  assert.equal(details.agents[0].name, 'explore');
});

const profile = (key, { tokens, requests, cached = 0, credits = null, models = [], effort = 'high', model = 'm', provider = 'codex' }) => comparisonProfile({
  run: {
    id: key, name: key, provider, model, status: 'completed', startedAt: at(0), endedAt: at(60), prompt: 'Same task',
    usage: { input: tokens - 100, output: 100, cached, ...(credits != null ? { credits, creditUnit: 'AI credits' } : {}) },
    providerDetails: { provider, models, agents: [], requests },
  },
  events: [
    { id: 1, timestamp: at(0), type: 'agent.input', data: { text: 'Same task', userAction: true } },
    { id: 2, timestamp: at(1), type: 'agent.status_changed', data: { modelSettings: { effort } } },
    { id: 3, timestamp: at(9), type: 'agent.completed', data: {} },
  ],
});

test('deviations are measured against the group median and never mix credit units', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([5, 1]), 3);
  const rows = [
    profile('a', { tokens: 3000, requests: 10, credits: 500 }),
    profile('b', { tokens: 3200, requests: 11, credits: 520 }),
    profile('c', { tokens: 30000, requests: 60, credits: 3000, effort: 'max' }),
  ];
  rows.push(comparisonProfile({ run: { id: 'd', name: 'd', provider: 'copilot', model: 'm', status: 'completed', startedAt: at(0), usage: { input: 900, output: 100, credits: 4, creditUnit: 'premium requests' }, providerDetails: { requests: 4 } }, events: [] }));
  const analysis = deviationAnalysis(rows);
  const tokens = analysis.metrics.find((metric) => metric.id === 'tokens');
  assert.equal(tokens.values.find((value) => value.key === 'c').median, 3100);
  const credits = analysis.metrics.find((metric) => metric.id === 'credits');
  const premium = credits.values.find((value) => value.key === 'd');
  assert.equal(premium.median, null);
  assert.equal(premium.deviation, null);
  assert.equal(credits.values.find((value) => value.key === 'c').median, 520);
  assert.equal(analysis.outlier, 'c');
  const missing = deviationAnalysis([profile('x', { tokens: 1000, requests: null }), profile('y', { tokens: 2000, requests: null })]);
  assert.equal(missing.metrics.find((metric) => metric.id === 'requests'), undefined);
});

test('a 1.1 export keeps provider details and a 1.0 export still imports', () => {
  const run = { id: 'r', name: 'R', provider: 'copilot', model: 'm', status: 'completed', startedAt: at(0), usage: { input: 10, output: 5 }, providerDetails: { provider: 'copilot', models: [{ model: 'm', credits: 1 }], agents: [], requests: 2 } };
  const current = parseRunJsonl(buildRunJsonl({ run, events: [] }));
  assert.equal(current.schemaVersion, '1.1');
  assert.equal(current.run.providerDetails.requests, 2);
  const legacy = parseRunJsonl(`${JSON.stringify({ recordType: 'nostraxis.run-export', schemaVersion: '1.0', run: { ...run, providerDetails: undefined } })}\n`);
  assert.equal(legacy.run.providerDetails, null);
});

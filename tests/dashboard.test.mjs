import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
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
import { buildVscodeCopilotSnapshot, defaultVscodeChatRoots, replayVscodeChat } from '../server/sources/vscode-copilot-chat.mjs';
import { consumeObservedEvent, newObservedSession } from '../server/sources/session-observer.mjs';
import { normalizeEvents, runDurationMs, timingFromEvents, totalSpanMs } from '../server/core/timing.mjs';


const at = (base, offsetMs) => new Date(Date.parse(base) + offsetMs).toISOString();

test('a session is timed by its working intervals, not by the span of the conversation', () => {
  const base = '2026-09-16T10:47:38.000Z';
  const events = [
    { type: 'agent.observed', timestamp: base, data: { text: 'External session detected in copilot' } },
    { type: 'agent.input', timestamp: base, data: { text: 'Build the inventory', userAction: true } },
  ];
  // Copilot closes every assistant message with a turn_end, so a session is a
  // long chain of thinking/output/completed triples with no idle in between.
  for (let minute = 1; minute <= 76; minute += 1) {
    events.push({ type: 'agent.thinking', timestamp: at(base, minute * 60_000 - 30_000), data: { text: 'Preparing response' } });
    events.push({ type: 'agent.output', timestamp: at(base, minute * 60_000 - 1_000), data: { text: 'Agent response' } });
    events.push({ type: 'agent.completed', timestamp: at(base, minute * 60_000), data: { text: 'Turn completed' } });
  }
  // Copilot writes its shutdown records when the terminal is finally closed,
  // more than a day after the work ended.
  events.push({ type: 'agent.usage', timestamp: at(base, 33 * 3_600_000), data: { text: 'Final Copilot usage reported' } });
  events.push({ type: 'agent.completed', timestamp: at(base, 33 * 3_600_000), data: { text: 'Session completed' } });

  const timing = timingFromEvents(events);
  assert.equal(timing.turnCount, 1);
  assert.equal(timing.activeMs, 76 * 60_000);
  assert.equal(timing.lastTurnMs, 76 * 60_000);
  assert.equal(timing.totalMs, 33 * 3_600_000);
});

test('subagent prompts do not open a turn and do not stop the clock', () => {
  const base = '2026-09-16T10:47:38.000Z';
  const events = [
    { type: 'agent.input', timestamp: base, data: { text: 'Analyse the scene', userAction: true } },
    { type: 'agent.output', timestamp: at(base, 60_000), data: { text: 'Launching the analysts' } },
    { type: 'agent.tool_started', timestamp: at(base, 60_100), data: { text: 'task', tool: 'task' } },
    { type: 'agent.input', timestamp: at(base, 60_200), data: { text: 'Run your FUNCTIONALITY analysis', userAction: false } },
    { type: 'agent.input', timestamp: at(base, 60_300), data: { text: 'Run your LIFECYCLE analysis', userAction: false } },
    { type: 'agent.output', timestamp: at(base, 180_000), data: { text: 'Both analysts finished' } },
  ];

  const timing = timingFromEvents(events);
  assert.equal(timing.turnCount, 1);
  assert.equal(timing.activeMs, 180_000);
});

test('the time before a user action belongs to the user, whatever its length', () => {
  const base = '2026-09-19T09:54:06.000Z';
  const events = [
    { type: 'agent.input', timestamp: base, data: { text: 'Fix the duration', userAction: true } },
    { type: 'agent.output', timestamp: at(base, 600_000), data: { text: 'Working on it' } },
    { type: 'agent.completed', timestamp: at(base, 1_141_000), data: { text: 'Turn completed' } },
    // The user reads the answer for eighteen minutes before acting again.
    { type: 'agent.input', timestamp: at(base, 2_249_000), data: { text: 'npm run dev', userAction: true } },
    { type: 'agent.output', timestamp: at(base, 2_253_000), data: { text: 'Port already in use' } },
  ];

  const timing = timingFromEvents(events);
  assert.equal(timing.turnCount, 2);
  assert.equal(timing.activeMs, 1_141_000 + 4_000);
  assert.equal(timing.lastTurnMs, 4_000);
  assert.equal(timing.totalMs, 2_253_000);
});

test('providers report a user action differently and each adapter marks it', () => {
  const codex = newObservedSession('codex', '/tmp/codex.jsonl', Date.parse('2026-09-18T08:00:00.000Z'));
  consumeObservedEvent(codex, { type: 'event_msg', timestamp: '2026-09-18T08:00:00.000Z', payload: { type: 'user_message', message: 'Review the repository.' } });
  consumeObservedEvent(codex, { type: 'response_item', timestamp: '2026-09-18T08:00:01.000Z', payload: { type: 'message', role: 'user', content: 'Review the repository.' } });
  consumeObservedEvent(codex, { type: 'response_item', timestamp: '2026-09-18T08:05:00.000Z', payload: { type: 'message', role: 'user', content: 'And now the tests.' } });

  const claude = newObservedSession('claude', '/tmp/claude.jsonl', Date.parse('2026-09-18T08:00:00.000Z'));
  consumeObservedEvent(claude, { type: 'user', sessionId: 'claude-1', timestamp: '2026-09-18T08:00:00.000Z', message: { content: 'Fix the bug.' } });
  consumeObservedEvent(claude, { type: 'user', sessionId: 'claude-1', isSidechain: true, timestamp: '2026-09-18T08:00:05.000Z', message: { content: 'Explore the repository.' } });

  const copilot = newObservedSession('copilot', '/tmp/copilot.jsonl', Date.parse('2026-09-18T08:00:00.000Z'));
  consumeObservedEvent(copilot, { type: 'user.message', timestamp: '2026-09-18T08:00:00.000Z', data: { content: 'Build the inventory.' } });
  consumeObservedEvent(copilot, { type: 'user.message', agentId: 'agent-1', timestamp: '2026-09-18T08:00:05.000Z', data: { content: 'Run your analysis.' } });

  const inputs = (session) => session.events.filter((event) => event.type === 'agent.input').map((event) => event.data.userAction);
  // The Codex response item repeating a reported message is the transcript
  // copy; a message it never reported as an event is a real user action.
  assert.deepEqual(inputs(codex), [true, false, true]);
  assert.deepEqual(inputs(claude), [true, false]);
  assert.deepEqual(inputs(copilot), [true, false]);
});

test('provider instants are normalised, ordered and deduplicated before they are measured', () => {
  const events = [
    { type: 'agent.completed', timestamp: 1789646460, data: { text: 'Turn completed' } },
    { type: 'agent.input', timestamp: '2026-09-17T12:00:00.000Z', data: { text: 'Do the thing', userAction: true } },
    { type: 'agent.thinking', timestamp: '1789646400.0', data: { text: 'Preparing response' } },
    { type: 'agent.thinking', timestamp: 1789646400000, data: { text: 'Preparing response', source: 're-read' } },
    { type: 'agent.log', timestamp: 'not-a-date', data: { text: 'Unreadable instant' } },
  ];
  const normalized = normalizeEvents(events);

  // The epoch-second copy of the thinking event is the same observation as its
  // ISO twin, so only one of them survives.
  assert.deepEqual(normalized.map((event) => event.type), ['agent.input', 'agent.thinking', 'agent.log', 'agent.completed']);
  // An unreadable instant keeps its place in the stream and stays unknown
  // instead of borrowing the time of its neighbours.
  assert.deepEqual(normalized.map((event) => event.timestamp), [
    '2026-09-17T12:00:00.000Z', '2026-09-17T12:00:00.000Z', null, '2026-09-17T12:01:00.000Z',
  ]);
  assert.equal(timingFromEvents(events).activeMs, 60_000);
});

test('a session with nothing measurable reports no duration instead of zero', () => {
  const observed = { origin: 'external', status: 'completed', startedAt: '2026-09-18T08:00:00.000Z', updatedAt: '2026-09-19T08:00:00.000Z' };
  assert.equal(runDurationMs(observed), null);
  assert.equal(totalSpanMs(observed), 24 * 60 * 60 * 1000);
  assert.equal(runDurationMs({ ...observed, activeDurationMs: 4_000 }), 4_000);
  assert.equal(timingFromEvents([{ type: 'agent.input', timestamp: '2026-09-18T08:00:00.000Z' }]).activeMs, null);
  assert.equal(timingFromEvents([]).activeMs, null);
  assert.equal(timingFromEvents([]).totalMs, null);
});

test('legacy epoch instants and duplicated events are repaired when the database opens', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nostraxis-timestamps-'));
  process.env.NOSTRAXIS_SEED = '0';
  const dataDir = path.join(dir, 'data');
  const store = openDatabase(dataDir);
  store.saveRun({
    id: 'legacy-run', name: 'Legacy', repositoryPath: dir, provider: 'codex', status: 'completed',
    prompt: 'Review', startedAt: '2026-09-17T12:00:00.000Z', endedAt: '2026-09-17T12:01:00.000Z',
    updatedAt: '2026-09-17T12:01:00.000Z', contextSnapshot: {}, permissions: {}, origin: 'external',
  });
  store.insertEvent({ runId: 'legacy-run', timestamp: '2026-09-17T12:00:00.000Z', type: 'agent.input', provider: 'codex', data: { text: 'Review' } });
  const legacy = store.insertEvent({ runId: 'legacy-run', timestamp: '2026-09-17T12:01:00.000Z', type: 'agent.completed', provider: 'codex', data: { text: 'Turn completed' } });
  // Rows written before instants were normalised: an epoch-second string sorts
  // before every ISO timestamp and renders as an unknown time.
  store.db.prepare('UPDATE events SET timestamp=? WHERE id=?').run('1789646460.0', legacy.id);
  store.db.prepare("UPDATE runs SET ended_at='1789646460.0', updated_at='1789646460.0' WHERE id='legacy-run'");
  store.db.prepare("INSERT INTO events(run_id,timestamp,type,provider,data) VALUES ('legacy-run','1789646460.0','agent.completed','codex',?)")
    .run(JSON.stringify({ text: 'Turn completed' }));
  store.db.prepare("DELETE FROM settings WHERE key='timing.migration'").run();
  store.close();

  const reopened = openDatabase(dataDir);
  const events = reopened.eventsFor('legacy-run');
  const run = reopened.getRun('legacy-run');
  assert.deepEqual(events.map((event) => event.type), ['agent.input', 'agent.completed']);
  assert.deepEqual(events.map((event) => event.timestamp), ['2026-09-17T12:00:00.000Z', '2026-09-17T12:01:00.000Z']);
  assert.equal(run.endedAt, '2026-09-17T12:01:00.000Z');
  // The stored run is re-measured from its own repaired events.
  assert.equal(run.activeDurationMs, 60_000);
  assert.equal(totalSpanMs(run), 60_000);
  reopened.close();
  rmSync(dir, { recursive: true });
});

test('an observed session resumed later reports active time, last turn and full span apart', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nostraxis-resumed-'));
  const repositoryPath = path.join(dir, 'resumed-api');
  const sourceRoot = path.join(dir, 'codex-sessions');
  await mkdir(repositoryPath);
  await mkdir(sourceRoot);
  const base = '2026-09-18T08:00:00.000Z';
  const epoch = (offsetMs) => (Date.parse(base) + offsetMs) / 1000;
  const log = [
    { type: 'session_meta', payload: { id: 'resumed-session', cwd: repositoryPath, timestamp: epoch(0) } },
    { type: 'turn_context', timestamp: at(base, 0), payload: { cwd: repositoryPath, model: 'gpt-test' } },
    { type: 'event_msg', timestamp: at(base, 0), payload: { type: 'user_message', message: 'First question.' } },
    { type: 'event_msg', timestamp: at(base, 0), payload: { type: 'task_started', started_at: epoch(0) } },
    { type: 'response_item', timestamp: at(base, 60_000), payload: { type: 'function_call', name: 'read_file', arguments: JSON.stringify({ path: 'src/app.js' }) } },
    { type: 'event_msg', timestamp: at(base, 120_000), payload: { type: 'agent_message', message: 'First answer.' } },
    { type: 'event_msg', timestamp: at(base, 180_000), payload: { type: 'task_complete', completed_at: epoch(180_000) } },
    // Six hours of silence: the conversation is resumed, it does not continue.
    { type: 'event_msg', timestamp: at(base, 6 * 3_600_000), payload: { type: 'user_message', message: 'Second question.' } },
    { type: 'event_msg', timestamp: at(base, 6 * 3_600_000), payload: { type: 'task_started', started_at: epoch(6 * 3_600_000) } },
    { type: 'event_msg', timestamp: at(base, 6 * 3_600_000 + 30_000), payload: { type: 'agent_message', message: 'Second answer.' } },
    { type: 'event_msg', timestamp: at(base, 6 * 3_600_000 + 60_000), payload: { type: 'task_complete', completed_at: epoch(6 * 3_600_000 + 60_000) } },
  ].map((item) => JSON.stringify(item)).join('\n') + '\n';
  await writeFile(path.join(sourceRoot, 'session.jsonl'), log);

  process.env.NOSTRAXIS_SEED = '0';
  const store = openDatabase(path.join(dir, 'data'));
  const repositories = createRepositoryService(store);
  await repositories.add(repositoryPath);
  const service = createExternalSessionService({
    store,
    bus: new EventBus(),
    repositories,
    roots: [{ provider: 'codex', root: sourceRoot }],
    observerOptions: { maxFiles: 10, maxAgeMs: 86_400_000 },
  });
  await service.sync();
  // A second pass over the same log must not duplicate events or double the time.
  await service.sync();
  const run = store.listRuns().find((item) => item.origin === 'external');
  const events = store.eventsFor(run.id);

  assert.equal(run.activeDurationMs, 240_000);
  assert.equal(run.lastTurnDurationMs, 60_000);
  assert.equal(runDurationMs(run), 240_000);
  assert.equal(totalSpanMs(run), 6 * 3_600_000 + 60_000);
  assert.equal(timingFromEvents(events).turnCount, 2);
  assert.equal(events.length, new Set(events.map((event) => `${event.timestamp}|${event.type}|${JSON.stringify(event.data)}`)).size);
  // Every row of the full run carries a readable instant.
  assert.ok(events.every((event) => Number.isFinite(Date.parse(event.timestamp))));
  await service.close();
  store.close();
  await rm(dir, { recursive: true });
});

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

test('VS Code Copilot Chat journals are reconstructed and imported with local workspace usage', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nostraxis-vscode-copilot-'));
  const repositoryPath = path.join(dir, 'vscode-product');
  const workspaceRoot = path.join(dir, 'workspaceStorage', 'workspace-hash');
  const chatRoot = path.join(workspaceRoot, 'chatSessions');
  const timestamp = Date.now() - 5_000;
  await mkdir(repositoryPath);
  await mkdir(chatRoot, { recursive: true });
  await writeFile(path.join(workspaceRoot, 'workspace.json'), JSON.stringify({ folder: new URL(`file://${repositoryPath}`).href }));
  const request = {
    requestId: 'request-1', timestamp,
    agent: { extensionId: { value: 'GitHub.copilot-chat' }, id: 'github.copilot.editsAgent' },
    modelId: 'copilot/claude-test', message: { text: 'Review this VS Code workspace.', parts: [] }, response: [],
  };
  const records = [
    { kind: 0, v: { version: 3, sessionId: 'vscode-chat-1', creationDate: timestamp, responderUsername: '', pendingRequests: [], requests: [] } },
    { kind: 1, k: ['responderUsername'], v: 'GitHub Copilot' },
    { kind: 2, k: ['requests'], v: [request] },
    { kind: 1, k: ['requests', 0, 'promptTokens'], v: 600 },
    { kind: 1, k: ['requests', 0, 'completionTokens'], v: 90 },
    { kind: 1, k: ['requests', 0, 'copilotCredits'], v: 1.25 },
    { kind: 2, k: ['requests', 0, 'response'], v: [
      { kind: 'thinking', value: 'Hidden reasoning must not be imported.' },
      { value: 'Visible VS Code Copilot response.' },
    ] },
  ];
  const filename = path.join(chatRoot, 'vscode-chat-1.jsonl');
  await writeFile(filename, records.map(JSON.stringify).join('\n'));

  const replayed = replayVscodeChat(records);
  assert.equal(replayed.requests[0].promptTokens, 600);
  assert.equal(replayed.requests[0].response.length, 2);
  const pendingDocument = { ...replayed, pendingRequests: [{ requestId: 'request-1' }] };
  const recentPending = await buildVscodeCopilotSnapshot(pendingDocument, filename, new Date(timestamp + 60_000).toISOString());
  const stalePending = await buildVscodeCopilotSnapshot(pendingDocument, filename, new Date(timestamp + 10 * 60_000).toISOString());
  assert.equal(recentPending.snapshot.status, 'running');
  assert.equal(recentPending.snapshot.endedAt, null);
  assert.equal(stalePending.snapshot.status, 'completed');
  assert.equal(stalePending.snapshot.endedAt, new Date(timestamp).toISOString());
  assert.deepEqual(defaultVscodeChatRoots({ platform: 'darwin', home: '/Users/test', env: {} }), [
    '/Users/test/Library/Application Support/Code/User/workspaceStorage',
    '/Users/test/Library/Application Support/Code - Insiders/User/workspaceStorage',
  ]);

  process.env.NOSTRAXIS_SEED = '0';
  const store = openDatabase(path.join(dir, 'data'));
  const repositories = createRepositoryService(store);
  const repository = await repositories.add(repositoryPath);
  const service = createExternalSessionService({
    store, bus: new EventBus(), repositories,
    roots: [{ provider: 'copilot', root: path.join(dir, 'workspaceStorage'), format: 'vscode-chat', label: 'VS Code Copilot Chat' }],
    observerOptions: { maxFiles: 10, maxAgeMs: 86_400_000 },
  });
  try {
    const result = await service.sync();
    const run = store.listRuns().find((item) => item.nativeSessionId === 'vscode-chat-1');
    assert.equal(result.imported, 1);
    assert.equal(run.repositoryId, repository.id);
    assert.equal(run.repositoryPath, repositoryPath);
    assert.equal(run.model, 'copilot/claude-test');
    assert.equal(run.prompt, 'Review this VS Code workspace.');
    assert.equal(run.response, 'Visible VS Code Copilot response.');
    assert.equal(run.response.includes('Hidden reasoning'), false);
    assert.deepEqual(run.usage, {
      input: 600, output: 90, cached: null, reasoning: null, cost: null,
      credits: 1.25, creditUnit: 'AI credits', creditCoverage: 'session',
      source: 'vscode-chat', costSource: null,
    });
    assert.equal(run.contextSnapshot.source, 'vscode-copilot-chat');
    assert.equal(result.sources[0].count, 1);
  } finally {
    await service.close();
    store.close();
    await rm(dir, { recursive: true });
  }
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

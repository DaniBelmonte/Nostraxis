import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { comparisonProfile, isMemoryPath, toolCategory } from '../server/metrics/comparison.mjs';
import { buildRunJsonl } from '../server/exports/run-jsonl.mjs';
import { parseRunJsonl } from '../server/exports/run-import.mjs';
import { consumeObservedEvent, newObservedSession } from '../server/sources/session-observer.mjs';
import { createApi } from '../server/api.mjs';

const at = (seconds) => new Date(Date.parse('2026-09-30T10:00:00.000Z') + seconds * 1000).toISOString();
const event = (id, seconds, type, data = {}) => ({ id, timestamp: at(seconds), type, provider: 'codex', data });

const syntheticRun = {
  id: 'run-a', name: 'Synthetic run', provider: 'codex', model: 'gpt-test', status: 'completed',
  repositoryName: 'demo', repositoryPath: '/work/demo', prompt: 'Fix the parser.', response: 'Fixed.',
  startedAt: at(0), endedAt: at(60), usage: { input: 1200, output: 300, cached: 600, cost: 0.02, costSource: 'provider', contextTokens: 900, contextWindowTokens: 4000 },
  contextSnapshot: { strategy: 'provider-session-log', items: [], reproducible: false, unavailable: ['system-prompt'] },
};
const syntheticEvents = [
  event(1, 0, 'agent.input', { text: 'Fix the parser.', userAction: true }),
  event(2, 1, 'agent.status_changed', { text: 'Model settings · effort high', modelSettings: { effort: 'high' } }),
  event(3, 1, 'agent.status_changed', { text: 'Instructions loaded', memory: { path: '/work/demo/AGENTS.md', injected: true } }),
  event(4, 5, 'agent.file_read', { tool: 'Read', path: '/work/demo/src/parser.js' }),
  event(5, 8, 'agent.file_read', { tool: 'Read', path: '/work/demo/src/parser.js' }),
  event(6, 9, 'agent.file_read', { tool: 'Read', path: '/work/demo/CLAUDE.md' }),
  event(7, 10, 'agent.command_started', { tool: 'Bash', command: 'npm test' }),
  event(8, 15, 'agent.command_completed', { tool: 'Bash', command: 'npm test', exitCode: 1 }),
  event(9, 16, 'agent.usage', { usage: { input: 800, output: 100, contextTokens: 700, contextWindowTokens: 4000 } }),
  event(10, 20, 'agent.file_modified', { tool: 'Edit', path: '/work/demo/src/parser.js' }),
  event(11, 22, 'agent.tool_called', { tool: 'mcp__browser__navigate' }),
  event(12, 25, 'agent.status_changed', { text: 'Context compacted (auto)', compaction: { trigger: 'auto', preTokens: 3500 } }),
  event(13, 30, 'agent.usage', { usage: { input: 1200, output: 300, contextTokens: 900, contextWindowTokens: 4000 } }),
  event(14, 31, 'agent.completed', { text: 'Turn completed' }),
];

test('tool families and memory files are recognised by normalised names', () => {
  assert.equal(toolCategory('Read', 'agent.file_read'), 'read');
  assert.equal(toolCategory('Grep', 'agent.file_read'), 'search');
  assert.equal(toolCategory('apply_patch', 'agent.file_modified'), 'edit');
  assert.equal(toolCategory('Bash', 'agent.command_started'), 'shell');
  assert.equal(toolCategory('mcp__server__search'), 'mcp');
  assert.equal(toolCategory('copilot_memory'), 'memory');
  assert.equal(toolCategory('Agent'), 'subagent');
  assert.equal(toolCategory('TodoWrite'), 'planning');
  assert.equal(toolCategory('WebFetch'), 'web');
  assert.equal(toolCategory('mystery'), 'other');
  assert.ok(isMemoryPath('/repo/CLAUDE.md'));
  assert.ok(isMemoryPath('C:\\repo\\AGENTS.md'));
  assert.ok(isMemoryPath('/home/me/.claude/projects/x/memory/notes.md'));
  assert.ok(!isMemoryPath('/repo/README.md'));
});

test('a comparison profile reports tools, files, memory, effort and context from events', () => {
  const profile = comparisonProfile({ run: syntheticRun, events: syntheticEvents });
  assert.equal(profile.key, 'run-a');
  assert.deepEqual(profile.conditions.effort, ['high']);
  assert.equal(profile.conditions.declaredEffort, null);
  assert.equal(profile.context.peakTokens, 900);
  assert.equal(profile.context.windowTokens, 4000);
  assert.equal(profile.context.peakUtilization, 900 / 4000);
  assert.deepEqual(profile.context.compactions.map((item) => item.preTokens), [3500]);
  assert.deepEqual(profile.memory.map((item) => [item.path, item.injected, item.reads]), [['/work/demo/AGENTS.md', true, 0], ['/work/demo/CLAUDE.md', false, 1]]);
  assert.equal(profile.activity.toolCalls, 6);
  assert.equal(profile.activity.repeatedReads, 1);
  assert.equal(profile.activity.failedCommands, 1);
  assert.equal(profile.activity.userActions, 1);
  assert.equal(profile.toolCategories.read, 3);
  assert.equal(profile.toolCategories.shell, 1);
  assert.equal(profile.toolCategories.mcp, 1);
  assert.deepEqual(profile.toolBreakdown.find((tool) => tool.name === 'Bash'), { name: 'Bash', category: 'shell', count: 1, failures: 1 });
  assert.equal(profile.series.at(-1).tokens, 1500);
  assert.equal(profile.series.at(-1).context, 900);
  assert.ok(profile.series.every((point, index, list) => index === 0 || point.t >= list[index - 1].t));
  assert.equal(profile.efficiency.tokensPerToolCall, 1500 / 6);
});

test('a missing measurement stays null in the profile', () => {
  const profile = comparisonProfile({ run: { ...syntheticRun, usage: null }, events: [event(1, 0, 'agent.input', { text: 'Hi' })] });
  assert.equal(profile.metrics.totalTokens, null);
  assert.equal(profile.context.peakTokens, null);
  assert.equal(profile.context.peakUtilization, null);
  assert.equal(profile.conditions.effort, null);
  assert.equal(profile.efficiency.tokensPerTurn, null);
});

test('an exported run imports back with its events and without the exporter prices', () => {
  const content = buildRunJsonl({
    run: { ...syntheticRun, usage: { input: 1200, output: 300, cost: 4.5, costSource: 'configured-estimate' } },
    events: syntheticEvents.map((item) => item.type === 'agent.usage' ? { ...item, data: { ...item.data, usage: { ...item.data.usage, cost: 1, costSource: 'configured-estimate' } } } : item),
  }, { exportedAt: '2026-09-30T11:00:00.000Z' });
  const imported = parseRunJsonl(content, { sourceName: 'remote.jsonl', importedAt: '2026-09-30T12:00:00.000Z' });
  assert.equal(imported.events.length, syntheticEvents.length);
  assert.equal(imported.run.name, 'Synthetic run');
  assert.equal(imported.run.usage.cost, null);
  assert.equal(imported.events.find((item) => item.type === 'agent.usage').data.usage.cost, null);
  assert.equal(imported.exportedAt, '2026-09-30T11:00:00.000Z');
  assert.equal(parseRunJsonl(content).id, imported.id);
  assert.throws(() => parseRunJsonl('{"recordType":"something-else"}\n'), /Not a Nostraxis run export/);
  assert.throws(() => parseRunJsonl('{"recordType":"nostraxis.run-export","schemaVersion":"9.0","run":{"provider":"x"}}\n'), /Unsupported export schema/);
  assert.throws(() => parseRunJsonl('not json'), /not valid JSON/);
});

test('observed logs report effort, context occupancy, compaction, thinking and injected instructions', () => {
  const codex = newObservedSession('codex', 'codex.jsonl', Date.parse(at(0)));
  consumeObservedEvent(codex, { type: 'session_meta', timestamp: at(0), payload: { id: 'codex-1', cwd: '/work/demo' } });
  consumeObservedEvent(codex, { type: 'response_item', timestamp: at(1), payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions for /work/demo\n\n<INSTRUCTIONS>rules</INSTRUCTIONS>' }] } });
  consumeObservedEvent(codex, { type: 'turn_context', timestamp: at(2), payload: { model: 'gpt-test', effort: 'high', summary: 'auto' } });
  consumeObservedEvent(codex, { type: 'turn_context', timestamp: at(3), payload: { model: 'gpt-test', effort: 'high', summary: 'auto' } });
  consumeObservedEvent(codex, { type: 'event_msg', timestamp: at(4), payload: { type: 'token_count', info: {
    total_token_usage: { input_tokens: 5000, cached_input_tokens: 1000, output_tokens: 400 },
    last_token_usage: { input_tokens: 3000, output_tokens: 200, total_tokens: 3200 }, model_context_window: 200000,
  } } });
  consumeObservedEvent(codex, { type: 'compacted', timestamp: at(5), payload: { message: 'summary' } });
  consumeObservedEvent(codex, { type: 'event_msg', timestamp: at(6), payload: { type: 'context_compacted' } });
  assert.equal(codex.events.filter((item) => item.data.modelSettings).length, 1);
  assert.deepEqual(codex.events.find((item) => item.data.modelSettings).data.modelSettings, { effort: 'high', reasoningSummary: 'auto' });
  assert.equal(codex.usage.contextTokens, 3200);
  assert.equal(codex.usage.contextWindowTokens, 200000);
  assert.equal(codex.events.filter((item) => item.data.compaction).length, 1);
  assert.equal(codex.events.find((item) => item.data.memory).data.memory.path, '/work/demo/AGENTS.md');

  const claude = newObservedSession('claude', 'claude.jsonl', Date.parse(at(0)));
  consumeObservedEvent(claude, { type: 'user', sessionId: 'claude-1', timestamp: at(0), message: { content: '<command-name>/effort</command-name>\n<command-message>effort</command-message>\n<command-args>max</command-args>' } });
  consumeObservedEvent(claude, { type: 'assistant', sessionId: 'claude-1', timestamp: at(2), message: { id: 'm1', model: 'claude-test', content: [{ type: 'thinking', thinking: 'secret' }, { type: 'text', text: 'Done' }], usage: { input_tokens: 10, cache_read_input_tokens: 900, cache_creation_input_tokens: 90, output_tokens: 50 } } });
  consumeObservedEvent(claude, { type: 'assistant', sessionId: 'claude-1', isSidechain: true, timestamp: at(3), message: { id: 'm2', model: 'claude-test', content: [], usage: { input_tokens: 5000, output_tokens: 10 } } });
  consumeObservedEvent(claude, { type: 'system', subtype: 'compact_boundary', timestamp: at(4), compactMetadata: { trigger: 'manual', preTokens: 1050 } });
  assert.equal(claude.events.find((item) => item.data.modelSettings).data.modelSettings.effort, 'max');
  assert.equal(claude.usage.contextTokens, 1050);
  const thinking = claude.events.filter((item) => item.type === 'agent.thinking' && item.data.text !== 'Preparing response');
  assert.equal(thinking.length, 1);
  assert.ok(!JSON.stringify(thinking).includes('secret'));
  assert.deepEqual(claude.events.find((item) => item.data.compaction).data.compaction, { trigger: 'manual', preTokens: 1050 });
});

const request = ({ method = 'GET', url, body = null }) => Object.assign(Readable.from(body == null ? [] : [Buffer.from(body)]), {
  method, url, headers: { host: 'localhost:4173', 'content-type': 'application/json' },
});
async function call(api, options) {
  const result = { status: 200, body: '' };
  await api.handle(request(options), {
    setHeader() {}, writeHead(status) { result.status = status; }, write(chunk) { result.body += chunk; },
    end(chunk) { if (chunk) result.body += chunk; }, on() {},
  });
  return { status: result.status, json: result.body ? JSON.parse(result.body) : null };
}

test('imported runs are compared beside local runs and never join local sessions', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nostraxis-compare-'));
  process.env.NOSTRAXIS_SEED = '0';
  process.env.NOSTRAXIS_SESSION_ROOTS_JSON = '[]';
  const api = createApi({ dataDir: path.join(dir, 'data') });
  try {
    const content = buildRunJsonl({ run: syntheticRun, events: syntheticEvents });
    const created = await call(api, { method: 'POST', url: '/api/imports', body: JSON.stringify({ name: 'remote.jsonl', content }) });
    assert.equal(created.status, 201);
    assert.match(created.json.id, /^import:/);
    assert.equal(created.json.imported, true);
    assert.equal(created.json.toolCount, 6);

    const listed = await call(api, { url: '/api/imports' });
    assert.deepEqual(listed.json.map((item) => item.id), [created.json.id]);
    const runs = await call(api, { url: '/api/runs' });
    assert.equal(runs.json.length, 0);

    const compared = await call(api, { url: `/api/compare?ids=${encodeURIComponent(created.json.id)}` });
    assert.equal(compared.json.runs[0].source, 'imported');
    assert.equal(compared.json.runs[0].importInfo.sourceName, 'remote.jsonl');
    assert.deepEqual(compared.json.runs[0].conditions.effort, ['high']);

    const invalid = await call(api, { method: 'PUT', url: `/api/compare/annotations/${encodeURIComponent(created.json.id)}`, body: JSON.stringify({ effort: 'extreme' }) });
    assert.equal(invalid.status, 400);
    const declared = await call(api, { method: 'PUT', url: `/api/compare/annotations/${encodeURIComponent(created.json.id)}`, body: JSON.stringify({ effort: 'medium', note: 'MCP browser enabled' }) });
    assert.deepEqual(declared.json.annotation, { effort: 'medium', note: 'MCP browser enabled' });
    const annotated = await call(api, { url: `/api/compare?ids=${encodeURIComponent(created.json.id)}` });
    assert.equal(annotated.json.runs[0].conditions.declaredEffort, 'medium');

    const rejected = await call(api, { method: 'POST', url: '/api/imports', body: JSON.stringify({ name: 'x.jsonl', content: '{"hello":1}' }) });
    assert.equal(rejected.status, 400);

    const removed = await call(api, { method: 'DELETE', url: `/api/imports/${created.json.importId}` });
    assert.equal(removed.status, 200);
    assert.deepEqual((await call(api, { url: '/api/imports' })).json, []);
  } finally {
    await api.close();
    await rm(dir, { recursive: true });
  }
});

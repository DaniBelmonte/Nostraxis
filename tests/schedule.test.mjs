import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSchedule } from '../server/metrics/schedule.mjs';
import { consumeObservedEvent, newObservedSession } from '../server/sources/session-observer.mjs';
import { normalizeEvents } from '../server/core/timing.mjs';

const at = (seconds) => new Date(Date.parse('2026-10-01T12:00:00.000Z') + seconds * 1000).toISOString();
const event = (seconds, type, data = {}) => ({ timestamp: at(seconds), type, data });

test('calls are paired by id, overlapping calls count as parallel and the model fills the rest', () => {
  const schedule = buildSchedule(normalizeEvents([
    event(0, 'agent.input', { text: 'Go', userAction: true }),
    event(10, 'agent.file_read', { tool: 'Read', path: 'a.js', callId: 'r1' }),
    event(10, 'agent.file_read', { tool: 'Read', path: 'b.js', callId: 'r2' }),
    event(14, 'agent.tool_completed', { tool: 'Read', callId: 'r2', status: 'completed' }),
    event(16, 'agent.tool_completed', { tool: 'Read', callId: 'r1', status: 'completed' }),
    event(20, 'agent.command_started', { tool: 'Bash', command: 'npm test', callId: 'c1' }),
    event(30, 'agent.tool_completed', { tool: 'Bash', callId: 'c1', status: 'failed' }),
    event(40, 'agent.output', { text: 'Done' }),
  ]));
  const read = schedule.spans.filter((span) => span.lane === 'read');
  assert.deepEqual(read.map((span) => [span.label, span.end - span.start]), [['a.js', 6000], ['b.js', 4000]]);
  assert.equal(schedule.spans.find((span) => span.lane === 'shell').status, 'failed');
  assert.equal(schedule.summary.maxConcurrency, 2);
  assert.equal(schedule.summary.parallelMs, 4000);
  assert.equal(schedule.summary.estimatedCalls, 0);
  assert.equal(schedule.summary.toolMs, 16000);
  assert.equal(schedule.summary.modelMs, 40000 - 16000);
  assert.equal(schedule.activeMs, 40000);
  assert.deepEqual(schedule.markers.map((marker) => marker.kind), ['input', 'output']);
  assert.equal(schedule.lanes.find((lane) => lane.id === 'shell').failed, 1);
});

test('calls without a reported end are estimates, sequenced, and never parallel', () => {
  const schedule = buildSchedule(normalizeEvents([
    event(0, 'agent.input', { text: 'Go', userAction: true }),
    event(5, 'agent.file_read', { tool: 'view', path: 'a.js' }),
    event(5, 'agent.file_read', { tool: 'view', path: 'b.js' }),
    event(15, 'agent.output', { text: 'Done' }),
  ]));
  const read = schedule.spans.filter((span) => span.lane === 'read');
  assert.ok(read.every((span) => span.estimated));
  assert.deepEqual(read.map((span) => [span.start, span.end]), [[5000, 10000], [10000, 15000]]);
  assert.equal(schedule.summary.maxConcurrency, null);
  assert.equal(schedule.summary.parallelShare, null);
});

test('a start stored before call ids existed is paired with the latest open call of its tool', () => {
  const schedule = buildSchedule(normalizeEvents([
    event(0, 'agent.input', { text: 'Go', userAction: true }),
    event(1, 'agent.command_started', { tool: 'Bash', command: 'stale' }),
    event(2, 'agent.command_started', { tool: 'Bash', command: 'ls' }),
    event(9, 'agent.tool_completed', { tool: 'Bash', callId: 'x', status: 'completed' }),
  ]));
  const [stale, shell] = schedule.spans.filter((span) => span.lane === 'shell');
  assert.equal(shell.estimated, false);
  assert.equal(shell.end - shell.start, 7000);
  assert.equal(stale.estimated, true);
  assert.equal(schedule.summary.maxConcurrency, 1);
});

test('subagents get their own lane and count as one thread beside the main agent', () => {
  const schedule = buildSchedule(normalizeEvents([
    event(0, 'agent.input', { text: 'Go', userAction: true }),
    event(1, 'agent.tool_called', { tool: 'Agent', callId: 't1' }),
    event(2, 'agent.file_read', { tool: 'Read', path: 'x', callId: 's1', agent: 'explore' }),
    event(4, 'agent.tool_completed', { tool: 'Read', callId: 's1', agent: 'explore' }),
    event(3, 'agent.command_started', { tool: 'Bash', command: 'npm test', callId: 'c1' }),
    event(6, 'agent.tool_completed', { tool: 'Bash', callId: 'c1' }),
    event(8, 'agent.thinking', { text: 'x', agent: 'explore' }),
    event(9, 'agent.tool_completed', { tool: 'Agent', callId: 't1' }),
  ]), { agentNames: { explore: 'Explore' } });
  const lane = schedule.lanes.find((item) => item.id === 'agent:explore');
  assert.equal(lane.label, 'Subagent · Explore');
  assert.equal(lane.calls, 1);
  assert.ok(schedule.spans.some((span) => span.window && span.lane === 'agent:explore'));
  assert.equal(schedule.summary.maxConcurrency, 2);
});

test('observed logs pair tool calls with their results and tag subagent events', () => {
  const claude = newObservedSession('claude', 'c.jsonl', Date.parse(at(0)));
  consumeObservedEvent(claude, { type: 'user', sessionId: 's', timestamp: at(0), message: { content: 'Go' } });
  consumeObservedEvent(claude, { type: 'assistant', sessionId: 's', timestamp: at(1), message: { id: 'm', content: [{ type: 'tool_use', id: 'u1', name: 'Read', input: { file_path: 'a.js' } }, { type: 'tool_use', id: 'u2', name: 'Bash', input: { command: 'ls' } }] } });
  consumeObservedEvent(claude, { type: 'user', sessionId: 's', timestamp: at(3), toolUseResult: {}, message: { content: [{ type: 'tool_result', tool_use_id: 'u1' }, { type: 'tool_result', tool_use_id: 'u2', is_error: true }] } });
  consumeObservedEvent(claude, { type: 'assistant', sessionId: 's', isSidechain: true, agentId: 'ax', timestamp: at(4), message: { id: 'n', content: [{ type: 'tool_use', id: 'u3', name: 'Grep', input: { path: 'src' } }] } });
  const done = claude.events.filter((item) => item.type === 'agent.tool_completed');
  assert.deepEqual(done.map((item) => [item.data.callId, item.data.tool, item.data.status]), [['u1', 'Read', 'completed'], ['u2', 'Bash', 'failed']]);
  assert.equal(claude.events.find((item) => item.data.callId === 'u3').data.agent, 'ax');

  const copilot = newObservedSession('copilot', 'p.jsonl', Date.parse(at(0)));
  consumeObservedEvent(copilot, { type: 'tool.execution_start', timestamp: at(1), data: { toolCallId: 't', toolName: 'bash', arguments: { command: 'ls' } } });
  consumeObservedEvent(copilot, { type: 'tool.execution_complete', timestamp: at(2), data: { toolCallId: 't', success: false } });
  assert.equal(copilot.events.at(-1).data.status, 'failed');

  const codex = newObservedSession('codex', 'x.jsonl', Date.parse(at(0)));
  consumeObservedEvent(codex, { type: 'response_item', timestamp: at(1), payload: { type: 'function_call', call_id: 'f', name: 'exec_command', arguments: '{"cmd":"npm test"}' } });
  consumeObservedEvent(codex, { type: 'response_item', timestamp: at(5), payload: { type: 'function_call_output', call_id: 'f', output: 'Process exited with code 2' } });
  assert.deepEqual([codex.events.at(-1).type, codex.events.at(-1).data.status], ['agent.tool_completed', 'failed']);
});

test('an agent reported by several sources is one row, and its events fill what no source reported', async () => {
  const { mergeAgents } = await import('../server/core/provider-details.mjs');
  const { comparisonProfile } = await import('../server/metrics/comparison.mjs');
  const merged = mergeAgents(
    [{ id: 'a1', name: 'Explore', tokens: 900, toolCalls: 4, credits: null, source: 'subagent-event' }],
    [{ id: 'a1', name: 'Explore', tokens: null, credits: 12, apiDurationMs: 3000, source: 'agent-metrics' }],
  );
  assert.deepEqual(merged, [{ id: 'a1', name: 'Explore', tokens: 900, toolCalls: 4, credits: 12, apiDurationMs: 3000, source: 'agent-metrics' }]);

  const profile = comparisonProfile({
    run: { id: 'r', name: 'r', provider: 'custom', model: 'm', status: 'completed', startedAt: at(0),
      providerDetails: { provider: 'custom', models: [], requests: null, agents: [{ id: 'main', name: 'Main agent', source: 'main-agent' }, { id: 'a1', name: 'Explore', source: 'subagent-log' }] } },
    events: normalizeEvents([
      event(0, 'agent.input', { text: 'Go', userAction: true }),
      event(1, 'agent.command_started', { tool: 'Bash', command: 'ls' }),
      event(2, 'agent.file_read', { tool: 'Read', path: 'x', agent: 'a1' }),
      event(6, 'agent.file_read', { tool: 'Read', path: 'y', agent: 'a1' }),
      event(8, 'agent.output', { text: 'Done' }),
    ]),
  });
  const [main, sub] = profile.agents;
  assert.equal(main.toolCalls, 1);
  assert.equal(sub.toolCalls, 2);
  assert.equal(sub.durationMs, 4000);
});

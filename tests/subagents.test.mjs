import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withMainAgent } from '../server/core/provider-details.mjs';
import { consumeObservedEvent, createSessionObserver, newObservedSession, observedSnapshot } from '../server/sources/session-observer.mjs';
import { buildVscodeCopilotSnapshot, replayVscodeChat } from '../server/sources/vscode-copilot-chat.mjs';

const timestamp = '2026-01-10T10:00:00.000Z';
const pick = (agents) => agents.map(({ id, name, model, credits, tokens, toolCalls, input, output, source }) => ({ id, name, model, credits, tokens, toolCalls, input, output, source }));

test('the main agent leads only a run that delegated work', () => {
  assert.deepEqual(withMainAgent([]), []);
  const main = { id: 'main', source: 'main-agent' };
  assert.deepEqual(withMainAgent([main, { id: 'a', source: 'agent-metrics' }]), [main, { id: 'a', source: 'agent-metrics' }]);
  assert.deepEqual(withMainAgent([{ id: 'a', source: 'subagent-event' }], { model: 'm' }).map((agent) => [agent.id, agent.name, agent.model, agent.credits]),
    [['main', 'Main agent', 'm', null], ['a', undefined, undefined, undefined]]);
});

test('VS Code subagents become agents with their credits, model and calls', async () => {
  const call = (id, extra) => ({ kind: 'toolInvocationSerialized', toolCallId: id, isComplete: true, ...extra });
  const response = [
    call('sub-a', { toolId: 'runSubagent', toolSpecificData: { kind: 'subagent', description: 'Accessibility', agentName: 'inventory-accessibility', modelName: 'Claude Sonnet 5', credits: 60, result: 'Done' } }),
    call('sub-b', { toolId: 'runSubagent', toolSpecificData: { kind: 'subagent', description: 'Never started', modelName: 'Claude Sonnet 5' } }),
    call('read-1', { toolId: 'copilot_findTextInFiles', subAgentInvocationId: 'sub-a', invocationMessage: { value: 'Searching' } }),
    call('read-2', { toolId: 'copilot_findTextInFiles', subAgentInvocationId: 'sub-a', invocationMessage: { value: 'Searching again' } }),
  ];
  const document = replayVscodeChat([
    { kind: 0, v: { version: 3, responderUsername: 'GitHub Copilot', sessionId: 'chat-1', requests: [] } },
    { kind: 2, k: ['requests'], v: [{
      requestId: 'r1', timestamp: Date.parse(timestamp), modelId: 'copilot/claude-sonnet-5', message: { text: 'Inventory' },
      promptTokens: 1000, completionTokens: 200, copilotCredits: 100, response: [],
      result: { metadata: { resolvedModel: 'claude-sonnet-5' } },
    }] },
    // A stale state of the response is truncated before the current one is appended.
    { kind: 2, k: ['requests', 0, 'response'], v: [response[0], response[2]] },
    { kind: 2, k: ['requests', 0, 'response'], i: 0, v: response },
  ]);
  assert.equal(document.requests[0].response.length, 4);
  const { snapshot, events } = await buildVscodeCopilotSnapshot(document, path.join(tmpdir(), 'chatSessions', 'chat-1.jsonl'), timestamp);
  assert.deepEqual(pick(snapshot.providerDetails.agents), [
    // The main agent's own calls are the two subagent launches.
    { id: 'main', name: 'Main agent', model: 'claude-sonnet-5', credits: 40, tokens: null, toolCalls: 2, input: 1000, output: 200, source: 'main-agent' },
    { id: 'sub-a', name: 'Accessibility', model: 'claude-sonnet-5', credits: 60, tokens: null, toolCalls: 2, input: null, output: null, source: 'subagent-event' },
  ]);
  assert.equal(events.filter((event) => event.data?.agent === 'sub-a').length, 2);
});

test('Copilot CLI subagents are keyed by the agentId of their events and listed once started', () => {
  const session = newObservedSession('copilot', 'events.jsonl', Date.parse(timestamp));
  for (const event of [
    { type: 'session.start', timestamp, data: { sessionId: 's1', selectedModel: 'claude-sonnet-5.5', startTime: timestamp } },
    { type: 'subagent.started', agentId: 'agent-1', timestamp, data: { toolCallId: 'call-1', agentDisplayName: 'Accessibility', model: 'claude-sonnet-5.5' } },
    { type: 'subagent.started', agentId: 'agent-2', timestamp, data: { toolCallId: 'call-2', agentDisplayName: 'Workers', model: 'claude-sonnet-5.5' } },
    { type: 'subagent.completed', agentId: 'agent-1', timestamp, data: { toolCallId: 'call-1', agentDisplayName: 'Accessibility', model: 'claude-sonnet-5.5', totalTokens: 500, totalToolCalls: 7 } },
  ]) consumeObservedEvent(session, event);
  assert.deepEqual(pick(observedSnapshot(session).providerDetails.agents).map(({ id, name, model, tokens, toolCalls }) => ({ id, name, model, tokens, toolCalls })), [
    { id: 'main', name: 'Main agent', model: 'claude-sonnet-5.5', tokens: null, toolCalls: null },
    { id: 'agent-1', name: 'Accessibility', model: 'claude-sonnet-5.5', tokens: 500, toolCalls: 7 },
    { id: 'agent-2', name: 'Workers', model: 'claude-sonnet-5.5', tokens: null, toolCalls: null },
  ]);
});

test('Codex lists the agents it spawned and ignores a refused spawn', () => {
  const session = newObservedSession('codex', 'rollout.jsonl', Date.parse(timestamp));
  const item = (payload) => ({ type: 'response_item', timestamp, payload });
  for (const event of [
    { type: 'session_meta', timestamp, payload: { id: 'thread-1', cwd: '/repo', timestamp } },
    { type: 'turn_context', timestamp, payload: { model: 'gpt-5.4', cwd: '/repo' } },
    item({ type: 'function_call', name: 'spawn_agent', call_id: 'c1', arguments: JSON.stringify({ agent_type: 'explorer', message: 'Map the repo' }) }),
    item({ type: 'function_call_output', call_id: 'c1', output: JSON.stringify({ agent_id: 'agent-a', nickname: 'Ada' }) }),
    item({ type: 'function_call', name: 'spawn_agent', call_id: 'c2', arguments: JSON.stringify({ fork_context: true, model: 'gpt-5.4-mini', message: 'Again' }) }),
    item({ type: 'function_call_output', call_id: 'c2', output: 'Full-history forked agents inherit the parent agent type, model, and reasoning effort.' }),
  ]) consumeObservedEvent(session, event);
  assert.deepEqual(pick(observedSnapshot(session).providerDetails.agents).map(({ id, name, model, source }) => ({ id, name, model, source })), [
    { id: 'main', name: 'Main agent', model: 'gpt-5.4', source: 'main-agent' },
    { id: 'agent-a', name: 'Ada · explorer', model: 'gpt-5.4', source: 'subagent-event' },
  ]);
});

test('a Claude Code subagent log is named after the description in its meta file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nostraxis-subagents-'));
  try {
    const folder = path.join(root, 'project', 'session-1', 'subagents');
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'agent-x1.jsonl'), `${JSON.stringify({
      type: 'user', isSidechain: true, sessionId: 'session-1', agentId: 'x1', uuid: 'u1', timestamp,
      message: { role: 'user', content: 'You are implementing a long task with many instructions' },
    })}\n`);
    await writeFile(path.join(folder, 'agent-x1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Explore the codebase' }));
    const updates = [];
    const observer = createSessionObserver({ roots: [{ provider: 'claude', root }], onUpdate: (snapshot) => { updates.push(snapshot); } });
    await observer.sync();
    await observer.close();
    const child = updates.find((snapshot) => snapshot.parentNativeSessionId === 'session-1');
    assert.equal(child?.name, 'Explore the codebase');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

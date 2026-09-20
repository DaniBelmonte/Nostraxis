import test from 'node:test';
import assert from 'node:assert/strict';
import { newObservedSession, consumeObservedEvent, observedSnapshot, promptText } from '../server/sources/session-observer.mjs';
import { activityFor, buildObservability, commandCategory } from '../server/metrics/observability.mjs';
import { compact } from '../src/shared/lib/metrics.js';

test('initial JSON conversation prompt survives subsequent turns and provides a title', () => {
  const s = newObservedSession('codex', 'fixture');
  for (const prompt of ['# AGENTS.md instructions\nBootstrap context', '<recommended_plugins>Provider metadata</recommended_plugins>Diagnose latency in checkout', 'Now explain the fix']) consumeObservedEvent(s, {
    type: 'response_item', timestamp: new Date().toISOString(),
    payload: { type: 'message', role: 'user', content: [{type:'input_text',text:prompt}] },
  });
  const run = observedSnapshot(s);
  assert.equal(run.prompt, 'Diagnose latency in checkout');
  assert.equal(run.name, 'Diagnose latency in checkout');
});

test('command completions are not counted twice and sensitive paths produce explainable warnings', () => {
  const events = [
    {id:1,type:'agent.command_started',data:{command:'git reset --hard'}},
    {id:2,type:'agent.command_completed',data:{command:'git reset --hard'}},
    {id:3,type:'agent.file_read',data:{path:'.env.production'}},
    {id:4,type:'agent.file_read',data:{path:'src/app.js'}},
  ];
  const result = activityFor(events);
  assert.deepEqual(result.commands, [{name:'git reset',count:1}]);
  assert.ok(result.warnings.some(w=>w.target==='.env.production'));
  assert.ok(!result.warnings.some(w=>w.target==='src/app.js'));
  assert.equal(result.warnings.length, 2);
  assert.equal(compact(1_250_000), '1.25M');
  assert.equal(compact(2500), '2.5k');
  assert.equal(compact(null), '—');
});

test('shell redirections are excluded from inferred file metrics', () => {
  const result = activityFor([{type:'agent.file_read', data:{path:'2>/dev/null', inferred:true}}]);
  assert.deepEqual(result.files, []);
});

test('auto-review transcript uses the embedded initial user request, not its envelope', () => {
  const wrapped = `The following is the Codex agent history whose request action you are assessing.\n\n> > > TRANSCRIPT START\n\n[1] user: Build a standalone observability dashboard\n\n[2] assistant: I will inspect the project.\n\n> > > TRANSCRIPT END`;
  assert.equal(promptText(wrapped), 'Build a standalone observability dashboard');
});

test('command usage keeps per-provider breakdown, families and command/file co-occurrence', () => {
  const runs = [
    { id: 'r1', provider: 'claude', model: 'claude-opus-5', repositoryPath: '/a', repositoryName: 'A' },
    { id: 'r2', provider: 'codex', model: 'gpt-5', repositoryPath: '/a', repositoryName: 'A' },
  ];
  const events = {
    r1: [{id:1,type:'agent.command_started',data:{command:'grep -n foo src'}},{id:2,type:'agent.file_read',data:{path:'src/app.js'}}],
    r2: [{id:3,type:'agent.command_started',data:{command:'grep -n bar src'}},{id:4,type:'agent.command_started',data:{command:'git status'}},{id:5,type:'agent.file_modified',data:{path:'src/app.js'}}],
  };
  const observability = buildObservability(runs, { eventsFor: (id) => events[id] });
  const grep = observability.commands.find((command) => command.name === 'grep');
  assert.equal(grep.count, 2);
  assert.equal(grep.category, 'search');
  assert.deepEqual(grep.byProvider, { claude: 1, codex: 1 });
  assert.deepEqual(grep.byProject, { A: 2 });
  assert.equal(observability.commandCalls, 3);
  assert.equal(commandCategory('git status'), 'git');
  assert.equal(commandCategory('terraform apply'), 'other');
  assert.equal(observability.graph.nodes.find((node) => node.id === 'command:grep').weight, 2);
  assert.ok(observability.graph.links.some((link) => link.source === 'command:grep' && link.target === 'file:/a:src/app.js'));
  const file = observability.graph.nodes.find((node) => node.id === 'file:/a:src/app.js');
  assert.deepEqual([file.reads, file.writes, file.weight], [1, 1, 2]);
});

test('file nodes are ranked by how often they were read and written', () => {
  const runs = [{ id: 'r1', provider: 'claude', model: 'claude-opus-5', repositoryPath: '/a', repositoryName: 'A' }];
  const events = [
    { id: 1, type: 'agent.file_read', data: { path: 'rare.js' } },
    ...[2, 3, 4].map((id) => ({ id, type: 'agent.file_read', data: { path: 'hot.js' } })),
    { id: 5, type: 'agent.file_modified', data: { path: 'hot.js' } },
    { id: 6, type: 'agent.file_modified', data: { path: 'warm.js' } },
    { id: 7, type: 'agent.file_read', data: { path: 'warm.js' } },
  ];
  const nodes = buildObservability(runs, { eventsFor: () => events }).graph.nodes
    .filter((node) => node.kind === 'file')
    .sort((a, b) => b.weight - a.weight);
  assert.deepEqual(nodes.map((node) => node.name), ['hot.js', 'warm.js', 'rare.js']);
  assert.deepEqual(nodes.map((node) => node.weight), [4, 2, 1]);
});

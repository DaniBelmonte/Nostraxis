import test from 'node:test';
import assert from 'node:assert/strict';
import { newObservedSession, consumeObservedEvent, observedSnapshot, promptText } from '../server/sources/session-observer.mjs';
import { activityFor } from '../server/metrics/observability.mjs';
import { compact } from '../src/lib.js';

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

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/persistence/database.mjs';
import { createWorkProjectService } from '../server/work-projects/service.mjs';
import { buildSelectionAnalysis } from '../server/metrics/selection-analysis.mjs';

const save = (store, id, repositoryPath, usage = null) => store.saveRun({
  id, name: id, repositoryPath, provider: 'codex', model: 'gpt-test', status: 'completed',
  prompt: 'Work on the project', startedAt: '2026-09-24T10:00:00Z',
  updatedAt: '2026-09-24T10:05:00Z', activeDurationMs: 60_000,
  contextSnapshot: {}, permissions: {}, origin: 'external', usage,
});

test('work items persist outside source sessions and multi-folder projects organize both roots', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nostraxis-items-'));
  const first = path.join(dir, 'code'), second = path.join(dir, 'docs');
  await mkdir(first); await mkdir(second);
  let store = openDatabase(path.join(dir, 'data'));
  try {
    save(store, 'a', first, { input: 800, output: 200, cached: 100, cost: 0.1 });
    save(store, 'b', second, { input: 2500, output: 500, cached: 500, cost: 0.3 });
    const projects = createWorkProjectService(store);
    const project = projects.create({ name: 'Nostraxis', folderPaths: [first, second] });
    assert.deepEqual(project.folderPaths, [first, second]);
    const item = projects.createItem({ projectId: project.id, kind: 'feature', title: 'Cost Analytics' });
    assert.equal(projects.moveMany(['a', 'b'], project.id, item.id), 2);
    assert.equal(projects.resolve().runs.every((run) => run.workItemId === item.id), true);
    const aggregate = buildSelectionAnalysis(projects.resolve().runs, store);
    assert.equal(aggregate.totals.totalTokens.value, 4000);
    assert.equal(aggregate.totals.cost.value, 0.4);
    assert.equal(aggregate.totals.activeDurationMs.value, 120_000);
    const otherFolder = path.join(dir, 'other');
    await mkdir(otherFolder);
    const other = projects.create({ name: 'Other', folderPath: otherFolder });
    assert.throws(() => projects.moveMany(['a'], other.id, item.id), /another Project/);
    assert.equal(projects.resolve().runs.find((run) => run.id === 'a').workProjectId, project.id);
    store.close();
    store = openDatabase(path.join(dir, 'data'));
    assert.equal(createWorkProjectService(store).resolve().runs.every((run) => run.workItemId === item.id), true);
    assert.equal(store.getRun('a').repositoryPath, first);
    createWorkProjectService(store).removeItem(item.id);
    assert.equal(createWorkProjectService(store).resolve().runs.every((run) => run.workItemId === null), true);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('changing working directories across projects leaves a session in Inbox until manually assigned', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nostraxis-ambiguous-'));
  const first = path.join(dir, 'one'), second = path.join(dir, 'two');
  await mkdir(first); await mkdir(second);
  const store = openDatabase(path.join(dir, 'data'));
  try {
    save(store, 'multi', second);
    store.insertEvent({ runId: 'multi', timestamp: '2026-09-24T10:01:00Z', provider: 'codex', type: 'agent.workspace', data: { cwd: first } });
    store.insertEvent({ runId: 'multi', timestamp: '2026-09-24T10:02:00Z', provider: 'codex', type: 'agent.workspace', data: { cwd: second } });
    const projects = createWorkProjectService(store);
    const one = projects.create({ name: 'One', folderPath: first });
    projects.create({ name: 'Two', folderPath: second });
    assert.equal(projects.resolve().runs[0].workProjectId, null);
    projects.assign('multi', one.id);
    assert.equal(projects.resolve().runs[0].workProjectId, one.id);
    assert.equal(projects.resolve().runs[0].projectEvidence, 'manual');
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('aggregate coverage excludes unavailable provider metrics instead of treating them as zero', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nostraxis-coverage-'));
  const store = openDatabase(dir);
  try {
    save(store, 'reported', '', { input: 1000, output: 0 });
    save(store, 'missing', '', null);
    const aggregate = buildSelectionAnalysis(store.listRuns(), store);
    assert.deepEqual(aggregate.totals.totalTokens, { value: 1000, reported: 1, total: 2 });
    assert.deepEqual(aggregate.totals.cost, { value: null, reported: 0, total: 2 });
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('aggregate analysis sums Copilot credits by unit and keeps missing coverage visible', () => {
  const run = (id, provider, credits, creditUnit, creditCoverage = 'session') => ({
    id, name: id, provider, model: 'test', status: 'completed',
    usage: credits == null ? {} : { input: 100, output: 50, credits, creditUnit, creditCoverage },
  });
  const result = buildSelectionAnalysis([
    run('copilot-a', 'copilot', 1.25, 'AI credits'),
    run('copilot-b', 'copilot', 2.5, 'AI credits', 'main-agent-only'),
    run('copilot-c', 'copilot', 3, 'premium requests'),
    run('copilot-missing', 'copilot', null),
    run('other', 'codex', 9, 'AI credits'),
  ], { eventsFor: () => [] });
  assert.deepEqual(result.copilotCreditTotals, [
    { unit: 'AI credits', value: 3.75, reported: 2, mainAgentOnly: 1, total: 4 },
    { unit: 'premium requests', value: 3, reported: 1, mainAgentOnly: 0, total: 4 },
  ]);
  assert.equal(result.sessions.find((session) => session.id === 'copilot-b').creditCoverage, 'main-agent-only');
  assert.deepEqual(buildSelectionAnalysis([run('copilot-missing', 'copilot', null)], { eventsFor: () => [] }).copilotCreditTotals,
    [{ unit: null, value: null, reported: 0, mainAgentOnly: 0, total: 1 }]);
});

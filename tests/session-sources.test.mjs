import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventBus } from '../server/core/event-bus.mjs';
import { openDatabase } from '../server/persistence/database.mjs';
import { createRepositoryService } from '../server/repositories/service.mjs';
import { createExternalSessionService } from '../server/sources/external-session-service.mjs';
import { createWorkProjectService } from '../server/work-projects/service.mjs';

test('a history folder added in Settings imports sessions into its work project', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nostraxis-custom-source-'));
  const workspace = path.join(directory, 'MilPlanner');
  const history = path.join(directory, 'codex-history');
  await mkdir(workspace);
  await mkdir(history);
  const timestamp = new Date().toISOString();
  const records = [
    { type: 'session_meta', payload: { id: 'milplanner-session', cwd: workspace, timestamp } },
    { type: 'turn_context', timestamp, payload: { cwd: workspace, model: 'gpt-test' } },
    { type: 'event_msg', timestamp, payload: { type: 'user_message', message: 'Plan meals.' } },
    { type: 'event_msg', timestamp, payload: { type: 'task_complete', completed_at: timestamp } },
  ];
  await writeFile(path.join(history, 'session.jsonl'), `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);

  const store = openDatabase(path.join(directory, 'data'));
  const projects = createWorkProjectService(store);
  const project = projects.create({ name: 'MilPlanner', folderPath: workspace });
  const sources = createExternalSessionService({ store, bus: new EventBus(), repositories: createRepositoryService(store), roots: [] });
  try {
    assert.equal(projects.resolve().projects.find((item) => item.id === project.id).sessionCount, 0);
    await assert.rejects(() => sources.addSource({ provider: 'codex', root: workspace, format: 'unknown' }), /supported/);
    const result = await sources.addSource({ provider: 'codex', root: history, format: 'provider-log' });
    assert.equal(result.source.custom, true);
    assert.equal(result.imported, 1);
    assert.equal(projects.resolve().projects.find((item) => item.id === project.id).sessionCount, 1);
    assert.equal(projects.resolve().runs[0].workProjectId, project.id);
    await assert.rejects(() => sources.addSource({ provider: 'codex', root: history }), /already configured/);
    await sources.removeSource(result.source);
    assert.equal(store.listRuns().length, 1);
    assert.equal(projects.resolve().projects.find((item) => item.id === project.id).sessionCount, 1);
    assert.deepEqual(store.setting('sessionSources.custom', []), []);
    const reopened = createExternalSessionService({ store, bus: new EventBus(), repositories: createRepositoryService(store), roots: [] });
    assert.equal(reopened.status().imported, 1);
    assert.deepEqual(reopened.status().sources, []);
    await reopened.close();
  } finally {
    await sources.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

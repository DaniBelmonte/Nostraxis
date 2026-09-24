import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../server/persistence/database.mjs';
import { createWorkProjectService } from '../server/work-projects/service.mjs';

const saveSession = (store, id, repositoryPath) => store.saveRun({
  id, name: id, repositoryPath, repositoryName: path.basename(repositoryPath),
  provider: 'codex', model: 'gpt-5', status: 'completed', prompt: 'Work on the project',
  startedAt: '2026-09-23T10:00:00.000Z', updatedAt: '2026-09-23T10:01:00.000Z',
  contextSnapshot: {}, permissions: {}, origin: 'external',
});

test('detected folders can be hidden without deleting sessions and stay hidden after reimport', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'nostraxis-projects-'));
  const store = openDatabase(dataDir);
  try {
    const folderPath = path.join(dataDir, 'MilPlanner');
    saveSession(store, 'hermes-1', folderPath);
    const projects = createWorkProjectService(store);
    const detected = projects.resolve().projects.find((project) => project.folderPath === folderPath);
    assert.equal(detected.source, 'detected');
    assert.equal(projects.resolve().runs[0].workProjectName, 'MilPlanner');

    projects.remove(detected.id);
    assert.equal(store.getRun('hermes-1').repositoryPath, folderPath);
    assert.equal(projects.resolve().projects.length, 0);
    assert.equal(projects.resolve().runs[0].workProjectName, null);

    saveSession(store, 'hermes-1', folderPath);
    assert.equal(projects.resolve().projects.length, 0);
    projects.restore(folderPath);
    assert.equal(projects.resolve().projects[0].source, 'detected');
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('manual project assignments survive session updates and removal leaves history intact', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'nostraxis-projects-'));
  const store = openDatabase(dataDir);
  try {
    const broadFolder = path.join(dataDir, 'Daniel Belmonte Valero');
    saveSession(store, 'strava-1', broadFolder);
    saveSession(store, 'other-1', broadFolder);
    const projects = createWorkProjectService(store);
    const workFolder = path.join(dataDir, 'Strava MCP');
    await mkdir(workFolder);
    const strava = projects.create({ name: 'Strava MCP', folderPath: workFolder });
    projects.assign('strava-1', strava.id);
    assert.equal(projects.resolve().runs.find((run) => run.id === 'strava-1').workProjectName, 'Strava MCP');
    assert.equal(projects.resolve().runs.find((run) => run.id === 'other-1').workProjectName, 'Daniel Belmonte Valero');

    assert.equal(projects.assignMany(['strava-1', 'other-1'], strava.id), 2);
    assert.equal(projects.resolve().runs.find((run) => run.id === 'other-1').workProjectName, 'Strava MCP');
    assert.throws(() => projects.assignMany(['strava-1', 'missing'], strava.id), /not found/);

    saveSession(store, 'strava-1', broadFolder);
    assert.equal(projects.resolve().runs.find((run) => run.id === 'strava-1').workProjectName, 'Strava MCP');
    projects.assign('other-1', null);
    assert.equal(projects.resolve().runs.find((run) => run.id === 'other-1').workProjectName, null);
    projects.assign('other-1', 'auto');
    assert.equal(projects.resolve().runs.find((run) => run.id === 'other-1').workProjectName, 'Daniel Belmonte Valero');

    projects.remove(strava.id);
    assert.equal(store.listRuns().length, 2);
    assert.equal(store.getRun('strava-1').prompt, 'Work on the project');
    assert.equal(projects.resolve().projects.some((project) => project.id === strava.id), false);
    assert.equal(projects.resolve().runs.find((run) => run.id === 'strava-1').workProjectName, null);
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('a manual folder rule covers child paths while child folders remain discoverable', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'nostraxis-projects-'));
  const store = openDatabase(dataDir);
  try {
    const folderPath = path.join(dataDir, 'MilPlanner');
    await mkdir(folderPath);
    saveSession(store, 'hermes-1', path.join(folderPath, 'subfolder'));
    const projects = createWorkProjectService(store);
    const workProject = projects.create({ name: 'MilPlanner work', folderPath });
    assert.equal(projects.resolve().projects.length, 2);
    assert.equal(projects.resolve().runs[0].workProjectName, 'MilPlanner work');
    projects.remove(workProject.id);
    assert.equal(store.getRun('hermes-1').repositoryPath, path.join(folderPath, 'subfolder'));
    assert.equal(projects.resolve().projects.length, 0);
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('overlapping Projects share matching sessions while manual moves remain explicit', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'nostraxis-shared-projects-'));
  const parent = path.join(dataDir, 'GitHub');
  const child = path.join(parent, 'eci-ios-rebirth');
  await mkdir(parent); await mkdir(child);
  const store = openDatabase(dataDir);
  try {
    saveSession(store, 'child-session', path.join(child, 'Sources'));
    saveSession(store, 'parent-session', path.join(parent, 'other'));
    const projects = createWorkProjectService(store);
    const broad = projects.create({ name: 'GitHub', folderPath: parent });
    const specific = projects.create({ name: 'eci-ios-rebirth', folderPath: child });
    let resolved = projects.resolve();
    assert.deepEqual(new Set(resolved.runs.find((run) => run.id === 'child-session').workProjectIds), new Set([broad.id, specific.id]));
    assert.deepEqual(resolved.runs.find((run) => run.id === 'parent-session').workProjectIds, [broad.id]);
    assert.equal(resolved.projects.find((project) => project.id === broad.id).sessionCount, 2);
    assert.equal(resolved.projects.find((project) => project.id === specific.id).sessionCount, 1);
    const duplicate = projects.create({ name: 'Another child view', folderPath: child });
    resolved = projects.resolve();
    assert.deepEqual(new Set(resolved.runs.find((run) => run.id === 'child-session').workProjectIds), new Set([broad.id, specific.id, duplicate.id]));
    const item = projects.createItem({ projectId: specific.id, title: 'Feature work', kind: 'feature' });
    projects.assignItems(['child-session'], item.id);
    assert.equal(projects.resolve().runs.find((run) => run.id === 'child-session').workItemId, item.id);
    projects.assign('child-session', broad.id);
    assert.deepEqual(projects.resolve().runs.find((run) => run.id === 'child-session').workProjectIds, [broad.id]);
    projects.assign('child-session', 'auto');
    assert.equal(projects.resolve().runs.find((run) => run.id === 'child-session').workProjectIds.length, 3);
  } finally { store.close(); await rm(dataDir, { recursive: true, force: true }); }
});

test('a work project can own several workspaces without changing source sessions', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'nostraxis-projects-'));
  let store = openDatabase(dataDir);
  try {
    const first = path.join(dataDir, 'MilPlanner');
    const second = path.join(dataDir, 'Strava MCP');
    await mkdir(first); await mkdir(second);
    saveSession(store, 'meal-1', path.join(first, 'app'));
    saveSession(store, 'strava-1', path.join(second, 'mcp'));
    const projects = createWorkProjectService(store);
    const project = projects.create({ name: 'Personal tools', folderPath: first });
    assert.deepEqual(project.folderPaths, [first]);
    assert.equal(projects.resolve().projects.find((item) => item.id === project.id).sessionCount, 1);
    assert.equal(projects.resolve().runs.find((run) => run.id === 'strava-1').workProjectName, 'mcp');

    const updated = projects.addFolder(project.id, second);
    assert.deepEqual(updated.folderPaths, [first, second]);
    assert.equal(projects.resolve().runs.find((run) => run.id === 'meal-1').workProjectName, 'Personal tools');
    assert.equal(projects.resolve().runs.find((run) => run.id === 'strava-1').workProjectName, 'Personal tools');
    assert.equal(projects.resolve().projects.find((item) => item.id === project.id).sessionCount, 2);
    assert.throws(() => projects.addFolder(project.id, second), /already belongs/);

    projects.removeFolder(project.id, second);
    assert.equal(store.getRun('strava-1').repositoryPath, path.join(second, 'mcp'));
    assert.equal(projects.resolve().runs.find((run) => run.id === 'strava-1').workProjectName, null);
    assert.equal(projects.resolve().projects.find((item) => item.id === project.id).sessionCount, 1);
    projects.removeFolder(project.id, first);
    assert.deepEqual(store.getWorkProject(project.id).folderPaths, []);
    store.close();

    store = openDatabase(dataDir);
    assert.deepEqual(store.getWorkProject(project.id).folderPaths, []);
    assert.equal(store.listRuns().length, 2);
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('legacy work-project folder rules migrate to the workspace collection', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'nostraxis-projects-'));
  let store = openDatabase(dataDir);
  try {
    const folderPath = `${path.join(dataDir, 'legacy-folder')}${path.sep}`;
    store.db.prepare('INSERT INTO work_projects(id,name,folder_path,created_at) VALUES (?,?,?,?)').run('work:legacy', 'Legacy', folderPath, '2026-09-23T10:00:00.000Z');
    store.close();
    store = openDatabase(dataDir);
    assert.deepEqual(store.getWorkProject('work:legacy').folderPaths, [folderPath]);
    saveSession(store, 'legacy-1', path.join(folderPath, 'child'));
    const projects = createWorkProjectService(store);
    assert.equal(projects.resolve().runs[0].workProjectName, 'Legacy');
    projects.removeFolder('work:legacy', folderPath);
    assert.deepEqual(store.getWorkProject('work:legacy').folderPaths, []);
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('an existing database migrates to allow the same workspace in several projects', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'nostraxis-overlap-migration-'));
  const folderPath = path.join(dataDir, 'eci-ios-rebirth');
  await mkdir(folderPath);
  const legacy = new DatabaseSync(path.join(dataDir, 'dashboard.sqlite'));
  legacy.exec(`CREATE TABLE work_projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,folder_path TEXT UNIQUE,created_at TEXT NOT NULL);
    CREATE TABLE work_project_folders(project_id TEXT NOT NULL REFERENCES work_projects(id) ON DELETE CASCADE,folder_path TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,PRIMARY KEY(project_id,folder_path));`);
  legacy.prepare('INSERT INTO work_projects VALUES (?,?,?,?)').run('work:old', 'GitHub', folderPath, '2026-09-23T10:00:00Z');
  legacy.prepare('INSERT INTO work_project_folders VALUES (?,?,?)').run('work:old', folderPath, '2026-09-23T10:00:00Z');
  legacy.close();
  let store = openDatabase(dataDir);
  try {
    const projects = createWorkProjectService(store);
    const second = projects.create({ name: 'eci-ios-rebirth', folderPath });
    assert.deepEqual(store.getWorkProject('work:old').folderPaths, [folderPath]);
    assert.deepEqual(store.getWorkProject(second.id).folderPaths, [folderPath]);
    store.close();
    store = openDatabase(dataDir);
    assert.equal(store.listWorkProjects().length, 2);
    assert.deepEqual(store.getWorkProject(second.id).folderPaths, [folderPath]);
  } finally { store.close(); await rm(dataDir, { recursive: true, force: true }); }
});

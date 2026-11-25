import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/persistence/database.mjs';
import { createRepositoryService } from '../server/repositories/service.mjs';
import { createRunManager } from '../server/runtime/run-manager.mjs';
import { EventBus } from '../server/core/event-bus.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function waitFor(predicate, timeout = 2000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await predicate()) return;
    await delay(20);
  }
  assert.fail('Expected lifecycle transition did not occur before the deadline.');
}

async function setup(t, args = []) {
  const dir = await mkdtemp(path.join(tmpdir(), 'nostraxis-cancellation-'));
  const store = openDatabase(path.join(dir, 'data'));
  const repositories = createRepositoryService(store);
  const repository = await repositories.add(dir);
  const manager = createRunManager({ store, bus: new EventBus(), repositories });
  let pid;
  t.after(async () => {
    if (pid && alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    await manager.terminate();
    if (pid) await waitFor(() => !alive(pid));
    // Let close callbacks finish before the test removes their database.
    await delay(30);
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const run = await manager.create({
    repositoryId: repository.id, provider: 'custom', prompt: 'Synthetic cancellation test.',
    executable: process.execPath,
    args: [path.resolve('tests/fixtures/cancellable-provider.mjs'), ...args],
  });
  await waitFor(() => {
    const ready = store.eventsFor(run.id).find(event => event.data.text.startsWith('ready:'));
    if (!ready) return false;
    pid = Number(ready.data.text.slice(6));
    return true;
  });
  return { manager, store, run, pid };
}

test('cancellation stays cancelled after close and retains shutdown output', async t => {
  const { manager, store, run, pid } = await setup(t);
  assert.equal(manager.cancel(run.id).status, 'cancelled');
  manager.cancel(run.id);
  await waitFor(() => !alive(pid));
  await delay(50);
  const saved = store.getRun(run.id);
  assert.equal(saved.status, 'cancelled');
  assert.ok(saved.endedAt);
  assert.match(saved.response, /Partial result preserved/);
  const events = store.eventsFor(run.id);
  assert.equal(events.filter(event => event.type === 'agent.cancelled').length, 1);
  assert.equal(events.filter(event => event.type === 'agent.error').length, 0);
});

test('cancellation stops a process that ignores SIGTERM', { skip: process.platform === 'win32' }, async t => {
  const { manager, store, run, pid } = await setup(t, ['--ignore-term']);
  manager.cancel(run.id);
  await waitFor(() => !alive(pid), 7000);
  assert.equal(store.getRun(run.id).status, 'cancelled');
});

test('runtime shutdown waits for child closure before database shutdown', async t => {
  const { manager, store, run, pid } = await setup(t);
  await manager.terminate();
  assert.equal(alive(pid), false);
  assert.equal(store.getRun(run.id).status, 'cancelled');
  assert.match(store.getRun(run.id).response, /Partial result preserved/);
});

test('external sessions cannot be cancelled by the managed runtime', async t => {
  const { manager, store, run } = await setup(t);
  store.saveRun({ ...store.getRun(run.id), id: 'external-test', origin: 'external' });
  assert.throws(() => manager.cancel('external-test'), /read-only/);
  assert.equal(store.getRun('external-test').status, 'running');
});

test('shutdown also stops Copilot runs still preparing telemetry', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nostraxis-cancellation-startup-'));
  const previous = process.env.NOSTRAXIS_COPILOT_BIN;
  process.env.NOSTRAXIS_COPILOT_BIN = process.execPath;
  const store = openDatabase(path.join(dir, 'data'));
  const repositories = createRepositoryService(store);
  const repository = await repositories.add(dir);
  const manager = createRunManager({ store, bus: new EventBus(), repositories });
  t.after(async () => {
    await delay(100);
    await manager.terminate();
    store.close();
    if (previous == null) delete process.env.NOSTRAXIS_COPILOT_BIN;
    else process.env.NOSTRAXIS_COPILOT_BIN = previous;
    await rm(dir, { recursive: true, force: true });
  });
  const run = await manager.create({ repositoryId: repository.id, provider: 'copilot', prompt: 'Synthetic startup.' });
  await manager.terminate();
  assert.equal(store.getRun(run.id).status, 'cancelled');
  assert.ok(store.getRun(run.id).endedAt);
});

test('cancelling a Copilot usage probe stops it and prevents another probe', { skip: process.platform === 'win32' }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nostraxis-cancellation-probe-'));
  const executable = path.join(dir, 'copilot.mjs');
  await writeFile(executable, `#!${process.execPath}
import { appendFileSync } from 'node:fs';
if (process.argv.includes('/usage')) {
  appendFileSync('probes.txt', String(process.pid) + '\\n');
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
} else if (process.argv.includes('/context')) {
  appendFileSync('probes.txt', 'unexpected-context\\n');
} else {
  console.log(JSON.stringify({ type: 'session.start', data: { sessionId: 'synthetic-probe' } }));
}
`);
  await chmod(executable, 0o700);
  const previous = process.env.NOSTRAXIS_COPILOT_BIN;
  process.env.NOSTRAXIS_COPILOT_BIN = executable;
  const store = openDatabase(path.join(dir, 'data'));
  const repositories = createRepositoryService(store);
  const repository = await repositories.add(dir);
  const manager = createRunManager({ store, bus: new EventBus(), repositories });
  let pid;
  t.after(async () => {
    if (pid && alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    await manager.terminate();
    store.close();
    if (previous == null) delete process.env.NOSTRAXIS_COPILOT_BIN;
    else process.env.NOSTRAXIS_COPILOT_BIN = previous;
    await rm(dir, { recursive: true, force: true });
  });
  const run = await manager.create({ repositoryId: repository.id, provider: 'copilot', prompt: 'Synthetic probe.' });
  await waitFor(async () => {
    const contents = await readFile(path.join(dir, 'probes.txt'), 'utf8').catch(() => '');
    if (!contents) return false;
    pid = Number(contents.trim());
    return Number.isFinite(pid);
  });
  manager.cancel(run.id);
  await waitFor(() => !alive(pid), 7000);
  await manager.terminate();
  assert.equal(store.getRun(run.id).status, 'cancelled');
  assert.equal((await readFile(path.join(dir, 'probes.txt'), 'utf8')).trim().split('\n').length, 1);
});

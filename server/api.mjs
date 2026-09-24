import { openDatabase } from './persistence/database.mjs';
import { EventBus } from './core/event-bus.mjs';
import { createRepositoryService } from './repositories/service.mjs';
import { createWorkProjectService } from './work-projects/service.mjs';
import { createRunManager } from './runtime/run-manager.mjs';
import { createExperimentService } from './experiments/service.mjs';
import { detectProviders } from './providers/index.mjs';
import { buildAnalytics, compareRuns, metricDefinitions, matches } from './metrics/analytics.mjs';
import { buildObservability } from './metrics/observability.mjs';
import { createExternalSessionService } from './sources/external-session-service.mjs';
import { createProviderUsageService } from './sources/provider-usage.mjs';
import { chooseRepositoryFolder, chooseSessionSourceFolder, chooseWorkProjectFolder } from './repositories/picker.mjs';
import { buildRunJsonl, runExportFilename } from './exports/run-jsonl.mjs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

// Folder browsing runs on the same local host as the session-history observer.
async function browseFolders(requestedPath) {
  const folderPath = requestedPath || homedir();
  if (!path.isAbsolute(folderPath)) throw new Error('Enter an absolute folder path.');
  const resolved = path.resolve(folderPath);
  let folderStats;
  try { folderStats = await stat(resolved); }
  catch (error) { throw new Error(error.code === 'ENOENT' ? 'Folder not found.' : error.code === 'EACCES' ? 'Access to this folder is denied.' : error.message); }
  if (!folderStats.isDirectory()) throw new Error('The selected path is not a folder.');
  const entries = await readdir(resolved, { withFileTypes: true });
  const folders = (await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(resolved, entry.name);
    if (!entry.isDirectory() && !(entry.isSymbolicLink() && (await stat(entryPath).catch(() => null))?.isDirectory())) return null;
    return { name: entry.name, path: entryPath };
  }))).filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return { path: resolved, parent: path.dirname(resolved) === resolved ? null : path.dirname(resolved), folders, shortcuts: [
    { name: 'Home', path: homedir() },
    { name: 'Nostraxis', path: process.cwd() },
  ] };
}

const json = (res, status, value) => {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
};

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('Request body exceeds 1 MB.');
  }
  return JSON.parse(body || '{}');
}

const safeMethod = (method) => method === 'GET' || method === 'HEAD';

// Reaching 127.0.0.1 is the only authorization this API has, and any page the
// browser loads can reach it. Browser-originated requests must therefore prove
// they came from the dashboard itself. Fetch metadata and Origin protect every
// route, including reads with side effects; unsafe methods additionally require
// JSON, which rules out forms and simple cross-origin requests.
function crossSiteRejection(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return 'Cross-site requests are not allowed.';
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try { host = new URL(origin).host; }
    catch { return 'Origin not allowed.'; }
    if (!host || host !== req.headers.host) return 'Origin not allowed.';
  }
  if (safeMethod(req.method)) return null;
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') return 'Content-Type must be application/json.';
  return null;
}

const matchId = (pathname, prefix, suffix = '') => {
  if (!pathname.startsWith(prefix) || (suffix && !pathname.endsWith(suffix))) return null;
  const value = pathname.slice(prefix.length, suffix ? -suffix.length : undefined);
  return value && !value.includes('/') ? decodeURIComponent(value) : null;
};

export function createApi({ dataDir, experimentsEnabled = process.env.NOSTRAXIS_EXPERIMENTS_ENABLED === '1' } = {}) {
  const store = openDatabase(dataDir);
  const bus = new EventBus();
  const repositories = createRepositoryService(store);
  const workProjects = createWorkProjectService(store);
  const runs = createRunManager({ store, bus, repositories });
  const experiments = createExperimentService({ store, repositories, runs });
  const externalSessions = createExternalSessionService({ store, bus, repositories });
  void externalSessions.start()
    .then(() => bus.publish({ kind: 'sources', ...externalSessions.status() }))
    .catch(() => {});
  let providerCache = [];
  const providersReady = detectProviders().then((items) => { providerCache = items; return items; });
  const providerUsage = createProviderUsageService({
    runs,
    getProviders: () => providerCache,
    getSources: () => externalSessions.status().sources,
  });

  return {
    async handle(req, res) {
      const url = new URL(req.url, 'http://localhost');
      const route = url.pathname;
      if (!route.startsWith('/api/')) return false;
      const rejection = crossSiteRejection(req);
      if (rejection) { json(res, 403, { error: rejection }); return true; }
      try {
        if (req.method === 'GET' && route === '/api/stream') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
          res.write(`data: ${JSON.stringify({ kind: 'ready' })}\n\n`);
          const unsubscribe = bus.subscribe((message) => res.write(`data: ${JSON.stringify(message)}\n\n`));
          const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20_000);
          req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
          return true;
        }
        if (req.method === 'GET' && route === '/api/dashboard') {
          await providersReady;
          const { runs: allRuns, projects } = workProjects.resolve(runs.list());
          const usage = await providerUsage.get();
          json(res, 200, {
            generatedAt: new Date().toISOString(), providers: providerCache,
            repositories: repositories.list(), workProjects: projects, hiddenWorkProjectPaths: store.hiddenWorkProjectPaths(), runs: allRuns,
            analytics: buildAnalytics(allRuns), experiments: experimentsEnabled ? experiments.list() : [],
            metricDefinitions, features: { experiments: experimentsEnabled },
            experimentCatalog: experimentsEnabled ? experiments.catalog() : null,
            sessionSources: externalSessions.status().sources,
            externalSessionCount: externalSessions.status().imported,
            providerUsage: usage,
          });
          return true;
        }
        if (req.method === 'GET' && route === '/api/folders') {
          json(res, 200, await browseFolders(url.searchParams.get('path')));
          return true;
        }
        if (req.method === 'POST' && route === '/api/provider-usage') {
          await providersReady;
          const { from = null, to = null, refresh = false } = await readBody(req);
          if (from || to) await externalSessions.sync();
          json(res, 200, await providerUsage.get({
            force: refresh === true,
            from, to,
          }));
          return true;
        }
        if (req.method === 'GET' && route === '/api/providers') {
          json(res, 200, await providersReady); return true;
        }
        if (req.method === 'GET' && route === '/api/repositories') {
          json(res, 200, repositories.list()); return true;
        }
        if (req.method === 'POST' && route === '/api/repositories/pick') {
          json(res, 200, await chooseRepositoryFolder()); return true;
        }
        if (req.method === 'POST' && route === '/api/work-projects/pick') {
          json(res, 200, await chooseWorkProjectFolder()); return true;
        }
        if (req.method === 'POST' && route === '/api/session-sources/sync') {
          const result = await externalSessions.sync();
          bus.publish({ kind: 'sources', ...result });
          json(res, 200, result); return true;
        }
        if (req.method === 'POST' && route === '/api/session-sources/pick') {
          json(res, 200, await chooseSessionSourceFolder()); return true;
        }
        if (req.method === 'POST' && route === '/api/session-sources') {
          const result = await externalSessions.addSource(await readBody(req));
          bus.publish({ kind: 'sources', ...result });
          json(res, 201, result); return true;
        }
        if (req.method === 'DELETE' && route === '/api/session-sources') {
          const result = await externalSessions.removeSource(await readBody(req));
          bus.publish({ kind: 'sources', ...result });
          json(res, 200, result); return true;
        }
        if (req.method === 'POST' && route === '/api/repositories') {
          json(res, 201, await repositories.add((await readBody(req)).path)); return true;
        }
        if (req.method === 'POST' && route === '/api/work-projects') {
          const project = workProjects.create(await readBody(req));
          bus.publish({ kind: 'work-projects' });
          json(res, 201, project); return true;
        }
        if (req.method === 'POST' && route === '/api/work-projects/restore') {
          workProjects.restore((await readBody(req)).folderPath);
          bus.publish({ kind: 'work-projects' });
          json(res, 200, { restored: true }); return true;
        }
        if (req.method === 'PUT' && route === '/api/work-projects/assign-runs') {
          const { runIds, projectId } = await readBody(req);
          const count = workProjects.assignMany(runIds, projectId);
          bus.publish({ kind: 'work-projects' });
          json(res, 200, { assigned: count }); return true;
        }
        const folderProjectId = matchId(route, '/api/work-projects/', '/folders');
        if (folderProjectId && req.method === 'POST') {
          const project = workProjects.addFolder(folderProjectId, (await readBody(req)).folderPath);
          bus.publish({ kind: 'work-projects' });
          json(res, 201, project); return true;
        }
        if (folderProjectId && req.method === 'DELETE') {
          const project = workProjects.removeFolder(folderProjectId, (await readBody(req)).folderPath);
          bus.publish({ kind: 'work-projects' });
          json(res, 200, project); return true;
        }
        const workProjectId = matchId(route, '/api/work-projects/');
        if (req.method === 'DELETE' && workProjectId) {
          workProjects.remove(workProjectId);
          bus.publish({ kind: 'work-projects' });
          json(res, 200, { removed: true }); return true;
        }
        const assignmentRunId = matchId(route, '/api/runs/', '/work-project');
        if (req.method === 'PUT' && assignmentRunId) {
          workProjects.assign(assignmentRunId, (await readBody(req)).projectId);
          bus.publish({ kind: 'work-projects' });
          json(res, 200, { assigned: true }); return true;
        }
        if (req.method === 'GET' && route === '/api/runs') {
          json(res, 200, runs.list()); return true;
        }
        const exportRunId = matchId(route, '/api/runs/', '/export');
        if (req.method === 'GET' && exportRunId) {
          const detail = runs.detail(exportRunId);
          const body = buildRunJsonl(detail);
          res.writeHead(200, {
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Content-Disposition': `attachment; filename="${runExportFilename(detail.run)}"`,
            'Content-Length': Buffer.byteLength(body),
            'Cache-Control': 'no-store',
          });
          res.end(body);
          return true;
        }
        const runId = matchId(route, '/api/runs/');
        if (req.method === 'GET' && runId) {
          json(res, 200, runs.detail(runId)); return true;
        }
        if (req.method === 'POST' && route === '/api/runs') {
          json(res, 202, await runs.create(await readBody(req))); return true;
        }
        const cancelId = matchId(route, '/api/runs/', '/cancel');
        if (req.method === 'POST' && cancelId) {
          json(res, 200, runs.cancel(cancelId)); return true;
        }
        const evaluationId = matchId(route, '/api/runs/', '/evaluation');
        if (req.method === 'POST' && evaluationId) {
          json(res, 200, runs.evaluate(evaluationId, await readBody(req))); return true;
        }
        if (req.method === 'GET' && route === '/api/analytics') {
          const filters = Object.fromEntries(['repository', 'provider', 'model', 'from', 'to'].map((key) => [key, url.searchParams.get(key)]).filter(([, value]) => value));
          const selected = runs.list().filter(run => matches(run, filters));
          json(res, 200, { ...buildAnalytics(selected), observability: buildObservability(selected, store) }); return true;
        }
        if (req.method === 'GET' && route === '/api/compare') {
          const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean).slice(0, 12);
          const selected = ids.map((id) => {
            try {
              const detail = runs.detail(id);
              return { ...detail.run, files: detail.files, tools: detail.tools };
            } catch { return null; }
          }).filter(Boolean);
          json(res, 200, compareRuns(selected)); return true;
        }
        if (experimentsEnabled && req.method === 'GET' && route === '/api/experiments') {
          json(res, 200, experiments.list()); return true;
        }
        if (experimentsEnabled && req.method === 'POST' && route === '/api/experiments') {
          json(res, 201, experiments.create(await readBody(req))); return true;
        }
        const experimentId = matchId(route, '/api/experiments/');
        if (experimentsEnabled && req.method === 'GET' && experimentId) {
          const experiment = experiments.get(experimentId);
          if (!experiment) throw new Error('Experiment not found.');
          json(res, 200, experiment); return true;
        }
        const startExperimentId = matchId(route, '/api/experiments/', '/run');
        if (experimentsEnabled && req.method === 'POST' && startExperimentId) {
          json(res, 202, await experiments.start(startExperimentId)); return true;
        }
        json(res, 404, { error: 'API route not found.' });
      } catch (error) {
        const notFound = /not found/i.test(error.message);
        json(res, notFound ? 404 : 400, { error: error.message });
      }
      return true;
    },
    async close() { runs.terminate(); await externalSessions.close(); store.close(); },
  };
}

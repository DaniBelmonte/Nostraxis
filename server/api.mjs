import { openDatabase } from './persistence/database.mjs';
import { EventBus } from './core/event-bus.mjs';
import { createRepositoryService } from './repositories/service.mjs';
import { createRunManager } from './runtime/run-manager.mjs';
import { createExperimentService } from './experiments/service.mjs';
import { detectProviders } from './providers/index.mjs';
import { buildAnalytics, compareRuns, metricDefinitions, matches } from './metrics/analytics.mjs';
import { buildObservability } from './metrics/observability.mjs';
import { createExternalSessionService } from './sources/external-session-service.mjs';
import { createProviderUsageService } from './sources/provider-usage.mjs';
import { chooseRepositoryFolder } from './repositories/picker.mjs';
import { buildRunJsonl, runExportFilename } from './exports/run-jsonl.mjs';

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

const matchId = (pathname, prefix, suffix = '') => {
  if (!pathname.startsWith(prefix) || (suffix && !pathname.endsWith(suffix))) return null;
  const value = pathname.slice(prefix.length, suffix ? -suffix.length : undefined);
  return value && !value.includes('/') ? decodeURIComponent(value) : null;
};

export function createApi({ dataDir, experimentsEnabled = process.env.NOSTRAXIS_EXPERIMENTS_ENABLED === '1' } = {}) {
  const store = openDatabase(dataDir);
  const bus = new EventBus();
  const repositories = createRepositoryService(store);
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
          const allRuns = runs.list();
          const usage = await providerUsage.get();
          json(res, 200, {
            generatedAt: new Date().toISOString(), providers: providerCache,
            repositories: repositories.list(), runs: allRuns,
            analytics: buildAnalytics(allRuns), experiments: experimentsEnabled ? experiments.list() : [],
            metricDefinitions, features: { experiments: experimentsEnabled },
            experimentCatalog: experimentsEnabled ? experiments.catalog() : null,
            sessionSources: externalSessions.status().sources,
            externalSessionCount: externalSessions.status().imported,
            providerUsage: usage,
          });
          return true;
        }
        if (req.method === 'GET' && route === '/api/provider-usage') {
          await providersReady;
          const from = url.searchParams.get('from');
          const to = url.searchParams.get('to');
          if (from || to) await externalSessions.sync();
          json(res, 200, await providerUsage.get({
            force: url.searchParams.get('refresh') === '1',
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
          const origin = req.headers.origin;
          if (origin && new URL(origin).host !== req.headers.host) throw new Error('Origin not allowed.');
          json(res, 200, await chooseRepositoryFolder()); return true;
        }
        if (req.method === 'POST' && route === '/api/session-sources/sync') {
          const result = await externalSessions.sync();
          bus.publish({ kind: 'sources', ...result });
          json(res, 200, result); return true;
        }
        if (req.method === 'POST' && route === '/api/repositories') {
          json(res, 201, await repositories.add((await readBody(req)).path)); return true;
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

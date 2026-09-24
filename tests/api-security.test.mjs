import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createApi } from '../server/api.mjs';

const HOST = 'localhost:4173';

const request = ({ method = 'POST', url = '/api/repositories', headers = {}, body = null } = {}) =>
  Object.assign(Readable.from(body == null ? [] : [Buffer.from(body)]), {
    method, url, headers: { host: HOST, ...headers },
  });

function response() {
  const result = { status: 200, headers: {}, body: '', ended: false };
  return {
    result,
    setHeader(key, value) { result.headers[key] = value; },
    writeHead(status, headers) { result.status = status; Object.assign(result.headers, headers || {}); },
    write(chunk) { result.body += chunk; return true; },
    end(chunk) { if (chunk) result.body += chunk; result.ended = true; },
    on() {},
  };
}

async function call(api, options) {
  const res = response();
  const handled = await api.handle(request(options), res);
  return { handled, ...res.result, json: res.result.body ? JSON.parse(res.result.body) : null };
}

test('API rejects cross-site browser callers and unsafe requests without JSON', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nostraxis-api-security-'));
  process.env.NOSTRAXIS_SEED = '0';
  process.env.NOSTRAXIS_SESSION_ROOTS_JSON = '[]';
  for (const provider of ['CODEX', 'CLAUDE', 'COPILOT']) process.env[`NOSTRAXIS_${provider}_BIN`] = '/bin/echo';
  const api = createApi({ dataDir: path.join(dir, 'data') });
  const payload = JSON.stringify({ path: dir });
  const json = { 'content-type': 'application/json' };

  const crossOrigin = await call(api, { headers: { ...json, origin: 'https://evil.example' }, body: payload });
  assert.equal(crossOrigin.status, 403);
  assert.match(crossOrigin.json.error, /Origin not allowed/);

  const opaqueOrigin = await call(api, { headers: { ...json, origin: 'null' }, body: payload });
  assert.equal(opaqueOrigin.status, 403);

  const crossSite = await call(api, { headers: { ...json, 'sec-fetch-site': 'cross-site' }, body: payload });
  assert.equal(crossSite.status, 403);
  assert.match(crossSite.json.error, /Cross-site/);

  const crossSiteRead = await call(api, {
    method: 'GET', url: '/api/providers', headers: { 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(crossSiteRead.status, 403);

  // A `text/plain` POST is a simple request: the browser sends it without a
  // preflight, so it is the shape a cross-site page would reach for.
  const simpleRequest = await call(api, { headers: { 'content-type': 'text/plain' }, body: payload });
  assert.equal(simpleRequest.status, 403);
  assert.match(simpleRequest.json.error, /application\/json/);

  const form = await call(api, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'path=/tmp',
  });
  assert.equal(form.status, 403);

  const missingContentType = await call(api, { body: payload });
  assert.equal(missingContentType.status, 403);
  assert.match(missingContentType.json.error, /application\/json/);

  const spawnAttempt = await call(api, {
    url: '/api/runs',
    headers: { 'content-type': 'text/plain', origin: 'https://evil.example' },
    body: JSON.stringify({ provider: 'custom', repositoryId: 'repo-any', prompt: 'x', executable: '/bin/echo' }),
  });
  assert.equal(spawnAttempt.status, 403);
  assert.equal((await call(api, { method: 'GET', url: '/api/runs' })).json.length, 0);

  const sameOrigin = await call(api, {
    headers: { ...json, origin: `http://${HOST}`, 'sec-fetch-site': 'same-origin' },
    body: payload,
  });
  assert.equal(sameOrigin.status, 201);
  assert.equal(sameOrigin.json.path, await realpath(dir));

  // Local CLI callers send neither Origin nor fetch metadata.
  const commandLine = await call(api, { headers: json, body: payload });
  assert.equal(commandLine.status, 201);

  const providerUsage = await call(api, {
    url: '/api/provider-usage', headers: json, body: JSON.stringify({ from: '2026-09-01', to: '2026-09-16' }),
  });
  assert.equal(providerUsage.status, 200);

  const legacyProviderUsage = await call(api, { method: 'GET', url: '/api/provider-usage' });
  assert.equal(legacyProviderUsage.status, 404);

  const listing = await call(api, { method: 'GET', url: '/api/repositories' });
  assert.equal(listing.status, 200);
  assert.equal(listing.json.length, 1);

  const folderListing = await call(api, { method: 'GET', url: `/api/folders?path=${encodeURIComponent(dir)}` });
  assert.equal(folderListing.status, 200);
  assert.equal(folderListing.json.path, path.resolve(dir));
  assert.ok(Array.isArray(folderListing.json.folders));
  assert.equal((await call(api, { method: 'GET', url: '/api/folders?path=relative-folder' })).status, 400);

  await mkdir(path.join(dir, 'workspace-one'));
  await mkdir(path.join(dir, 'workspace-two'));

  const createdProject = await call(api, {
    url: '/api/work-projects', headers: json,
    body: JSON.stringify({ name: 'Personal tools', folderPath: path.join(dir, 'workspace-one') }),
  });
  assert.equal(createdProject.status, 201);
  const folderRoute = `/api/work-projects/${encodeURIComponent(createdProject.json.id)}/folders`;
  const addedFolder = await call(api, {
    url: folderRoute, headers: json, body: JSON.stringify({ folderPath: path.join(dir, 'workspace-two') }),
  });
  assert.equal(addedFolder.status, 201);
  assert.equal(addedFolder.json.folderPaths.length, 2);
  const removedFolder = await call(api, {
    method: 'DELETE', url: folderRoute, headers: json,
    body: JSON.stringify({ folderPath: path.join(dir, 'workspace-two') }),
  });
  assert.equal(removedFolder.status, 200);
  assert.deepEqual(removedFolder.json.folderPaths, [path.join(dir, 'workspace-one')]);

  const addedSource = await call(api, {
    url: '/api/session-sources', headers: json,
    body: JSON.stringify({ provider: 'codex', format: 'provider-log', root: dir }),
  });
  assert.equal(addedSource.status, 201);
  assert.equal(addedSource.json.source.custom, true);
  assert.ok(addedSource.json.sources.some((source) => source.root === addedSource.json.source.root && source.custom));
  const removedSource = await call(api, {
    method: 'DELETE', url: '/api/session-sources', headers: json,
    body: JSON.stringify({ provider: 'codex', format: 'provider-log', root: dir }),
  });
  assert.equal(removedSource.status, 200);
  assert.equal(removedSource.json.sources.some((source) => source.root === addedSource.json.source.root && source.custom), false);

  await api.close();
  await rm(dir, { recursive: true });
});

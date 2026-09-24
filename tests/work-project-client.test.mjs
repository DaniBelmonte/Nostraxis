import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/shared/api/client.js';

test('folder browsing and work-project creation use their own API routes', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (route, options) => {
    calls.push({ route, method: options?.method || 'GET', body: options?.body });
    return new Response(JSON.stringify({ path: '/private/tmp/example workspace' }), { status: 200 });
  };
  try {
    await api.browseFolders('/private/tmp/example workspace');
    await api.createWorkProject({ name: 'Example', folderPath: '/private/tmp/example workspace' });
    assert.deepEqual(calls, [
      { route: '/api/folders?path=%2Fprivate%2Ftmp%2Fexample%20workspace', method: 'GET', body: undefined },
      { route: '/api/work-projects', method: 'POST', body: JSON.stringify({ name: 'Example', folderPath: '/private/tmp/example workspace' }) },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

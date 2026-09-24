// Single HTTP boundary shared by every feature.
async function request(path, options) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

export const api = {
  dashboard: () => request('/api/dashboard'),
  browseFolders: (folderPath) => request(`/api/folders${folderPath ? `?path=${encodeURIComponent(folderPath)}` : ''}`),
  providerUsage: (filters = {}) => request('/api/provider-usage', { method: 'POST', body: JSON.stringify(filters) }),
  pickRepository: () => request('/api/repositories/pick', { method: 'POST' }),
  run: (id) => request(`/api/runs/${encodeURIComponent(id)}`),
  runExportUrl: (id) => `/api/runs/${encodeURIComponent(id)}/export`,
  analytics: (filters = {}) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value && value !== 'all'));
    return request(`/api/analytics?${query}`);
  },
  compare: (ids) => request(`/api/compare?ids=${ids.map(encodeURIComponent).join(',')}`),
  createRun: (body) => request('/api/runs', { method: 'POST', body: JSON.stringify(body) }),
  cancelRun: (id) => request(`/api/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  evaluateRun: (id, body) => request(`/api/runs/${encodeURIComponent(id)}/evaluation`, { method: 'POST', body: JSON.stringify(body) }),
  addRepository: (path) => request('/api/repositories', { method: 'POST', body: JSON.stringify({ path }) }),
  createWorkProject: (body) => request('/api/work-projects', { method: 'POST', body: JSON.stringify(body) }),
  addWorkProjectFolder: (id, folderPath) => request(`/api/work-projects/${encodeURIComponent(id)}/folders`, { method: 'POST', body: JSON.stringify({ folderPath }) }),
  removeWorkProjectFolder: (id, folderPath) => request(`/api/work-projects/${encodeURIComponent(id)}/folders`, { method: 'DELETE', body: JSON.stringify({ folderPath }) }),
  removeWorkProject: (id) => request(`/api/work-projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  restoreWorkProjectFolder: (folderPath) => request('/api/work-projects/restore', { method: 'POST', body: JSON.stringify({ folderPath }) }),
  assignWorkProject: (runId, projectId) => request(`/api/runs/${encodeURIComponent(runId)}/work-project`, { method: 'PUT', body: JSON.stringify({ projectId }) }),
  assignWorkProjectRuns: (runIds, projectId) => request('/api/work-projects/assign-runs', { method: 'PUT', body: JSON.stringify({ runIds, projectId }) }),
  syncSessions: () => request('/api/session-sources/sync', { method: 'POST' }),
  pickSessionSourceFolder: () => request('/api/session-sources/pick', { method: 'POST' }),
  addSessionSource: (source) => request('/api/session-sources', { method: 'POST', body: JSON.stringify(source) }),
  removeSessionSource: (source) => request('/api/session-sources', { method: 'DELETE', body: JSON.stringify({ provider: source.provider, format: source.format, root: source.root }) }),
  createExperiment: (body) => request('/api/experiments', { method: 'POST', body: JSON.stringify(body) }),
  experiment: (id) => request(`/api/experiments/${encodeURIComponent(id)}`),
  startExperiment: (id) => request(`/api/experiments/${encodeURIComponent(id)}/run`, { method: 'POST' }),
};

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
  syncSessions: () => request('/api/session-sources/sync', { method: 'POST' }),
  createExperiment: (body) => request('/api/experiments', { method: 'POST', body: JSON.stringify(body) }),
  experiment: (id) => request(`/api/experiments/${encodeURIComponent(id)}`),
  startExperiment: (id) => request(`/api/experiments/${encodeURIComponent(id)}/run`, { method: 'POST' }),
};

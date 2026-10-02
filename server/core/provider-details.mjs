// Provider details are the measurements a source reports beyond the shared
// usage totals: how the work split across models and agents, and the
// provider's own signals. Every adapter fills the same neutral shape, so the
// comparison never reads a provider log format. A field stays null when the
// source did not report it.
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const MODEL_FIELDS = ['requests', 'input', 'output', 'cached', 'cacheWrite', 'reasoning', 'credits', 'premiumRequests', 'costUsd'];
const AGENT_FIELDS = ['requests', 'input', 'output', 'cached', 'cacheWrite', 'credits', 'tokens', 'toolCalls', 'durationMs', 'apiDurationMs'];

const addFields = (entry, patch, fields) => {
  for (const field of fields) if (finite(patch[field])) entry[field] = (entry[field] ?? 0) + patch[field];
  return entry;
};

export function addModelUsage(models, model, patch) {
  const key = typeof model === 'string' && model.trim() ? model.trim() : 'unreported';
  const entry = models.get(key) || { model: key, ...Object.fromEntries(MODEL_FIELDS.map((field) => [field, null])), creditUnit: null };
  addFields(entry, patch, MODEL_FIELDS);
  if (patch.creditUnit) entry.creditUnit = patch.creditUnit;
  models.set(key, entry);
  return entry;
}

export function addAgentUsage(agents, id, patch) {
  const key = String(id || patch.name || 'agent');
  const entry = agents.get(key) || { id: key, name: null, model: null, ...Object.fromEntries(AGENT_FIELDS.map((field) => [field, null])), creditUnit: null, cancelled: null, source: null };
  addFields(entry, patch, AGENT_FIELDS);
  for (const field of ['name', 'model', 'creditUnit', 'source']) if (patch[field]) entry[field] = patch[field];
  if (typeof patch.cancelled === 'boolean') entry.cancelled = patch.cancelled;
  agents.set(key, entry);
  return entry;
}

export const countInto = (counts, key, amount = 1) => {
  if (key == null || key === '') return counts;
  counts[key] = (counts[key] || 0) + amount;
  return counts;
};

const listOf = (value) => value instanceof Map ? [...value.values()] : Array.isArray(value) ? value : [];

// A run that delegated work lists its main agent first, as every provider
// does, so the rows read the same; what the source did not measure stays null.
export function withMainAgent(agents, patch = {}) {
  const list = listOf(agents);
  const main = list.find((agent) => agent.source === 'main-agent');
  if (main) return [main, ...list.filter((agent) => agent !== main)];
  if (!list.some((agent) => agent.source !== 'main-agent')) return list;
  return [addAgentUsage(new Map(), 'main', { name: 'Main agent', ...patch, source: 'main-agent' }), ...list];
}
const sumOf = (items, field) => {
  const known = items.map((item) => item[field]).filter(finite);
  return known.length ? known.reduce((total, value) => total + value, 0) : null;
};

// Builds the stored object; empty collections and unknown values are dropped
// so an absent signal reads as "not reported", never as zero.
export function providerDetails(provider, { models, agents, ...fields } = {}) {
  const modelList = listOf(models).sort((a, b) => ((b.credits ?? -1) - (a.credits ?? -1)) || ((b.input ?? 0) - (a.input ?? 0)));
  const agentList = listOf(agents);
  const result = { provider, models: modelList, agents: agentList, requests: fields.requests ?? sumOf(modelList, 'requests') };
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'requests' || value == null) continue;
    if (Array.isArray(value) && !value.length) continue;
    if (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) continue;
    result[key] = value;
  }
  return modelList.length || agentList.length || Object.keys(result).length > 4 || finite(result.requests) ? result : null;
}

// A subagent log arrives on its own; it joins the agents of its parent run
// instead of replacing the parent.
// Each source reports part of an agent (events its tokens and calls, session
// metrics its credits); the same agent from two sources is one row, field by
// field, and a source that lacks a measurement never erases another's.
export function mergeAgents(current = [], incoming = []) {
  const byId = new Map(current.map((agent) => [agent.id, agent]));
  for (const agent of incoming) {
    const known = byId.get(agent.id) || {};
    const merged = { ...known };
    for (const [field, value] of Object.entries(agent)) if (value != null || !(field in known)) merged[field] = value;
    // The source that measured the agent most fully names its origin.
    merged.source = known.source && agent.source === 'subagent-event' ? known.source : agent.source || known.source;
    byId.set(agent.id, merged);
  }
  return [...byId.values()];
}

import { addModelUsage, providerDetails } from './provider-details.mjs';

const nonNegative = (value) => Number.isFinite(value) && value >= 0 ? value : null;

export const EVENT_TYPES = [
  'agent.started', 'agent.status_changed', 'agent.input', 'agent.output',
  'agent.thinking', 'agent.tool_called', 'agent.tool_completed',
  'agent.file_read', 'agent.file_modified', 'agent.command_started',
  'agent.command_completed', 'agent.usage', 'agent.error',
  'agent.cancelled', 'agent.completed', 'agent.log',
];

function usageOf(raw, provider) {
  const source = raw.usage || raw.message?.usage || raw.data?.usage || null;
  if (!source) return null;
  const details = source.tokenDetails || {};
  const count = (value) => nonNegative(value?.tokenCount ?? value);
  const input = count(source.input_tokens ?? source.inputTokens ?? details.input);
  const output = count(source.output_tokens ?? source.outputTokens ?? details.output);
  const nanoAiu = count(source.totalNanoAiu ?? source.nanoAiu);
  const aiCredits = count(source.totalAiCredits ?? source.aiCredits ?? source.totalPremiumRequestCost);
  const premiumRequests = count(source.totalPremiumRequests ?? source.premiumRequests);
  const cacheWrite = count(source.cache_creation_input_tokens ?? source.cache_write_input_tokens ?? source.cacheWriteTokens ?? details.cache_write ?? details.cacheWrite);
  const credits = aiCredits ?? (nanoAiu == null ? premiumRequests : nanoAiu / 1_000_000_000);
  if (input == null && output == null && credits == null) return null;
  if (provider !== 'copilot' && (input == null || output == null)) return null;
  return {
    input,
    output,
    cached: count(source.cached_input_tokens ?? source.cache_read_input_tokens ?? source.cacheReadTokens ?? details.cache_read ?? details.cacheRead),
    reasoning: nonNegative(source.output_tokens_details?.reasoning_tokens ?? source.reasoningTokens),
    ...(cacheWrite != null ? { cacheWrite } : {}),
    cost: nonNegative(raw.total_cost_usd ?? source.cost_usd ?? source.cost),
    ...(provider === 'copilot' && count(source.total_tokens ?? source.totalTokens) != null
      ? { total: count(source.total_tokens ?? source.totalTokens) } : {}),
    ...(provider === 'copilot' && credits != null ? {
      credits,
      creditUnit: aiCredits != null || nanoAiu != null ? 'AI credits' : 'premium requests',
      creditCoverage: 'session',
    } : {}),
    source: raw.total_cost_usd != null || source.cost_usd != null ? 'provider' : 'tokens',
    provider,
  };
}

// Claude reports a per-model breakdown with its final result.
function modelUsageDetails(raw, provider) {
  if (!raw.modelUsage || typeof raw.modelUsage !== 'object') return null;
  const models = new Map();
  for (const [model, value] of Object.entries(raw.modelUsage)) {
    const read = nonNegative(value?.cacheReadInputTokens);
    const write = nonNegative(value?.cacheCreationInputTokens);
    const input = nonNegative(value?.inputTokens);
    addModelUsage(models, model, {
      input: input == null ? null : input + (read || 0) + (write || 0), output: nonNegative(value?.outputTokens),
      cached: read, cacheWrite: write, reasoning: nonNegative(value?.thinkingTokens), costUsd: nonNegative(value?.costUSD),
    });
  }
  return providerDetails(provider, { models, webSearches: [...models.keys()].length ? Object.values(raw.modelUsage).reduce((total, value) => total + (nonNegative(value?.webSearchRequests) || 0), 0) : null });
}

function safeRaw(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const copy = structuredClone(raw);
  if (copy.data) {
    delete copy.data.reasoningOpaque;
    delete copy.data.encryptedContent;
  }
  return copy;
}

export function normalizeProviderLine(line, provider, channel = 'stdout') {
  let raw;
  try { raw = JSON.parse(line); }
  catch { return { type: 'agent.log', channel, text: line.slice(0, 8000), data: null }; }
  const type = raw.type || '';
  const item = raw.item || {};
  const data = raw.data || {};
  const usage = usageOf(raw, provider);
  const base = { channel, provider, data: safeRaw(raw), usage, providerDetails: modelUsageDetails(raw, provider) };

  if (type === 'turn.completed' || type === 'assistant.usage' || (type === 'result' && raw.usage))
    return { ...base, type: 'agent.usage', text: 'Usage reported by provider' };
  if (type === 'turn.failed' || type === 'error' || raw.is_error)
    return { ...base, type: 'agent.error', text: raw.error?.message || raw.message || raw.result || 'Provider reported an error' };
  if (type === 'assistant' && raw.message) {
    const content = Array.isArray(raw.message.content) ? raw.message.content : [];
    const tool = content.find((entry) => entry.type === 'tool_use');
    if (tool) return normalizeToolUse(tool, base);
    return { ...base, type: 'agent.output', text: content.map((entry) => entry.text || '').filter(Boolean).join('\n') };
  }
  if (type === 'user' && Array.isArray(raw.message?.content)) {
    const result = raw.message.content.find((entry) => entry.type === 'tool_result' && entry.tool_use_id);
    if (result) return { ...base, type: 'agent.tool_completed', callId: String(result.tool_use_id), status: result.is_error ? 'failed' : 'completed', text: result.is_error ? 'Tool failed' : 'Tool finished' };
  }
  if (type === 'assistant.message')
    return { ...base, type: 'agent.output', text: String(data.content || '') };
  if (type.startsWith('tool.execution'))
    return { ...base, type: type.endsWith('complete') ? 'agent.tool_completed' : 'agent.tool_called', tool: data.toolName || 'tool', text: String(data.result?.content || data.toolName || type) };
  if (type.startsWith('item.')) return normalizeCodexItem(type, item, base);
  if (EVENT_TYPES.includes(type)) return { ...base, type, text: String(raw.text || type), tool: raw.tool || null, path: raw.path || null, command: raw.command || null };
  return { ...base, type: 'agent.log', text: String(raw.message || raw.text || type || line).slice(0, 8000) };
}

function normalizeToolUse(tool, base) {
  const name = tool.name || 'tool';
  const input = tool.input || {};
  base = tool.id ? { ...base, callId: String(tool.id) } : base;
  const path = input.file_path || input.path || null;
  const command = input.command || null;
  if (path) return { ...base, type: /write|edit|patch/i.test(name) ? 'agent.file_modified' : 'agent.file_read', tool: name, path, text: `${name} ${path}` };
  if (command) return { ...base, type: 'agent.command_started', tool: name, command, text: command };
  return { ...base, type: 'agent.tool_called', tool: name, text: name };
}

function normalizeCodexItem(eventType, item, base) {
  const completed = eventType.endsWith('completed');
  if (item.type === 'agent_message') return { ...base, type: 'agent.output', text: String(item.text || '') };
  if (item.type === 'reasoning' || item.type === 'plan') return { ...base, type: 'agent.thinking', text: String(item.text || item.type) };
  if (item.id) base = { ...base, callId: String(item.id) };
  if (item.type === 'command_execution') return { ...base, type: completed ? 'agent.command_completed' : 'agent.command_started', command: item.command || '', exitCode: item.exit_code ?? null, text: item.aggregated_output || item.command || '' };
  if (item.type === 'file_change') {
    const change = item.changes?.[0] || {};
    return { ...base, type: 'agent.file_modified', path: change.path || item.path || null, text: JSON.stringify(item.changes || []) };
  }
  if (item.type === 'mcp_tool_call' || item.type === 'web_search') return { ...base, type: completed ? 'agent.tool_completed' : 'agent.tool_called', tool: item.tool || item.type, text: item.query || item.tool || item.type };
  return { ...base, type: 'agent.log', text: String(item.text || item.type || eventType) };
}

export function publicEvent(row) {
  return {
    id: row.id,
    runId: row.run_id,
    timestamp: row.timestamp,
    type: row.type,
    provider: row.provider,
    data: JSON.parse(row.data),
  };
}

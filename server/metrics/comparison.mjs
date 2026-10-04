import { activeOffsets, isUserAction, MAX_WORK_GAP_MS, mergeIntervals, normalizeEvents, timingFromEvents } from '../core/timing.mjs';
import { compareRuns } from './analytics.mjs';
import { commandCategory, eventActivity, validFileEvent } from './observability.mjs';

// Instruction and memory files are recognised by their conventional names, so
// a run that read CLAUDE.md, AGENTS.md or a memory folder can be told apart
// from one that worked without them.
const MEMORY_FILE = /(?:^|[\\/])(?:CLAUDE(?:\.local)?\.md|AGENTS(?:\.override)?\.md|GEMINI\.md|MEMORY\.md|copilot-instructions\.md|[^\\/]+\.instructions\.md|\.cursorrules|\.windsurfrules)$|[\\/]\.?memor(?:y|ies)[\\/]/i;
export const isMemoryPath = (value) => MEMORY_FILE.test(String(value || ''));

export const TOOL_CATEGORIES = ['read', 'search', 'edit', 'shell', 'web', 'mcp', 'subagent', 'planning', 'memory', 'other'];
const NAMED_CATEGORIES = [
  ['memory', /memory/i],
  ['mcp', /^mcp(?:__|[_:])/i],
  ['subagent', /^(?:task|agent|subagent|runsubagent|delegate)$/i],
  ['planning', /todo|plan|^task[a-z]/i],
  ['web', /web|fetch|browser|navigate|http|url/i],
];
const GENERIC_CATEGORIES = [
  ['edit', /write|edit|patch|create|replace|notebook|insert/i],
  ['search', /grep|glob|search|find|list|^ls$|codebase/i],
  ['read', /read|view|^cat$|open/i],
  ['shell', /bash|shell|exec|terminal|command|^run/i],
];

// Tool families are a presentation-neutral grouping of the normalised tool
// name and event type; an unrecognised tool stays 'other'.
export function toolCategory(name = '', type = '') {
  const named = NAMED_CATEGORIES.find(([, pattern]) => pattern.test(name))?.[0];
  if (named) return named;
  const generic = GENERIC_CATEGORIES.find(([, pattern]) => pattern.test(name))?.[0];
  if (type === 'agent.file_modified') return 'edit';
  if (type.startsWith('agent.command')) return 'shell';
  if (type === 'agent.file_read') return generic === 'search' ? 'search' : 'read';
  return generic || 'other';
}

export const EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

const finite = Number.isFinite;
const ratio = (value, base) => finite(value) && finite(base) && base > 0 ? value / base : null;
const largest = (values) => { const known = values.filter(finite); return known.length ? Math.max(...known) : null; };
const sample = (points, limit = 160) => points.length <= limit ? points
  : Array.from({ length: limit }, (_, index) => points[Math.round(index * (points.length - 1) / (limit - 1))]);
// The adapters mark the start of every turn with this placeholder; it is not
// a reasoning step the model reported.
const PLACEHOLDER_THINKING = 'Preparing response';
const isToolCall = (event) => !event.type.endsWith('completed') && !event.data?.inferred
  && Boolean(event.data?.tool || event.data?.command);
const toolName = (data) => data.tool || (data.command ? 'shell' : null);

// What the event stream itself says about each agent, for every provider:
// events tagged with a subagent belong to it, the rest to the main agent. Its
// tool calls are counted and its working intervals are the gaps between its
// own events, under the same work-gap rule as the session.
function agentActivity(events) {
  const byAgent = new Map();
  for (const event of events) {
    const key = event.data?.agent || 'main';
    const at = Date.parse(event.timestamp || '');
    const entry = byAgent.get(key) || { calls: 0, intervals: [], last: null };
    if (isToolCall(event)) entry.calls++;
    if (Number.isFinite(at)) {
      if (entry.last != null && at > entry.last && at - entry.last <= MAX_WORK_GAP_MS && !isUserAction(event)) entry.intervals.push([entry.last, at]);
      entry.last = at;
    }
    byAgent.set(key, entry);
  }
  return byAgent;
}

const length = (intervals) => mergeIntervals(intervals).reduce((sum, [start, end]) => sum + end - start, 0);
const minus = (intervals, removed) => mergeIntervals(intervals).flatMap(([start, end]) => {
  const parts = [];
  let cursor = start;
  for (const [a, b] of removed) {
    if (b <= cursor || a >= end) continue;
    if (a > cursor) parts.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < end) parts.push([cursor, end]);
  return parts;
});

// Fills what an agent's own sources left unreported, and keeps every agent's
// time within the run's. The main agent's own time leaves out the stretches
// its subagents were working; when those cannot be placed in time, its time
// is the run's and is flagged as including them.
function completeAgents(agents, events, activeMs) {
  if (!agents.length) return agents;
  const activity = agentActivity(events);
  const tagged = [...activity.keys()].some((key) => key !== 'main');
  const subagentIntervals = mergeIntervals([...activity].filter(([key]) => key !== 'main').flatMap(([, entry]) => entry.intervals));
  const hasSubagents = agents.some((agent) => agent.source !== 'main-agent');
  const cap = (value) => Number.isFinite(value) && Number.isFinite(activeMs) ? Math.min(value, activeMs) : value;
  return agents.map((agent) => {
    const main = agent.source === 'main-agent';
    const own = activity.get(main ? 'main' : agent.id);
    if (main) {
      const separated = subagentIntervals.length > 0;
      const ownMs = own && separated ? length(minus(own.intervals, subagentIntervals)) : null;
      return {
        ...agent,
        toolCalls: agent.toolCalls ?? (own && (tagged || !hasSubagents) ? own.calls : null),
        durationMs: separated ? cap(ownMs || null) : cap(hasSubagents ? activeMs : agent.durationMs ?? activeMs),
        durationIncludesSubagents: hasSubagents && !separated,
      };
    }
    return {
      ...agent,
      toolCalls: agent.toolCalls ?? own?.calls ?? null,
      durationMs: cap(agent.durationMs ?? (own ? length(own.intervals) || null : null)),
    };
  });
}

// A comparison profile is everything the comparison screen needs about one
// run, derived only from its normalised events and stored usage. Anything the
// source did not report stays null.
export function comparisonProfile(detail, { source = 'local', importInfo = null, annotation = null } = {}) {
  const run = detail.run;
  const events = normalizeEvents(detail.events || []);
  const timing = detail.timing || timingFromEvents(events);
  const activity = detail.files && detail.tools ? detail : { ...detail, ...eventActivity(events) };
  const [base] = compareRuns([{ ...run, files: activity.files, tools: activity.tools }]);
  const offsets = activeOffsets(events);

  const eventMix = {};
  const tools = new Map();
  const categories = Object.fromEntries(TOOL_CATEGORIES.map((category) => [category, 0]));
  const memory = new Map();
  const efforts = [], summaries = [], compactions = [];
  const series = [];
  let input = null, output = null, total = null, cost = null, context = null, calls = 0;
  let userActions = 0, errors = 0, failedCommands = 0, thinkingSteps = 0, outputs = 0;
  const addMemory = (key, patch) => {
    const entry = memory.get(key) || { path: key, reads: 0, writes: 0, calls: 0, injected: false };
    for (const [field, value] of Object.entries(patch)) entry[field] = typeof value === 'number' ? entry[field] + value : value;
    memory.set(key, entry);
  };

  for (const [index, event] of events.entries()) {
    const data = event.data || {};
    const usage = data.usage || {};
    eventMix[event.type] = (eventMix[event.type] || 0) + 1;
    if (isUserAction(event)) userActions++;
    if (event.type === 'agent.error') errors++;
    if (event.type === 'agent.output') outputs++;
    if (event.type === 'agent.thinking' && data.text !== PLACEHOLDER_THINKING) thinkingSteps++;
    if (event.type === 'agent.command_completed' && finite(data.exitCode) && data.exitCode !== 0) failedCommands++;
    if (data.modelSettings?.effort && efforts.at(-1) !== data.modelSettings.effort) efforts.push(data.modelSettings.effort);
    if (data.modelSettings?.reasoningSummary && !summaries.includes(data.modelSettings.reasoningSummary)) summaries.push(data.modelSettings.reasoningSummary);
    if (data.compaction) compactions.push({ at: event.timestamp, trigger: data.compaction.trigger || null, preTokens: finite(data.compaction.preTokens) ? data.compaction.preTokens : null });
    if (data.memory?.path) addMemory(data.memory.path, { injected: true });
    if (validFileEvent(event) && isMemoryPath(data.path)) addMemory(data.path, event.type === 'agent.file_modified' ? { writes: 1 } : { reads: 1 });

    const name = toolName(data);
    let changed = false;
    if (name && isToolCall(event)) {
      const category = toolCategory(name, event.type);
      const entry = tools.get(name) || { name, category, count: 0, failures: 0 };
      entry.count++;
      tools.set(name, entry);
      categories[category]++;
      calls++;
      changed = true;
      if (category === 'memory') addMemory(name, { calls: 1 });
    }
    if (name && event.type.endsWith('completed') && finite(data.exitCode) && data.exitCode !== 0 && tools.has(name)) tools.get(name).failures++;

    if (finite(usage.input)) { if (usage.input !== input) { input = usage.input; changed = true; } }
    else if (finite(data.tokensDelta)) { input = (input ?? 0) + data.tokensDelta; changed = true; }
    if (finite(usage.output) && usage.output !== output) { output = usage.output; changed = true; }
    const nextTotal = input != null && output != null ? input + output : finite(usage.total) ? usage.total : total;
    if (nextTotal !== total) { total = nextTotal; changed = true; }
    if (finite(usage.cost)) { if (usage.cost !== cost) { cost = usage.cost; changed = true; } }
    else if (finite(data.costDelta)) { cost = (cost ?? 0) + data.costDelta; changed = true; }
    if (finite(usage.contextTokens) && usage.contextTokens !== context) { context = usage.contextTokens; changed = true; }
    if (changed && offsets[index] != null) {
      const point = { t: offsets[index], tokens: total ?? input, cost, context, tools: calls };
      if (series.at(-1)?.t === point.t) series[series.length - 1] = point; else series.push(point);
    }
  }

  const files = activity.files || [];
  const fileReads = files.reduce((sum, file) => sum + file.reads, 0);
  const fileWrites = files.reduce((sum, file) => sum + file.writes, 0);
  const commands = (activity.commands || []).map((command) => ({ ...command, category: commandCategory(command.name) }));
  const turns = timing.turnCount ?? timing.turns?.length ?? null;
  const contextPeak = largest([...events.map((event) => event.data?.usage?.contextTokens), run.usage?.contextTokens]);
  const contextWindow = largest([...events.map((event) => event.data?.usage?.contextWindowTokens), run.usage?.contextWindowTokens]);
  const { metrics } = base;
  const details = run.providerDetails && typeof run.providerDetails === 'object' ? run.providerDetails : null;
  const requests = finite(details?.requests) ? details.requests : null;
  const usage = run.usage || {};
  const cacheWrite = finite(usage.cacheWrite) ? usage.cacheWrite : null;
  const reasoning = metrics.reasoningTokens;
  // Every adapter counts cache reads and writes inside input and reasoning
  // inside output, so the parts add up to the total exactly.
  const composition = finite(metrics.inputTokens) && finite(metrics.outputTokens) ? {
    uncachedInput: Math.max(0, metrics.inputTokens - (metrics.cachedTokens || 0) - (cacheWrite || 0)),
    cacheRead: metrics.cachedTokens ?? 0,
    cacheWrite: cacheWrite ?? 0,
    output: Math.max(0, metrics.outputTokens - (reasoning || 0)),
    reasoning: reasoning ?? 0,
    known: { cacheRead: finite(metrics.cachedTokens), cacheWrite: cacheWrite != null, reasoning: finite(reasoning) },
  } : null;
  const agents = completeAgents(Array.isArray(details?.agents) ? details.agents : [], events, metrics.durationMs);
  const agentTokens = (agent) => finite(agent.tokens) ? agent.tokens : finite(agent.input) || finite(agent.output) ? (agent.input || 0) + (agent.output || 0) : null;
  const subagentTokens = agents.filter((agent) => agent.source !== 'main-agent').map(agentTokens).filter(finite);
  const largestOf = (...values) => values.some(finite) ? Math.max(...values.filter(finite)) : null;
  const measuredTokens = metrics.totalTokens ?? metrics.observedTokens;
  const snapshot = run.contextSnapshot || {};

  return {
    ...base,
    key: source === 'imported' ? `import:${importInfo?.id}` : run.id,
    source,
    importInfo,
    prompt: typeof run.prompt === 'string' && run.prompt ? run.prompt.slice(0, 4000) : null,
    run: { ...base.run, endedAt: run.endedAt || null, origin: run.origin || null, branch: snapshot.repository?.branch || null, headSha: snapshot.repository?.headSha || null },
    conditions: {
      effort: efforts.length ? efforts : null,
      reasoningSummary: summaries.length ? summaries : null,
      declaredEffort: annotation?.effort || null,
      note: annotation?.note || null,
      contextStrategy: snapshot.strategy || null,
      contextItems: (snapshot.items || []).map((item) => ({ type: item.type || null, name: item.name || null, sha256: item.sha256 || null, characters: typeof item.content === 'string' ? item.content.length : null })),
      reproducible: typeof snapshot.reproducible === 'boolean' ? snapshot.reproducible : null,
      unavailable: snapshot.unavailable || [],
      permissions: run.permissions || null,
      usageScope: run.usageScope || null,
    },
    context: {
      peakTokens: contextPeak,
      lastTokens: finite(run.usage?.contextTokens) ? run.usage.contextTokens : context,
      windowTokens: contextWindow,
      peakUtilization: ratio(contextPeak, contextWindow),
      compactions,
    },
    memory: [...memory.values()].sort((a, b) => a.path.localeCompare(b.path)),
    activity: {
      events: events.length, userActions, turns, outputs, thinkingSteps, errors, failedCommands,
      warnings: (activity.warnings || []).length,
      toolCalls: calls, uniqueTools: tools.size,
      commandCalls: commands.reduce((sum, command) => sum + command.count, 0),
      subagentCalls: categories.subagent,
      fileReads, fileWrites, uniqueFiles: files.length,
      filesRead: files.filter((file) => file.reads > 0).length,
      filesModified: files.filter((file) => file.writes > 0).length,
      repeatedReads: files.reduce((sum, file) => sum + Math.max(0, file.reads - 1), 0),
    },
    providerDetails: details,
    models: Array.isArray(details?.models) ? details.models : [],
    agents,
    usageDetail: {
      requests, cacheWrite, composition,
      subagentTokens: subagentTokens.length ? subagentTokens.reduce((sum, value) => sum + value, 0) : null,
      inputPerRequest: ratio(metrics.inputTokens, requests),
      outputPerRequest: ratio(metrics.outputTokens, requests),
      creditsPerRequest: ratio(metrics.providerCredits, requests),
      failedTools: finite(details?.failedTools) ? details.failedTools : null,
      apiErrors: finite(details?.apiErrors) ? details.apiErrors : null,
      failedCommands: largestOf(details?.failedCommands, events.length ? failedCommands : null),
    },
    efficiency: {
      tokensPerTurn: ratio(measuredTokens, turns),
      costPerTurn: ratio(metrics.costUsd, turns),
      tokensPerToolCall: ratio(measuredTokens, calls),
      toolCallsPerTurn: ratio(calls, turns),
      averageTurnMs: ratio(metrics.durationMs, timing.turns?.filter((turn) => finite(turn.durationMs)).length),
      outputShare: ratio(metrics.outputTokens, metrics.totalTokens),
      readsPerWrite: ratio(fileReads, fileWrites),
    },
    eventMix,
    toolCategories: categories,
    toolBreakdown: [...tools.values()].sort((a, b) => b.count - a.count),
    commandBreakdown: commands,
    series: sample(series),
  };
}

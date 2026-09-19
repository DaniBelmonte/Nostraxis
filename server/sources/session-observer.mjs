import { createHash } from 'node:crypto';
import { open, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectCopilotOtel } from './copilot-otel.mjs';
import { applyVscodeChatRecord, buildVscodeCopilotSnapshot, defaultVscodeChatRoots } from './vscode-copilot-chat.mjs';
import { toIsoTimestamp } from '../core/timing.mjs';

const MAX_RESPONSE = 250_000;
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const textOf = (value) => typeof value === 'string'
  ? value
  : Array.isArray(value)
    ? value.filter((block) => ['text', 'input_text', 'output_text'].includes(block?.type)).map((block) => block.text || '').join('\n')
    : '';
const short = (value, length = 240) => textOf(value).replace(/\s+/g, ' ').trim().slice(0, length);
// Codex writes epoch seconds, Claude and Copilot ISO strings. Everything the
// dashboard stores is ISO-8601 so the timeline can be ordered and measured.
const atOf = (event, payload, fallback) => toIsoTimestamp(event.timestamp || payload.timestamp, fallback);
export const promptText = value => {
  const text = textOf(value).replace(/<recommended_plugins>[\s\S]*?<\/recommended_plugins>/g, '').trim();
  // Codex auto-review wraps the original user request in an untrusted evidence
  // envelope. The dashboard should identify the actual first user request, not
  // the envelope that instructs the reviewer how to handle it.
  const transcript = text.match(/>{0,3}\s*TRANSCRIPT START\s*\n\s*\[1\]\s+user:\s*([\s\S]*?)(?=\n\s*\[\d+\]\s+(?:user|assistant|tool)\s*:|\n\s*>{0,3}\s*TRANSCRIPT END|$)/i);
  if (transcript?.[1]?.trim()) return transcript[1].trim();
  if (/^(# AGENTS\.md|<environment_context>|<permissions|<instructions>|<in-app-browser-context)/.test(text)) return '';
  return text;
};

export function observedSessionId(provider, nativeId) {
  return `external-${createHash('sha256').update(`${provider}:${nativeId}`).digest('hex').slice(0, 24)}`;
}

export function newObservedSession(provider, filename, now = Date.now()) {
  return {
    provider, filename, nativeId: '', workspace: '', model: '', title: '', task: '', response: '',
    initialPrompt: '', reportedUserMessage: '', status: 'idle', startedAt: new Date(now).toISOString(), lastEventAt: null, endedAt: null,
    usage: null, usageScope: 'unavailable', messages: new Map(), subagentUsage: new Map(), events: [], clipped: false,
  };
}

function usageFrom(value, includeCache = false) {
  if (!value || !finite(value.input_tokens) || !finite(value.output_tokens)) return null;
  const cached = value.cached_input_tokens ?? value.cache_read_input_tokens ?? 0;
  return {
    input: value.input_tokens + (includeCache ? cached + (value.cache_creation_input_tokens || 0) : 0),
    output: value.output_tokens,
    cached,
    reasoning: finite(value.reasoning_output_tokens) ? value.reasoning_output_tokens : null,
    cost: null,
    source: 'provider-log',
    costSource: null,
  };
}

const copilotCount = (value) => finite(value) ? value : finite(value?.tokenCount) ? value.tokenCount : null;

function copilotCredits(payload) {
  const nanoAiu = copilotCount(payload?.totalNanoAiu ?? payload?.nanoAiu);
  if (nanoAiu !== null) return { value: nanoAiu / 1_000_000_000, unit: 'AI credits' };
  for (const value of [payload?.totalAiCredits, payload?.aiCredits, payload?.totalPremiumRequestCost]) {
    if (finite(value)) return { value, unit: 'AI credits' };
  }
  const premiumRequests = payload?.totalPremiumRequests ?? payload?.premiumRequests;
  return finite(premiumRequests) ? { value: premiumRequests, unit: 'premium requests' } : null;
}

function copilotUsage(session, payload, final = false) {
  const tokenDetails = payload?.tokenDetails;
  const input = tokenDetails ? copilotCount(tokenDetails.input) : null;
  const output = tokenDetails ? copilotCount(tokenDetails.output) : null;
  const cached = tokenDetails ? copilotCount(tokenDetails.cache_read ?? tokenDetails.cacheRead) : null;
  const cacheWrite = tokenDetails ? copilotCount(tokenDetails.cache_write ?? tokenDetails.cacheWrite) : null;
  const modelMetrics = payload?.modelMetrics && typeof payload.modelMetrics === 'object'
    ? Object.values(payload.modelMetrics)
    : [];
  const reasoningValues = modelMetrics.map((metric) => metric?.usage?.reasoningTokens).filter(finite);
  const reasoning = reasoningValues.length ? reasoningValues.reduce((total, value) => total + value, 0) : null;
  const credits = copilotCredits(payload);
  const observedOutput = [...session.messages.values()].reduce((total, item) => total + (finite(item.output) ? item.output : 0), 0);
  const hasObservedOutput = [...session.messages.values()].some((item) => finite(item.output));
  const observedSubagentTokens = [...session.subagentUsage.values()].reduce((total, value) => total + (finite(value) ? value : 0), 0);
  const hasObservedSubagentTokens = [...session.subagentUsage.values()].some(finite);
  const previous = session.usage || {};
  if (input === null && output === null && credits === null && reasoning === null && !hasObservedOutput && !hasObservedSubagentTokens) return null;
  return {
    input: input === null ? (finite(previous.input) ? previous.input : null) : input + (cached || 0) + (cacheWrite || 0),
    output: output === null ? (finite(previous.output) ? previous.output : hasObservedOutput ? observedOutput : null) : output,
    cached: cached === null ? (finite(previous.cached) ? previous.cached : null) : cached,
    reasoning: reasoning === null ? (finite(previous.reasoning) ? previous.reasoning : null) : reasoning,
    cost: null,
    credits: credits === null ? (finite(previous.credits) ? previous.credits : null) : credits.value,
    creditUnit: credits?.unit || previous.creditUnit || null,
    creditCoverage: credits ? 'session' : (previous.creditCoverage || null),
    observedTokens: hasObservedSubagentTokens ? observedSubagentTokens : (finite(previous.observedTokens) ? previous.observedTokens : null),
    observedTokenScope: hasObservedSubagentTokens ? 'subagents' : (previous.observedTokenScope || null),
    source: final ? 'provider-log' : 'provider-log-live',
    costSource: null,
  };
}

function appendResponse(session, value, replace = false) {
  const text = textOf(value).trim();
  if (!text) return;
  session.response = (replace ? text : `${session.response}\n${text}`.trim()).slice(-MAX_RESPONSE);
}

function record(session, type, at, data = {}) {
  session.lastEventAt = at;
  session.events.push({ type, timestamp: at, data });
}

function started(session, at) {
  session.status = 'running';
  session.endedAt = null;
  record(session, 'agent.thinking', at, { text: 'Preparing response' });
}

function completed(session, at, text = 'Turn completed') {
  session.status = 'completed';
  session.endedAt = at;
  record(session, 'agent.completed', at, { text });
}

function failed(session, at, text) {
  session.status = 'failed';
  session.endedAt = at;
  record(session, 'agent.error', at, { text });
}

function tool(session, name, inputValue, at) {
  let input = inputValue || {};
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { input = {}; }
  }
  const toolName = name || 'tool';
  const command = typeof input.command === 'string' ? input.command : typeof input.cmd === 'string' ? input.cmd : '';
  const file = input.file_path || input.path || input.file;
  const isWrite = /write|edit|patch|create/i.test(toolName);
  const isRead = /read|search|glob|grep|find|list/i.test(toolName);
  const type = command ? 'agent.command_started' : file ? (isWrite ? 'agent.file_modified' : 'agent.file_read') : 'agent.tool_started';
  record(session, type, at, {
    text: command || `${toolName}${file ? ` · ${file}` : ''}`,
    tool: toolName,
    command: command || null,
    path: typeof file === 'string' ? file : null,
    access: isWrite ? 'write' : isRead ? 'read' : 'unknown',
  });
  if (command) {
    // Only explicit operands of simple file-reading commands; no shell execution.
    for (const match of command.matchAll(/(?:^|&&|;|\|)\s*(?:cat|head|tail)\s+([^;&|\n]+)/g)) {
      if (/[<>]/.test(match[1])) continue;
      const operands = match[1].match(/"[^"]*"|'[^']*'|\S+/g) || [];
      for (const operand of operands.filter(p => !p.startsWith('-') && !/^\d+$/.test(p))) {
        const filePath = operand.replace(/^['"]|['"]$/g, '');
        if (!/[$*<>]/.test(filePath)) record(session, 'agent.file_read', at, { path: filePath, text: filePath, inferred: true, source: 'command-operand' });
      }
    }
  }
}

// Only user-visible messages, tool metadata and reported usage are retained.
// System prompts and hidden reasoning payloads are intentionally excluded.
export function consumeObservedEvent(session, event) {
  const payload = event.payload || event.data || {};
  const at = atOf(event, payload, session.lastEventAt || session.startedAt);
  if (!Number.isFinite(Date.parse(at))) return;
  if (Date.parse(at) < Date.parse(session.startedAt)) session.startedAt = at;

  if (session.provider === 'codex') {
    if (event.type === 'session_meta') {
      session.nativeId = payload.id || payload.session_id || session.nativeId;
      session.workspace = payload.cwd || session.workspace;
      session.startedAt = toIsoTimestamp(payload.timestamp, at);
    }
    if (event.type === 'turn_context') {
      session.model = payload.model || session.model;
      session.workspace = payload.cwd || session.workspace;
    }
    if (event.type === 'token_usage_record') {
      const usage = usageFrom(payload.thread_token_usage);
      if (usage) { session.usage = usage; session.usageScope = 'session'; record(session, 'agent.usage', at, { text: 'Usage updated', usage }); }
    }
    if (event.type === 'event_msg') {
      if (payload.type === 'task_started') started(session, toIsoTimestamp(payload.started_at, at));
      if (payload.type === 'task_complete') completed(session, toIsoTimestamp(payload.completed_at, at));
      if (payload.type === 'turn_aborted') {
        session.status = 'stopped'; session.endedAt = at;
        record(session, 'agent.cancelled', at, { text: 'Turn interrupted' });
      }
      if (payload.type === 'user_message') {
        session.task = promptText(payload.message);
        session.initialPrompt ||= session.task;
        session.title ||= short(session.task, 80);
        session.reportedUserMessage = session.task;
        record(session, 'agent.input', at, { text: session.task, userAction: true });
      }
      if (payload.type === 'agent_message') {
        appendResponse(session, payload.message, true);
        record(session, 'agent.output', at, { text: textOf(payload.message) || 'Agent response' });
      }
      if (payload.type === 'token_count') {
        const usage = usageFrom(payload.info?.total_token_usage);
        if (usage) { session.usage = usage; session.usageScope = 'session'; record(session, 'agent.usage', at, { text: 'Usage updated', usage }); }
      }
    }
    if (event.type === 'response_item') {
      if (payload.type === 'message' && payload.role === 'user') {
        const prompt = promptText(payload.content);
        if (prompt && !/^\s*<(environment_context|permissions|instructions)/.test(prompt) && !prompt.startsWith('# AGENTS.md')) {
          session.initialPrompt ||= prompt;
          session.title ||= short(prompt, 80);
          session.task = prompt;
          // A response item repeating a message Codex already reported as an
          // event is the transcript copy, not a second user action.
          record(session, 'agent.input', at, { text: prompt, userAction: session.reportedUserMessage !== prompt });
        }
      }
      if (payload.type === 'reasoning') {
        session.status = 'running'; session.endedAt = null;
        record(session, 'agent.thinking', at, { text: 'Reasoning in progress (content not exposed)' });
      }
      if (payload.type === 'function_call' || payload.type === 'custom_tool_call') tool(session, payload.name, payload.arguments || payload.input, at);
      if (payload.type === 'message' && payload.role === 'assistant' && payload.phase === 'final_answer') {
        appendResponse(session, payload.content, true);
        record(session, 'agent.output', at, { text: textOf(payload.content), final: true });
        completed(session, at);
      }
    }
  }

  if (session.provider === 'claude') {
    session.nativeId ||= event.sessionId || '';
    session.workspace = event.cwd || session.workspace;
    if (event.type === 'user' && !event.toolUseResult) {
      const value = typeof event.message?.content === 'string' ? event.message.content : event.message?.content;
      // A sidechain message is a subagent prompt and a meta message is injected
      // by the harness: neither is the person acting on the session.
      const userAction = event.isSidechain !== true && event.isMeta !== true;
      session.task = textOf(value);
      session.initialPrompt ||= session.task;
      session.title ||= short(value, 80);
      record(session, 'agent.input', at, { text: session.task, userAction });
      started(session, at);
    }
    if (event.type === 'assistant') {
      const message = event.message || {};
      session.model = message.model && message.model !== '<synthetic>' ? message.model : session.model;
      const usage = usageFrom(message.usage, true);
      if (usage && message.id) {
        session.messages.set(message.id, usage);
        session.usage = [...session.messages.values()].reduce((total, item) => ({
          input: total.input + item.input,
          output: total.output + item.output,
          cached: total.cached + item.cached,
          reasoning: null, cost: null, source: 'provider-log', costSource: null,
        }), { input: 0, output: 0, cached: 0 });
        session.usageScope = session.clipped ? 'observed' : 'session';
        record(session, 'agent.usage', at, { text: 'Cumulative usage', usage: session.usage });
      }
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (block.type === 'tool_use') tool(session, block.name, block.input, at);
        if (block.type === 'text') {
          appendResponse(session, block.text, true);
          record(session, 'agent.output', at, { text: block.text || 'Agent response' });
        }
      }
      if (message.stop_reason === 'end_turn' || message.stop_reason === 'stop_sequence') completed(session, at);
    }
    if (event.type === 'system' && event.subtype === 'turn_duration') completed(session, at);
    if (event.type === 'result') event.is_error ? failed(session, at, 'The session reported an error') : completed(session, at);
    if (event.type === 'custom-title' && typeof event.customTitle === 'string') session.title = short(event.customTitle, 80);
  }

  if (session.provider === 'copilot') {
    if (event.type === 'session.start') {
      session.nativeId = payload.sessionId || session.nativeId;
      session.workspace = payload.context?.cwd || session.workspace;
      session.model = payload.selectedModel || session.model;
      session.startedAt = toIsoTimestamp(payload.startTime, at);
    }
    if (event.type === 'session.model_change') session.model = payload.newModel || session.model;
    if (event.type === 'user.message') {
      // Copilot delivers subagent prompts as user messages too; only the ones
      // without an agentId come from the person at the terminal.
      const userAction = !event.agentId && !payload.agentId;
      session.task = textOf(payload.content); session.initialPrompt ||= session.task; session.title ||= short(payload.content, 80);
      record(session, 'agent.input', at, { text: session.task, userAction });
    }
    if (event.type === 'assistant.turn_start') started(session, at);
    if (event.type === 'tool.execution_start') tool(session, payload.toolName, payload.arguments, at);
    if (event.type === 'assistant.message') {
      session.model = payload.model || session.model;
      appendResponse(session, payload.content);
      record(session, 'agent.output', at, { text: short(payload.content, 1000) || 'Agent response' });
      if (finite(payload.outputTokens)) {
        const messageId = payload.messageId || payload.requestId || `${at}:${session.messages.size}`;
        session.messages.set(messageId, { output: payload.outputTokens });
        const usage = copilotUsage(session, payload);
        if (usage) {
          session.usage = usage;
          session.usageScope = 'observed';
          record(session, 'agent.usage', at, { text: 'Live output observed', usage });
        }
      }
    }
    if (event.type === 'session.usage_checkpoint') {
      const usage = copilotUsage(session, payload);
      if (usage) {
        session.usage = usage;
        session.usageScope = 'observed';
        record(session, 'agent.usage', at, { text: 'Copilot credits updated', usage });
      }
    }
    if (event.type === 'subagent.completed' && finite(payload.totalTokens)) {
      const usageId = event.id || payload.toolCallId || event.agentId || `${at}:${payload.totalTokens}`;
      session.subagentUsage.set(usageId, payload.totalTokens);
      const usage = copilotUsage(session, payload);
      if (usage) {
        session.usage = usage;
        session.usageScope = 'observed';
        record(session, 'agent.usage', at, {
          text: `Tokens reportados por subagente${payload.agentDisplayName ? ` · ${payload.agentDisplayName}` : ''}`,
          usage,
        });
      }
    }
    if (event.type === 'assistant.turn_end' || event.type === 'session.idle') completed(session, at);
    if (event.type === 'session.error') failed(session, at, 'The session reported an error');
    if (event.type === 'session.shutdown') {
      const usage = copilotUsage(session, payload, true);
      if (usage) {
        session.usage = usage;
        session.usageScope = 'session';
        record(session, 'agent.usage', at, { text: 'Final Copilot usage reported', usage });
      }
      session.model = payload.currentModel || session.model;
      completed(session, at, 'Session completed');
    }
  }
}

export function observedSnapshot(session, now = Date.now()) {
  const stale = session.status === 'running' && (!session.lastEventAt || now - Date.parse(session.lastEventAt) > 300_000);
  const nativeId = session.nativeId || session.filename;
  return {
    id: observedSessionId(session.provider, nativeId),
    nativeSessionId: nativeId,
    provider: session.provider,
    model: session.model,
    name: session.title || `${session.provider} · ${path.basename(session.workspace) || 'Local session'}`,
    prompt: session.initialPrompt || session.task,
    response: session.response,
    repositoryPath: session.workspace,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    updatedAt: session.lastEventAt || session.startedAt,
    status: stale ? 'unknown' : session.status,
    usage: session.usage,
    usageScope: session.usageScope,
    sourcePath: session.filename,
    clipped: session.clipped,
  };
}

export function defaultSessionSources({ copilotTelemetryRoot } = {}) {
  const telemetryRoot = process.env.NOSTRAXIS_COPILOT_OTEL_PATH
    || process.env.COPILOT_OTEL_FILE_EXPORTER_PATH;
  let configured = null;
  if (process.env.NOSTRAXIS_SESSION_ROOTS_JSON) {
    try {
      const value = JSON.parse(process.env.NOSTRAXIS_SESSION_ROOTS_JSON);
      if (Array.isArray(value)) configured = value.filter((item) => item?.provider && item?.root);
    } catch { /* Invalid optional configuration falls back to defaults. */ }
  }
  const sources = configured || [
    { provider: 'codex', root: path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions') },
    { provider: 'claude', root: path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects') },
    { provider: 'copilot', root: path.join(process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot'), 'session-state'), label: 'GitHub Copilot CLI / Agent' },
    ...defaultVscodeChatRoots().map((root) => ({ provider: 'copilot', root, format: 'vscode-chat', label: 'VS Code Copilot Chat' })),
  ];
  for (const root of [copilotTelemetryRoot, telemetryRoot].filter(Boolean)) {
    if (!sources.some((source) => source.format === 'copilot-otel' && path.resolve(source.root) === path.resolve(root))) {
      sources.push({ provider: 'copilot', root, format: 'copilot-otel' });
    }
  }
  return sources;
}

export function createSessionObserver({
  roots = defaultSessionSources(), onUpdate, now = Date.now, intervalMs = 3000,
  maxFiles = Number(process.env.NOSTRAXIS_SESSION_MAX_FILES || 80),
  maxAgeMs = Number(process.env.NOSTRAXIS_SESSION_MAX_AGE_DAYS || 14) * 86_400_000,
} = {}) {
  const tracked = new Map();
  const status = roots.map((item) => ({ ...item, available: false, count: 0, error: null, lastSyncAt: null }));
  let closed = false;
  let pending = null;
  let lastDiscovery = 0;
  let timer;

  async function discover(root, depth = 0, result = [], maxFileAgeMs = maxAgeMs, maxResults = 5000) {
    if (closed || depth > 6 || result.length >= maxResults) return result;
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const filename = path.join(root, entry.name);
      if (entry.isDirectory()) await discover(filename, depth + 1, result, maxFileAgeMs, maxResults);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const fileInfo = await stat(filename).catch(() => null);
        if (fileInfo && (maxFileAgeMs == null || now() - fileInfo.mtimeMs <= maxFileAgeMs)) result.push({ filename, modified: fileInfo.mtimeMs });
      }
    }
    return result;
  }

  function consumeLines(target, buffer, skipFirst = false) {
    const parts = buffer.toString('utf8').split('\n');
    if (skipFirst) parts.shift();
    target.remainder = Buffer.from(parts.pop() || '');
    for (const line of parts) {
      try {
        const record = JSON.parse(line);
        if (target.format === 'copilot-otel') target.otelRecords.push(record);
        else if (target.format === 'vscode-chat') target.vscodeDocument = applyVscodeChatRecord(target.vscodeDocument, record);
        else consumeObservedEvent(target.session, record);
      } catch { /* Unknown records are ignored. */ }
    }
  }

  async function readTarget(target) {
    const info = await stat(target.session.filename);
    if (info.size < target.offset) {
      target.session = newObservedSession(target.session.provider, target.session.filename, now());
      target.otelRecords = [];
      target.otelSignatures.clear();
      target.vscodeDocument = null;
      target.offset = 0; target.remainder = Buffer.alloc(0);
    }
    if (info.size === target.offset) {
      if (target.remainder.length) {
        try {
          const record = JSON.parse(target.remainder.toString('utf8'));
          if (target.format === 'copilot-otel') target.otelRecords.push(record);
          else if (target.format === 'vscode-chat') target.vscodeDocument = applyVscodeChatRecord(target.vscodeDocument, record);
          else consumeObservedEvent(target.session, record);
          target.remainder = Buffer.alloc(0);
          target.skipFirst = false;
        } catch { /* The provider may still be writing the final JSONL record. */ }
      }
      return;
    }
    const file = await open(target.session.filename, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(info.size - target.offset, 4 * 1024 * 1024));
      const chunk = await file.read(buffer, 0, buffer.length, target.offset);
      target.offset += chunk.bytesRead;
      target.session.clipped = target.offset < info.size;
      const raw = Buffer.concat([target.remainder, buffer.subarray(0, chunk.bytesRead)]);
      const lastNewline = raw.lastIndexOf(10);
      if (lastNewline >= 0) {
        consumeLines(target, raw.subarray(0, lastNewline + 1), target.skipFirst);
        target.skipFirst = false;
        target.remainder = raw.subarray(lastNewline + 1);
      } else target.remainder = raw;
      if (target.offset === info.size && target.remainder.length) {
        try {
          const record = JSON.parse(target.remainder.toString('utf8'));
          if (target.format === 'copilot-otel') target.otelRecords.push(record);
          else if (target.format === 'vscode-chat') target.vscodeDocument = applyVscodeChatRecord(target.vscodeDocument, record);
          else consumeObservedEvent(target.session, record);
          target.remainder = Buffer.alloc(0);
          target.skipFirst = false;
        } catch { /* The provider may still be writing the final JSONL record. */ }
      }
    } finally { await file.close(); }
  }

  async function cycle() {
    if (closed) return status;
    if (!lastDiscovery || now() - lastDiscovery >= 15_000) {
      lastDiscovery = now();
      for (const source of status) {
        try {
          const rootInfo = await stat(source.root);
          source.available = rootInfo.isDirectory() || rootInfo.isFile();
          source.error = null;
          const isCopilot = source.provider === 'copilot';
          const discovered = (rootInfo.isFile()
            ? [{ filename: source.root, modified: rootInfo.mtimeMs }]
            : await discover(source.root, 0, [], isCopilot ? null : maxAgeMs, isCopilot ? Infinity : 5000))
            .filter((item) => source.format !== 'vscode-chat' || path.basename(path.dirname(item.filename)) === 'chatSessions')
            .sort((a, b) => b.modified - a.modified);
          const files = isCopilot ? discovered : discovered.slice(0, maxFiles);
          source.count = files.length;
          source.lastSyncAt = new Date(now()).toISOString();
          const sourceId = `${source.provider}:${source.format || 'provider-log'}:${source.root}`;
          for (const { filename } of files) {
            const targetId = `${sourceId}:${filename}`;
            if (tracked.has(targetId)) continue;
            tracked.set(targetId, {
            session: newObservedSession(source.provider, filename, now()), offset: 0,
            remainder: Buffer.alloc(0), signature: '', skipFirst: false,
            sourceId, format: source.format || 'provider-log', otelRecords: [], otelSignatures: new Map(),
            vscodeDocument: null, vscodeImportable: false,
            });
          }
          const keep = new Set(files.map((item) => `${sourceId}:${item.filename}`));
          for (const [targetId, target] of tracked) if (target.sourceId === sourceId && !keep.has(targetId)) tracked.delete(targetId);
        } catch (error) {
          source.available = false; source.count = 0;
          source.error = error?.code === 'ENOENT' ? null : error?.code || 'unavailable';
          source.lastSyncAt = new Date(now()).toISOString();
        }
      }
    }
    for (const target of tracked.values()) {
      try {
        await readTarget(target);
        if (target.format === 'vscode-chat') {
          const result = await buildVscodeCopilotSnapshot(target.vscodeDocument, target.session.filename);
          target.vscodeImportable = Boolean(result);
          if (!result) continue;
          const signature = JSON.stringify(result.snapshot);
          if (signature === target.signature) continue;
          await onUpdate(result.snapshot, result.events);
          target.signature = signature;
          continue;
        }
        if (target.format === 'copilot-otel') {
          for (const summary of collectCopilotOtel(target.otelRecords)) {
            const snapshot = {
              id: observedSessionId('copilot', summary.conversationId),
              nativeSessionId: summary.conversationId,
              provider: 'copilot', model: summary.model || '',
              name: `Copilot · ${summary.conversationId.slice(0, 8)}`,
              prompt: '', response: '', repositoryPath: '',
              startedAt: summary.startedAt || summary.endedAt || new Date(now()).toISOString(),
              endedAt: null, updatedAt: summary.endedAt || summary.startedAt || new Date(now()).toISOString(),
              status: 'unknown', usage: summary.usage, usageScope: 'session',
              activeDurationMs: summary.activeDurationMs,
              sourcePath: target.session.filename, clipped: target.session.clipped,
              sourceKind: 'opentelemetry',
            };
            const signature = JSON.stringify(snapshot);
            if (target.otelSignatures.get(summary.conversationId) === signature) continue;
            target.otelSignatures.set(summary.conversationId, signature);
            await onUpdate(snapshot, [{
              type: 'agent.usage', timestamp: snapshot.updatedAt,
              data: { text: 'Copilot usage updated from OpenTelemetry', usage: snapshot.usage },
            }]);
          }
          continue;
        }
        if (!target.session.nativeId) continue;
        const snapshot = observedSnapshot(target.session, now());
        const signature = JSON.stringify(snapshot);
        if (signature !== target.signature || target.session.events.length) {
          const events = target.session.events.splice(0);
          await onUpdate(snapshot, events);
          target.signature = signature;
        }
      } catch { /* Providers can rotate logs while they are being read. */ }
    }
    for (const source of status.filter((item) => item.format === 'vscode-chat' && item.available)) {
      const sourceId = `${source.provider}:${source.format}:${source.root}`;
      source.count = [...tracked.values()].filter((target) => target.sourceId === sourceId && target.vscodeImportable).length;
    }
    return status;
  }

  const poll = () => pending || (pending = cycle().finally(() => { pending = null; }));
  return {
    poll,
    status: () => status.map((item) => ({ ...item })),
    start() { timer = setInterval(() => void poll(), intervalMs); timer.unref?.(); return poll(); },
    async sync() { lastDiscovery = 0; return poll(); },
    async close() { closed = true; clearInterval(timer); await pending; },
  };
}

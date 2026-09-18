import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isoDate = (value, fallback = null) => {
  const date = typeof value === 'number' ? new Date(value) : new Date(value || '');
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
};
const short = (value, length = 240) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, length);
const observedSessionId = (provider, nativeId) => `external-${createHash('sha256').update(`${provider}:${nativeId}`).digest('hex').slice(0, 24)}`;
const LIVE_ACTIVITY_WINDOW_MS = 5 * 60 * 1000;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function containerAt(root, keys, create = false) {
  let current = root;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (current == null || typeof current !== 'object') return null;
    if (current[key] == null && create) current[key] = typeof keys[index + 1] === 'number' ? [] : {};
    current = current[key];
  }
  return current;
}

// VS Code chatSessions files are append-only journals. Kind 0 initializes the
// document, kind 1 replaces a value at `k`, and kind 2 appends values at `k`.
export function applyVscodeChatRecord(document, record) {
  if (!record || !Number.isInteger(record.kind)) return document;
  if (record.kind === 0 && record.v && typeof record.v === 'object') return clone(record.v);
  if (!document || !Array.isArray(record.k) || !record.k.length) return document;
  const parent = containerAt(document, record.k.slice(0, -1), true);
  if (!parent) return document;
  const key = record.k.at(-1);
  if (record.kind === 1) parent[key] = clone(record.v);
  if (record.kind === 2) {
    if (!Array.isArray(parent[key])) parent[key] = [];
    parent[key].push(...(Array.isArray(record.v) ? clone(record.v) : [clone(record.v)]));
  }
  return document;
}

export function replayVscodeChat(records) {
  return records.reduce((document, record) => applyVscodeChatRecord(document, record), null);
}

function isCopilotRequest(request) {
  const extensionId = request?.agent?.extensionId?.value || request?.agent?.extensionId?._lower || '';
  return String(extensionId).toLowerCase() === 'github.copilot-chat'
    || String(request?.agent?.id || '').toLowerCase().startsWith('github.copilot');
}

export function isVscodeCopilotChat(document) {
  if (!document || !Array.isArray(document.requests)) return false;
  return /github copilot/i.test(document.responderUsername || '')
    || document.requests.some(isCopilotRequest);
}

function visibleResponseText(response) {
  return (Array.isArray(response) ? response : []).flatMap((item) => {
    if (!item || ['thinking', 'toolInvocationSerialized', 'inlineReference'].includes(item.kind)) return [];
    if (typeof item.value === 'string') return [item.value];
    if (typeof item.value?.value === 'string') return [item.value.value];
    return [];
  }).join('').trim();
}

function workspaceDirectoryFromFile(filename) {
  return path.dirname(path.dirname(filename));
}

function localPathFromUri(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'file:') return '';
    return fileURLToPath(url);
  } catch {
    return path.isAbsolute(value) ? value : '';
  }
}

export async function vscodeWorkspacePath(filename) {
  try {
    const metadata = JSON.parse(await readFile(path.join(workspaceDirectoryFromFile(filename), 'workspace.json'), 'utf8'));
    const folder = localPathFromUri(metadata.folder);
    if (folder) return folder;
    const workspace = localPathFromUri(metadata.workspace);
    return workspace ? path.dirname(workspace) : '';
  } catch {
    return '';
  }
}

function usageOf(requests) {
  let hasInput = false;
  let hasOutput = false;
  let hasCredits = false;
  let input = 0;
  let output = 0;
  let credits = 0;
  for (const request of requests) {
    if (finite(request.promptTokens)) { input += request.promptTokens; hasInput = true; }
    if (finite(request.completionTokens)) { output += request.completionTokens; hasOutput = true; }
    if (finite(request.copilotCredits)) { credits += request.copilotCredits; hasCredits = true; }
  }
  if (!hasInput && !hasOutput && !hasCredits) return null;
  return {
    input: hasInput ? input : null,
    output: hasOutput ? output : null,
    cached: null,
    reasoning: null,
    cost: null,
    credits: hasCredits ? Number(credits.toFixed(6)) : null,
    creditUnit: hasCredits ? 'AI credits' : null,
    creditCoverage: hasCredits ? 'session' : null,
    source: 'vscode-chat',
    costSource: null,
  };
}

function requestTimestamp(request, fallback) {
  return isoDate(request?.timestamp, fallback);
}

function responseTimestamp(request, fallback) {
  return isoDate(request?.responseTimestamp, requestTimestamp(request, fallback));
}

export async function buildVscodeCopilotSnapshot(document, filename, fallbackTimestamp = new Date().toISOString()) {
  if (!isVscodeCopilotChat(document)) return null;
  const documentIsCopilot = /github copilot/i.test(document.responderUsername || '');
  const requests = document.requests.filter((request) => request && request.hiddenFromTranscript !== true
    && (documentIsCopilot || isCopilotRequest(request)));
  if (!requests.length) return null;
  const nativeSessionId = String(document.sessionId || path.basename(filename, '.jsonl'));
  const workspace = await vscodeWorkspacePath(filename);
  const firstPrompt = requests.map((request) => request.message?.text).find((value) => typeof value === 'string' && value.trim()) || '';
  const lastResponse = requests.map((request) => visibleResponseText(request.response)).filter(Boolean).at(-1) || '';
  const startedAt = isoDate(document.creationDate, requestTimestamp(requests[0], fallbackTimestamp)) || fallbackTimestamp;
  const updatedAt = requests.map((request) => responseTimestamp(request, startedAt)).filter(Boolean).sort().at(-1) || startedAt;
  const model = [...requests].reverse().map((request) => request.modelId).find((value) => typeof value === 'string' && value)
    || document.inputState?.selectedModel?.identifier || '';
  const usage = usageOf(requests);
  const events = [];
  for (const request of requests) {
    const prompt = typeof request.message?.text === 'string' ? request.message.text.trim() : '';
    const response = visibleResponseText(request.response);
    const inputAt = requestTimestamp(request, startedAt);
    const outputAt = responseTimestamp(request, inputAt);
    if (prompt) events.push({ type: 'agent.input', timestamp: inputAt, data: { text: prompt, source: 'vscode-chat' } });
    if (response) events.push({ type: 'agent.output', timestamp: outputAt, data: { text: response, source: 'vscode-chat' } });
  }
  if (usage) events.push({ type: 'agent.usage', timestamp: updatedAt, data: { text: 'VS Code Copilot Chat usage imported', usage } });
  // VS Code can persist stale pendingRequests after a cancelled or interrupted
  // editor session. Only recent pending activity is evidence of a live run.
  const observedAt = Date.parse(fallbackTimestamp);
  const lastActivityAt = Date.parse(updatedAt);
  const hasFreshPendingRequest = Array.isArray(document.pendingRequests) && document.pendingRequests.length > 0
    && Number.isFinite(observedAt) && Number.isFinite(lastActivityAt)
    && lastActivityAt >= observedAt - LIVE_ACTIVITY_WINDOW_MS;
  const status = hasFreshPendingRequest ? 'running' : lastResponse ? 'completed' : 'stopped';
  events.push({
    type: status === 'running' ? 'agent.activity' : status === 'completed' ? 'agent.completed' : 'agent.stopped',
    timestamp: updatedAt,
    data: { text: status === 'running' ? 'VS Code Copilot Chat is active' : 'VS Code Copilot Chat observed' },
  });
  return {
    snapshot: {
      id: observedSessionId('copilot', nativeSessionId),
      nativeSessionId,
      provider: 'copilot',
      model,
      name: short(document.customTitle || firstPrompt, 80) || `VS Code Copilot · ${nativeSessionId.slice(0, 8)}`,
      prompt: firstPrompt,
      response: lastResponse,
      repositoryPath: workspace,
      startedAt,
      endedAt: status === 'running' ? null : updatedAt,
      updatedAt,
      status,
      usage,
      usageScope: usage ? 'session' : 'unavailable',
      sourcePath: filename,
      clipped: false,
      sourceKind: 'vscode-chat',
    },
    events,
  };
}

export function defaultVscodeChatRoots({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  if (env.NOSTRAXIS_VSCODE_CHAT_ROOTS_JSON) {
    try {
      const roots = JSON.parse(env.NOSTRAXIS_VSCODE_CHAT_ROOTS_JSON);
      if (Array.isArray(roots)) return roots.filter((root) => typeof root === 'string' && root).map((root) => path.resolve(root));
    } catch { /* Invalid optional configuration falls back to platform defaults. */ }
  }
  if (platform === 'darwin') return [
    path.join(home, 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage'),
    path.join(home, 'Library', 'Application Support', 'Code - Insiders', 'User', 'workspaceStorage'),
  ];
  if (platform === 'win32' && env.APPDATA) return [
    path.join(env.APPDATA, 'Code', 'User', 'workspaceStorage'),
    path.join(env.APPDATA, 'Code - Insiders', 'User', 'workspaceStorage'),
  ];
  return [
    path.join(home, '.config', 'Code', 'User', 'workspaceStorage'),
    path.join(home, '.config', 'Code - Insiders', 'User', 'workspaceStorage'),
  ];
}

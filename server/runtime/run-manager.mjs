import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { adapterFor } from '../providers/index.mjs';
import { evaluatorFor } from '../evaluators/index.mjs';
import { materializeContext } from '../experiments/context.mjs';
import { withEstimatedCost } from '../metrics/cost.mjs';
import { activityFor, validFileEvent } from '../metrics/observability.mjs';
import { mergeCopilotUsage, parseCopilotUsageText, readCopilotOtelFile } from '../sources/copilot-otel.mjs';

const MAX_OUTPUT = 250_000;
const MAX_LINE = 1_000_000;
const TIMEOUT_MS = 30 * 60 * 1000;
const COPILOT_INFO_TIMEOUT_MS = 15_000;

function signal(child, value) {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, value);
    else child.kill(value);
  } catch { /* already stopped */ }
}

export function createRunManager({ store, bus, repositories }) {
  const active = new Map();
  const copilotTelemetryDir = path.join(store.dataDir, 'copilot-otel');
  const persist = (run) => { run.updatedAt = new Date().toISOString(); store.saveRun(run); bus.publish({ kind: 'run', run }); };
  const record = (run, entry) => {
    const event = store.insertEvent({
      runId: run.id,
      timestamp: new Date().toISOString(),
      type: entry.type,
      provider: run.provider,
      data: {
        text: entry.text || '', channel: entry.channel || null, tool: entry.tool || null,
        path: entry.path || null, command: entry.command || null, exitCode: entry.exitCode ?? null,
        usage: entry.usage || null, raw: entry.data || null,
      },
    });
    bus.publish({ kind: 'event', event });
    return event;
  };

  async function create(body, options = {}) {
    if (active.size >= 8) throw new Error('Maximum of 8 concurrent runs reached.');
    const adapter = adapterFor(body.provider);
    const repository = repositories.get(body.repositoryId);
    if (!repository) throw new Error('Select a registered repository.');
    const task = String(body.prompt || body.task || '').trim();
    if (!task || task.length > 100_000) throw new Error('Prompt must contain between 1 and 100,000 characters.');
    const contextSnapshot = body.contextSnapshot || materializeContext({
      strategy: body.contextStrategy || 'raw-repo', task,
      promptTemplate: body.promptTemplate || '{{context}}\n\n{{task}}', repository,
      contextItems: body.contextItems || [],
    });
    const now = new Date().toISOString();
    const run = {
      id: randomUUID(), name: String(body.name || `${adapter.name} · ${repository.name}`).slice(0, 100),
      repositoryId: repository.id, repositoryName: repository.name, repositoryPath: repository.path,
      provider: adapter.id, model: String(body.model || ''), status: 'queued',
      prompt: task, response: '', nativeSessionId: null, startedAt: now, endedAt: null,
      updatedAt: now, usage: null, contextSnapshot, evaluation: null,
      permissions: { readFiles: true, modifyFiles: body.allowWrites === true, runCommands: body.allowShell === true },
      experimentId: options.experimentId || body.experimentId || null, demo: false, origin: 'dashboard',
      executable: body.executable, args: Array.isArray(body.args) ? body.args : [],
      evaluator: body.evaluator || null,
    };
    store.saveRun(run);
    record(run, { type: 'agent.started', text: `Run queued for ${adapter.name}` });
    execute(run).catch(() => {});
    return run;
  }

  async function execute(run) {
    const adapter = adapterFor(run.provider);
    let command;
    try {
      command = adapter.build({
        prompt: run.contextSnapshot.renderedPrompt || run.prompt,
        model: run.model, sessionRef: run.nativeSessionId,
        allowWrites: run.permissions.modifyFiles, allowShell: run.permissions.runCommands,
        executable: run.executable, args: run.args,
      });
    } catch (error) {
      finish(run, 'failed', error.message);
      return;
    }
    run.status = 'running';
    persist(run);
    record(run, { type: 'agent.input', text: run.prompt });
    let child;
    let copilotTelemetryFile = null;
    const childEnv = { ...process.env, NO_COLOR: '1', PYTHONUNBUFFERED: '1' };
    if (run.provider === 'copilot') {
      await mkdir(copilotTelemetryDir, { recursive: true, mode: 0o700 });
      copilotTelemetryFile = path.join(copilotTelemetryDir, `${run.id}.jsonl`);
      childEnv.COPILOT_OTEL_ENABLED = 'true';
      childEnv.COPILOT_OTEL_EXPORTER_TYPE = 'file';
      childEnv.COPILOT_OTEL_FILE_EXPORTER_PATH = copilotTelemetryFile;
      // Content capture remains disabled. The dashboard only needs OTel
      // metadata, token counters and AI-unit usage.
      delete childEnv.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT;
    }
    try {
      child = spawn(command.command, command.args, {
        cwd: run.repositoryPath, shell: false, detached: process.platform !== 'win32',
        env: childEnv, stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish(run, 'failed', error.message);
      return;
    }
    active.set(run.id, child);
    const timeout = setTimeout(() => cancel(run.id, 'timeout'), TIMEOUT_MS);
    timeout.unref?.();
    for (const channel of ['stdout', 'stderr']) consumeLines(child[channel], (line) => {
      const entry = adapter.parse(line, channel);
      const sessionRef = adapter.sessionRef?.(entry);
      if (sessionRef) run.nativeSessionId = sessionRef;
      if (entry.type === 'agent.output') run.response = `${run.response || ''}\n${entry.text || ''}`.trim().slice(-MAX_OUTPUT);
      if (entry.usage) run.usage = withEstimatedCost(entry.usage, run.model);
      record(run, entry);
      persist(run);
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(command.stdin || '');
    child.on('error', (error) => finish(run, 'failed', error.message));
    child.on('close', async (code, processSignal) => {
      clearTimeout(timeout);
      active.delete(run.id);
      if (run.status === 'cancelled') return;
      if (run.provider === 'copilot') await updateCopilotUsage(run, adapter, command.command, copilotTelemetryFile, childEnv);
      finish(run, code === 0 ? 'completed' : 'failed', `Process finished with ${code ?? processSignal}`);
    });
  }

  async function updateCopilotUsage(run, adapter, executable, telemetryFile, childEnv) {
    const summaries = telemetryFile ? await readCopilotOtelFile(telemetryFile).catch(() => []) : [];
    const telemetry = summaries.find((item) => item.conversationId === run.nativeSessionId)
      || (summaries.length === 1 ? summaries[0] : null);
    if (telemetry?.conversationId && !run.nativeSessionId) run.nativeSessionId = telemetry.conversationId;
    if (telemetry?.model && !run.model) run.model = telemetry.model;

    let fallback = null;
    if (!telemetry || telemetry.usage.creditCoverage === 'main-agent-only') {
      const usageText = await runCopilotInfoCommand(adapter, executable, run, '/usage', childEnv).catch(() => '');
      fallback = parseCopilotUsageText(usageText, '/usage');
      if (!telemetry && (!fallback || (fallback.input == null && fallback.output == null && fallback.total == null && fallback.contextTokens == null))) {
        const contextText = await runCopilotInfoCommand(adapter, executable, run, '/context', childEnv).catch(() => '');
        fallback = mergeCopilotUsage(fallback, parseCopilotUsageText(contextText, '/context'));
      }
    }
    const usage = mergeCopilotUsage(telemetry?.usage || null, fallback);
    if (!usage) return;
    run.usage = withEstimatedCost(usage, run.model);
    run.usageScope = telemetry ? 'session' : fallback?.input != null && fallback?.output != null ? 'session' : 'observed';
    record(run, {
      type: 'agent.usage',
      text: telemetry ? 'Copilot usage updated from OpenTelemetry' : `Copilot usage updated from ${fallback.source}`,
      usage: run.usage,
    });
    persist(run);
  }

  function runCopilotInfoCommand(adapter, executable, run, prompt, inheritedEnv) {
    if (!run.nativeSessionId) return Promise.resolve('');
    const info = adapter.build({
      prompt, model: run.model, sessionRef: run.nativeSessionId,
      allowWrites: false, allowShell: false,
    });
    const env = { ...inheritedEnv, COPILOT_OTEL_ENABLED: 'false' };
    delete env.COPILOT_OTEL_FILE_EXPORTER_PATH;
    delete env.OTEL_EXPORTER_OTLP_ENDPOINT;
    return new Promise((resolve) => {
      let output = '';
      let settled = false;
      let timer;
      let child;
      const finishInfo = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(output.slice(-1_000_000));
      };
      try {
        child = spawn(executable || info.command, info.args, {
          cwd: run.repositoryPath, shell: false, detached: false,
          env, stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch { finishInfo(); return; }
      for (const stream of [child.stdout, child.stderr]) stream?.on('data', (chunk) => { output += chunk.toString('utf8'); });
      child.on('error', finishInfo);
      child.on('close', finishInfo);
      timer = setTimeout(() => { child.kill('SIGTERM'); finishInfo(); }, COPILOT_INFO_TIMEOUT_MS);
      timer.unref?.();
    });
  }

  function consumeLines(stream, onLine) {
    const decoder = new StringDecoder('utf8');
    let pending = '';
    stream.on('data', (chunk) => {
      pending += decoder.write(chunk);
      let index;
      while ((index = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, index).replace(/\r$/, '');
        pending = pending.slice(index + 1);
        if (line) onLine(line);
      }
      if (pending.length > MAX_LINE) { onLine(pending.slice(0, MAX_LINE)); pending = ''; }
    });
    stream.on('end', () => { pending += decoder.end(); if (pending) onLine(pending); });
  }

  function finish(run, status, text) {
    if (run.endedAt) return;
    active.delete(run.id);
    run.status = status;
    run.endedAt = new Date().toISOString();
    const evaluator = evaluatorFor(run.evaluator?.id || 'manual');
    run.evaluation = evaluator.evaluate(run.response || '', run.evaluator?.config);
    persist(run);
    record(run, { type: status === 'completed' ? 'agent.completed' : 'agent.error', text });
  }

  function cancel(id, reason = 'user') {
    const run = store.getRun(id);
    if (!run) throw new Error('Run not found.');
    if (run.origin === 'external') throw new Error('External sessions are read-only and must be cancelled from their source tool.');
    const child = active.get(id);
    if (!child) return run;
    run.status = 'cancelled'; run.endedAt = new Date().toISOString();
    signal(child, 'SIGTERM'); active.delete(id); persist(run);
    record(run, { type: 'agent.cancelled', text: `Cancelled: ${reason}` });
    return run;
  }

  function evaluate(id, body) {
    const run = store.getRun(id);
    if (!run) throw new Error('Run not found.');
    const score = Number(body.score);
    if (!Number.isFinite(score) || score < 0 || score > 1) throw new Error('Evaluation score must be between 0 and 1.');
    run.evaluation = { evaluatorId: body.evaluatorId || 'manual', score, notes: String(body.notes || ''), source: 'manual', evaluatedAt: new Date().toISOString() };
    persist(run);
    return run;
  }

  function detail(id) {
    const run = store.getRun(id);
    if (!run) throw new Error('Run not found.');
    const events = store.eventsFor(id);
    const fileMap = new Map();
    const toolMap = new Map();
    for (const event of events) {
      const data = event.data || {};
      if (validFileEvent(event)) {
        const found = fileMap.get(data.path) || { path: data.path, reads: 0, writes: 0, lastAt: event.timestamp, tokens: 0 };
        if (event.type === 'agent.file_modified') found.writes++;
        else found.reads++;
        found.tokens += Number(data.tokensDelta || data.usage?.input || 0);
        found.lastAt = event.timestamp;
        fileMap.set(data.path, found);
      }
      const observedTool = data.tool || data.command || (event.type.includes('command') ? data.text : null);
      if (observedTool) {
        const key = observedTool;
        const found = toolMap.get(key) || { name: key, count: 0, failures: 0 };
        if (!event.type.endsWith('completed')) found.count++;
        if (event.type === 'agent.error' || (data.exitCode != null && data.exitCode !== 0)) found.failures++;
        toolMap.set(key, found);
      }
    }
    const activity = activityFor(events);
    return { run, events, commands: activity.commands, warnings: activity.warnings, files: [...fileMap.values()].map(file => ({ ...file, tokens: file.tokens || null, sensitive: activity.warnings.some(w => w.target === file.path) })).sort((a, b) => b.reads + b.writes - a.reads - a.writes), tools: [...toolMap.values()].sort((a, b) => b.count - a.count) };
  }

  return {
    list: () => store.listRuns(), get: (id) => store.getRun(id), detail, create, cancel, evaluate,
    terminate() { for (const child of active.values()) signal(child, 'SIGTERM'); active.clear(); },
  };
}

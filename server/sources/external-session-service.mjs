import { createHash } from 'node:crypto';
import path from 'node:path';
import { createSessionObserver, defaultSessionSources, observedSessionId } from './session-observer.mjs';
import { mergeAgents, withMainAgent } from '../core/provider-details.mjs';
import { mergeCopilotUsage } from './copilot-otel.mjs';
import { withReportedCost } from '../metrics/cost.mjs';
import { timingFromEvents, toIsoTimestamp } from '../core/timing.mjs';

// Context occupancy, call ids and the subagent of an event were added after
// sessions were already stored; leaving them out of the key keeps a re-read
// log from storing those events twice.
const keyData = ({ callId, agent, ...data } = {}) => {
  if (!data.usage) return data;
  const { contextTokens, contextWindowTokens, ...usage } = data.usage;
  return { ...data, usage };
};

const eventKey = (runId, event) => createHash('sha256')
  .update(`${runId}:${toIsoTimestamp(event.timestamp, event.timestamp)}:${event.type}:${JSON.stringify(keyData(event.data || {}))}`)
  .digest('hex')
  .slice(0, 24);

// The parent log measured only its own work, which is the main agent's.
const withAgents = (details, provider, agents, run = {}) => {
  if (!agents.length) return details || null;
  const base = details || { provider, models: [], agents: [], requests: null };
  const usage = run.usage || {};
  return { ...base, agents: withMainAgent(mergeAgents(base.agents, agents), { model: run.model, input: usage.input, output: usage.output, cached: usage.cached, cacheWrite: usage.cacheWrite }) };
};

// A subagent log summarised as one agent of its parent run.
const subagentOf = (snapshot) => ({
  id: String(snapshot.nativeSessionId).split(':').pop(),
  name: snapshot.name || null,
  model: snapshot.model || null,
  requests: snapshot.providerDetails?.requests ?? null,
  input: snapshot.usage?.input ?? null, output: snapshot.usage?.output ?? null,
  cached: snapshot.usage?.cached ?? null, cacheWrite: snapshot.usage?.cacheWrite ?? null,
  tokens: Number.isFinite(snapshot.usage?.input) && Number.isFinite(snapshot.usage?.output) ? snapshot.usage.input + snapshot.usage.output : null,
  source: 'subagent-log',
});

export function createExternalSessionService({ store, bus, repositories, roots, observerOptions = {} }) {
  let imported = 0;
  const subagents = new Map();
  // Subagent events wait for their parent run when its log is read later.
  const pendingEvents = new Map();
  const subagentsOf = (runId, existing) => mergeAgents(
    (existing?.providerDetails?.agents || []).filter((agent) => agent.source === 'subagent-log'),
    [...(subagents.get(runId)?.values() || [])],
  );

  const usageFor = (existing, snapshot) => {
    if (!existing?.usage) return snapshot.usage;
    if (!snapshot.usage) return existing.usage;
    if (snapshot.provider !== 'copilot') return snapshot.usage;
    const incomingOtel = snapshot.usage.source?.includes('opentelemetry');
    const existingOtel = existing.usage.source?.includes('opentelemetry');
    if (incomingOtel) return mergeCopilotUsage(snapshot.usage, existingOtel ? null : existing.usage);
    if (existingOtel) return mergeCopilotUsage(existing.usage, snapshot.usage);
    return snapshot.usage;
  };

  // Observed sessions are timed from their own event stream: the sum of the
  // turns, never the span between the first and the last line of a
  // conversation that may have been resumed days later.
  const applyObservedTiming = (run, snapshot) => {
    const timing = timingFromEvents(store.eventsFor(run.id));
    // OpenTelemetry only reports model spans, so it is the fallback for
    // sessions whose event stream carries no measurable interval.
    run.activeDurationMs = timing.activeMs ?? (Number.isFinite(snapshot?.activeDurationMs) ? snapshot.activeDurationMs : null);
    run.lastTurnDurationMs = timing.lastTurnMs;
    store.saveRun(run);
    return run;
  };

  const saveEvents = (run, events, source) => {
    const known = new Set(store.eventsFor(run.id).map((event) => event.data?.observationKey).filter(Boolean));
    for (const event of events) {
      const key = eventKey(run.id, event);
      if (known.has(key)) continue;
      known.add(key);
      const saved = store.insertEvent({
        runId: run.id,
        timestamp: event.timestamp || run.updatedAt,
        type: event.type || 'agent.log',
        provider: run.provider,
        data: { ...(event.data || {}), source, observationKey: key },
      });
      bus.publish({ kind: 'event', event: saved });
    }
  };

  async function importSession(snapshot, observedEvents) {
    if (snapshot.parentNativeSessionId) {
      const parentId = observedSessionId(snapshot.provider, snapshot.parentNativeSessionId);
      const agents = subagents.get(parentId) || new Map();
      const agent = subagentOf(snapshot);
      agents.set(agent.id, agent);
      subagents.set(parentId, agents);
      // Before subagents joined their parent, a subagent log was its own run.
      if (store.getRun(snapshot.id)) store.deleteRun(snapshot.id);
      const parent = store.getRun(parentId);
      if (!parent) {
        pendingEvents.set(parentId, [...(pendingEvents.get(parentId) || []), ...observedEvents].slice(-5000));
        return null;
      }
      parent.providerDetails = withAgents(parent.providerDetails, parent.provider, subagentsOf(parentId, parent), parent);
      store.saveRun(parent);
      saveEvents(parent, observedEvents, 'external-session-log');
      bus.publish({ kind: 'run', run: parent });
      return parent;
    }
    const managed = store.listRuns().find((run) => run.origin !== 'external'
      && run.provider === snapshot.provider
      && run.nativeSessionId
      && run.nativeSessionId === snapshot.nativeSessionId);
    if (managed) {
      if (store.getRun(snapshot.id)) store.deleteRun(snapshot.id);
      if (snapshot.sourceKind === 'opentelemetry') {
        managed.usage = withReportedCost(usageFor(managed, snapshot));
        managed.usageScope = snapshot.usageScope || managed.usageScope;
        managed.model ||= snapshot.model || '';
        managed.providerDetails = snapshot.providerDetails || managed.providerDetails || null;
        managed.updatedAt = [managed.updatedAt, snapshot.updatedAt].filter(Boolean).sort().at(-1);
        store.saveRun(managed);
        saveEvents(managed, observedEvents, 'copilot-opentelemetry');
        applyObservedTiming(managed, snapshot);
        bus.publish({ kind: 'run', run: managed });
      }
      return managed;
    }

    const existing = store.getRun(snapshot.id);
    const repositoryPath = snapshot.repositoryPath || existing?.repositoryPath || '';
    const repository = await repositories.match(repositoryPath);
    const repositoryName = repository?.name || existing?.repositoryName || (repositoryPath ? path.basename(repositoryPath) : 'No project');
    const preserveExistingContext = snapshot.sourceKind === 'opentelemetry' && existing?.contextSnapshot;
    const run = {
      id: snapshot.id,
      name: snapshot.sourceKind === 'opentelemetry' && existing?.name ? existing.name : snapshot.name,
      repositoryId: repository?.id || existing?.repositoryId || null,
      repositoryName,
      repositoryPath,
      provider: snapshot.provider,
      model: snapshot.model || existing?.model || '',
      status: snapshot.sourceKind === 'opentelemetry' && existing ? existing.status : snapshot.status,
      prompt: snapshot.prompt || existing?.prompt || '',
      response: snapshot.response || existing?.response || '',
      nativeSessionId: snapshot.nativeSessionId,
      startedAt: [existing?.startedAt, snapshot.startedAt].filter(Boolean).sort()[0],
      endedAt: snapshot.endedAt || existing?.endedAt || null,
      updatedAt: [existing?.updatedAt, snapshot.updatedAt].filter(Boolean).sort().at(-1),
      usage: withReportedCost(usageFor(existing, snapshot)),
      usageScope: snapshot.usageScope || existing?.usageScope,
      providerDetails: withAgents(snapshot.providerDetails || existing?.providerDetails || null, snapshot.provider, subagentsOf(snapshot.id, existing), snapshot),
      contextSnapshot: preserveExistingContext || {
        version: 1,
        strategy: 'provider-session-log',
        capturedAt: snapshot.updatedAt,
        repository: repository || { id: null, name: repositoryName, path: repositoryPath, branch: null, headSha: null },
        renderedPrompt: snapshot.prompt || '',
        items: [],
        reproducible: false,
        source: snapshot.sourceKind === 'vscode-chat' ? 'vscode-copilot-chat' : 'external-session-log',
        providerSessionSource: snapshot.sourceKind || null,
        workload: snapshot.workload || null,
        billingProvider: snapshot.billingProvider || null,
        providerMetadata: snapshot.sourceKindMetadata || null,
        clipped: snapshot.clipped,
        unavailable: ['system-prompt', 'full-context', 'hidden-reasoning'],
      },
      evaluation: existing?.evaluation || null,
      permissions: { readFiles: null, modifyFiles: null, runCommands: null },
      experimentId: existing?.experimentId || null,
      demo: false,
      origin: 'external',
      sourcePath: snapshot.sourceKind === 'opentelemetry' && existing?.sourcePath ? existing.sourcePath : snapshot.sourcePath,
      sourceKind: snapshot.sourceKind || existing?.sourceKind || null,
      workload: snapshot.workload || existing?.workload || null,
    };
    store.saveRun(run);

    const additions = [];
    if (!existing) additions.push({
      type: 'agent.observed', timestamp: run.startedAt, data: { text: `External session detected in ${snapshot.provider}` },
    });
    additions.push(...observedEvents);
    const eventSource = snapshot.sourceKind === 'opentelemetry' ? 'copilot-opentelemetry'
      : snapshot.sourceKind === 'vscode-chat' ? 'vscode-copilot-chat'
        : 'external-session-log';
    saveEvents(run, additions, eventSource);
    if (pendingEvents.has(run.id)) {
      saveEvents(run, pendingEvents.get(run.id), eventSource);
      pendingEvents.delete(run.id);
    }
    applyObservedTiming(run, snapshot);
    imported = store.listRuns().filter((item) => item.origin === 'external').length;
    bus.publish({ kind: 'run', run });
    return run;
  }

  const observerRoots = roots || defaultSessionSources({ copilotTelemetryRoot: path.join(store.dataDir, 'copilot-otel') });
  const observer = createSessionObserver({ ...observerOptions, roots: observerRoots, onUpdate: importSession });
  return {
    start: () => observer.start(),
    sync: async () => { await observer.sync(); return { sources: observer.status(), imported }; },
    status: () => ({ sources: observer.status(), imported }),
    close: () => observer.close(),
  };
}

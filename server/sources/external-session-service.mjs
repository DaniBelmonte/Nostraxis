import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createSessionObserver, defaultSessionSources } from './session-observer.mjs';
import { mergeCopilotUsage } from './copilot-otel.mjs';
import { withEstimatedCost } from '../metrics/cost.mjs';
import { timingFromEvents, toIsoTimestamp } from '../core/timing.mjs';

const eventKey = (runId, event) => createHash('sha256')
  .update(`${runId}:${toIsoTimestamp(event.timestamp, event.timestamp)}:${event.type}:${JSON.stringify(event.data || {})}`)
  .digest('hex')
  .slice(0, 24);

export function createExternalSessionService({ store, bus, repositories, roots, observerOptions = {} }) {
  let imported = store.listRuns().filter((item) => item.origin === 'external').length;
  const sourceTypes = new Map([
    ['codex:provider-log', 'Codex history'],
    ['claude:provider-log', 'Claude Code history'],
    ['copilot:provider-log', 'GitHub Copilot CLI / Agent'],
    ['copilot:vscode-chat', 'VS Code Copilot Chat'],
    ['copilot:copilot-otel', 'GitHub Copilot OpenTelemetry'],
    ['hermes:hermes-sqlite', 'Hermes Agent'],
  ]);
  const sourceKey = (item) => `${item.provider}:${item.format || 'provider-log'}:${path.resolve(item.root)}`;
  const baseRoots = roots || defaultSessionSources({ copilotTelemetryRoot: path.join(store.dataDir, 'copilot-otel') });
  const savedCustomRoots = store.setting('sessionSources.custom', []);
  let customRoots = (Array.isArray(savedCustomRoots) ? savedCustomRoots : []).filter((item) => item?.provider && item?.root);
  const allRoots = () => [...baseRoots, ...customRoots];

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
    const managed = store.listRuns().find((run) => run.origin !== 'external'
      && run.provider === snapshot.provider
      && run.nativeSessionId
      && run.nativeSessionId === snapshot.nativeSessionId);
    if (managed) {
      if (store.getRun(snapshot.id)) store.deleteRun(snapshot.id);
      if (snapshot.sourceKind === 'opentelemetry') {
        managed.usage = withEstimatedCost(usageFor(managed, snapshot), snapshot.model || managed.model);
        managed.usageScope = snapshot.usageScope || managed.usageScope;
        managed.model ||= snapshot.model || '';
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
      usage: withEstimatedCost(usageFor(existing, snapshot), snapshot.model || existing?.model),
      usageScope: snapshot.usageScope || existing?.usageScope,
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
    applyObservedTiming(run, snapshot);
    imported = store.listRuns().filter((item) => item.origin === 'external').length;
    bus.publish({ kind: 'run', run });
    return run;
  }

  const observer = createSessionObserver({ ...observerOptions, roots: allRoots(), onUpdate: importSession });
  return {
    start: () => observer.start(),
    sync: async () => { await observer.sync(); return { sources: observer.status(), imported }; },
    status: () => ({ sources: observer.status(), imported }),
    async addSource(input) {
      const provider = String(input?.provider || '').trim();
      const format = String(input?.format || 'provider-log').trim();
      const label = sourceTypes.get(`${provider}:${format}`);
      if (!label) throw new Error('Choose a supported session source type.');
      const requested = String(input?.root || '').trim();
      if (!path.isAbsolute(requested) || path.resolve(requested) === path.parse(requested).root) throw new Error('Choose an absolute session history path.');
      let root;
      try { root = await realpath(requested); }
      catch { throw new Error('Session history path does not exist or cannot be read.'); }
      const info = await stat(root);
      const fileSource = format === 'hermes-sqlite' || format === 'copilot-otel';
      if (fileSource ? !info.isFile() : !info.isDirectory()) throw new Error(fileSource ? 'Select the session history file for this source.' : 'Select a folder containing session history logs.');
      const source = { provider, format, root, label, custom: true };
      if (allRoots().some((item) => sourceKey(item) === sourceKey(source))) throw new Error('This session source is already configured.');
      customRoots = [...customRoots, source];
      store.saveSetting('sessionSources.custom', customRoots);
      await observer.setRoots(allRoots());
      return { source, sources: observer.status(), imported };
    },
    async removeSource(input) {
      const requested = String(input?.root || '').trim();
      if (!path.isAbsolute(requested)) throw new Error('Custom session source not found.');
      const root = await realpath(requested).catch(() => path.resolve(requested));
      const key = sourceKey({ provider: input?.provider || '', format: input?.format || 'provider-log', root });
      if (!customRoots.some((item) => sourceKey(item) === key)) throw new Error('Custom session source not found.');
      customRoots = customRoots.filter((item) => sourceKey(item) !== key);
      store.saveSetting('sessionSources.custom', customRoots);
      await observer.setRoots(allRoots());
      return { sources: observer.status(), imported };
    },
    close: () => observer.close(),
  };
}

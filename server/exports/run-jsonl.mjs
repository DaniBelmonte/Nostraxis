export const runExportSchemaVersion = '1.0';

const finiteOrNull = (value) => Number.isFinite(value) ? value : null;

const eventLabel = (event) => {
  const data = event.data || {};
  return data.text || data.command || data.path || data.tool || null;
};

const durationMs = (run) => {
  const startedAt = Date.parse(run.startedAt || '');
  const endedAt = Date.parse(run.endedAt || '');
  return Number.isFinite(startedAt) && Number.isFinite(endedAt)
    ? Math.max(0, endedAt - startedAt)
    : null;
};

// JSON Lines keeps each observed event independently readable by stream-based
// tools and LLM pipelines, while the first record gives the run its context.
export function buildRunJsonl(detail, { exportedAt = new Date().toISOString() } = {}) {
  const { run, events = [] } = detail;
  const manifest = {
    recordType: 'nostraxis.run-export',
    schemaVersion: runExportSchemaVersion,
    exportedAt,
    format: 'jsonl',
    encoding: 'utf-8',
    eventCount: events.length,
    run: {
      ...run,
      durationMs: durationMs(run),
    },
  };
  const records = [manifest];

  for (const [index, event] of events.entries()) {
    const data = event.data || {};
    const usage = data.usage || {};
    records.push({
      recordType: 'nostraxis.run-event',
      schemaVersion: runExportSchemaVersion,
      sequence: index + 1,
      id: event.id,
      runId: event.runId || run.id,
      timestamp: event.timestamp,
      provider: event.provider || run.provider,
      type: event.type,
      event: eventLabel(event),
      inputTokensCumulative: finiteOrNull(usage.input),
      inputTokensDelta: finiteOrNull(data.tokensDelta),
      outputTokensCumulative: finiteOrNull(usage.output),
      costUsdCumulative: finiteOrNull(usage.cost),
      costUsdDelta: finiteOrNull(data.costDelta),
      usage,
      data,
    });
  }

  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

export function runExportFilename(run) {
  const safeId = String(run.id || 'run').replace(/[^a-zA-Z0-9._-]/g, '_');
  return `nostraxis-full-run-${safeId}.jsonl`;
}

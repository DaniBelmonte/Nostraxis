import { createHash } from 'node:crypto';
import { runExportSchemaVersion } from './run-jsonl.mjs';
import { withReportedCost } from '../metrics/cost.mjs';
import { toIsoTimestamp } from '../core/timing.mjs';

export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;
const MAX_EVENTS = 200_000;
const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : null;
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;

// Reads a full-run JSONL written by another Nostraxis. Only the fields the
// exporter defines are kept, and a cost the exporter priced with its own
// Settings is dropped at this boundary: the comparison prices every run with
// the local prices unless the provider reported the cost.
export function parseRunJsonl(content, { sourceName = null, importedAt = new Date().toISOString() } = {}) {
  if (typeof content !== 'string' || !content.trim()) throw new Error('The file is empty.');
  if (Buffer.byteLength(content) > MAX_IMPORT_BYTES) throw new Error('The file exceeds 64 MB.');
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  let manifest = null;
  const events = [];
  for (const [index, line] of lines.entries()) {
    let record;
    try { record = JSON.parse(line); }
    catch { throw new Error(`Line ${index + 1} is not valid JSON.`); }
    if (index === 0) {
      manifest = record;
      if (manifest?.recordType !== 'nostraxis.run-export') throw new Error('Not a Nostraxis run export: the first line must be its manifest.');
      if (String(manifest.schemaVersion || '').split('.')[0] !== runExportSchemaVersion.split('.')[0]) throw new Error(`Unsupported export schema ${manifest.schemaVersion || 'unknown'}.`);
      if (!object(manifest.run) || !text(manifest.run.provider, 80)) throw new Error('The export manifest has no run.');
      continue;
    }
    if (record?.recordType !== 'nostraxis.run-event' || typeof record.type !== 'string' || !record.type.startsWith('agent.')) continue;
    if (events.length >= MAX_EVENTS) throw new Error(`The export has more than ${MAX_EVENTS} events.`);
    const data = object(record.data) || {};
    events.push({
      id: Number.isFinite(record.sequence) ? record.sequence : events.length + 1,
      timestamp: toIsoTimestamp(record.timestamp, null),
      type: record.type.slice(0, 80),
      provider: text(record.provider, 80) || manifest.run.provider,
      data: data.usage ? { ...data, usage: withReportedCost(data.usage) } : data,
    });
  }
  if (!manifest) throw new Error('The file is empty.');
  const source = manifest.run;
  const run = {
    id: text(source.id, 200) || 'imported-run',
    name: text(source.name, 200) || 'Imported run',
    repositoryName: text(source.repositoryName, 200),
    repositoryPath: text(source.repositoryPath, 1000) || '',
    provider: source.provider.slice(0, 80),
    model: text(source.model, 200) || '',
    status: text(source.status, 40) || 'unknown',
    prompt: text(source.prompt, 250_000) || '',
    response: text(source.response, 250_000),
    startedAt: toIsoTimestamp(source.startedAt, null) || events.find((event) => event.timestamp)?.timestamp || importedAt,
    endedAt: toIsoTimestamp(source.endedAt, null),
    updatedAt: toIsoTimestamp(source.updatedAt, null),
    usage: object(source.usage) ? withReportedCost(source.usage) : null,
    usageScope: text(source.usageScope, 40),
    contextSnapshot: object(source.contextSnapshot) || {},
    evaluation: object(source.evaluation),
    permissions: object(source.permissions),
    origin: text(source.origin, 40),
    sourceKind: text(source.sourceKind, 80),
    workload: text(source.workload, 80),
    exportedDurationMs: Number.isFinite(source.durationMs) ? source.durationMs : null,
    providerDetails: object(source.providerDetails) && Array.isArray(source.providerDetails.models ?? []) ? source.providerDetails : null,
  };
  return {
    // The same file imported twice is one import.
    id: createHash('sha256').update(content).digest('hex').slice(0, 24),
    sourceName: text(sourceName, 260),
    importedAt,
    exportedAt: toIsoTimestamp(manifest.exportedAt, null),
    schemaVersion: String(manifest.schemaVersion),
    run,
    events,
  };
}

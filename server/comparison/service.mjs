import { comparisonProfile, EFFORT_LEVELS } from '../metrics/comparison.mjs';
import { deviationAnalysis } from '../metrics/deviation.mjs';
import { buildSchedule } from '../metrics/schedule.mjs';
import { eventActivity } from '../metrics/observability.mjs';
import { priceEvents, priceRun, pricingFrom } from '../metrics/cost.mjs';
import { normalizeEvents, timingFromEvents } from '../core/timing.mjs';
import { parseRunJsonl } from '../exports/run-import.mjs';

export const ANNOTATIONS_SETTING = 'comparison.annotations';
const IMPORT_PREFIX = 'import:';
const MAX_NOTE = 500;

// Compares local runs and runs imported from other Nostraxis exports. Imports
// live in their own table and never join local sessions or analytics.
// The schedule names subagent lanes after the agents the provider reported.
const withSchedule = (profile, detail) => ({
  ...profile,
  schedule: buildSchedule(detail.events || [], {
    agentNames: Object.fromEntries((detail.run.providerDetails?.agents || []).filter((agent) => agent.name).map((agent) => [agent.id, agent.name])),
  }),
});

export function createComparisonService({ store, runs }) {
  const annotations = () => store.setting(ANNOTATIONS_SETTING, {}) || {};

  const summary = (item) => {
    const run = priceRun(item.run, pricingFrom(store));
    return {
      ...run, id: `${IMPORT_PREFIX}${item.id}`, runId: run.id, imported: true, origin: 'imported',
      importId: item.id, sourceName: item.sourceName, importedAt: item.importedAt, exportedAt: item.exportedAt,
    };
  };

  function importDetail(id) {
    const item = store.getImport(id);
    if (!item) throw new Error('Imported run not found.');
    const pricing = pricingFrom(store);
    const events = normalizeEvents(item.events);
    const run = priceRun(item.run, pricing);
    return { item, detail: { run, events: priceEvents(events, run, pricing), timing: timingFromEvents(events), ...eventActivity(events) } };
  }

  return {
    listImports: () => store.listImports().map(summary),
    importRun({ name, content } = {}) {
      const item = parseRunJsonl(content, { sourceName: typeof name === 'string' ? name : null });
      const events = normalizeEvents(item.events);
      const timing = timingFromEvents(events);
      const activity = eventActivity(events);
      item.run = {
        ...item.run,
        activeDurationMs: timing.activeMs ?? item.run.exportedDurationMs,
        lastTurnDurationMs: timing.lastTurnMs,
        toolCount: events.filter((event) => !event.type.endsWith('completed') && (event.data?.tool || event.data?.command)).length,
        fileCount: activity.files.length,
      };
      store.saveImport(item);
      return summary(item);
    },
    deleteImport(id) {
      if (!store.getImport(id)) throw new Error('Imported run not found.');
      store.deleteImport(id);
      const saved = annotations();
      if (saved[`${IMPORT_PREFIX}${id}`]) {
        delete saved[`${IMPORT_PREFIX}${id}`];
        store.saveSetting(ANNOTATIONS_SETTING, saved);
      }
      return { ok: true };
    },
    compare(keys) {
      const saved = annotations();
      const profiles = keys.map((key) => {
        try {
          if (key.startsWith(IMPORT_PREFIX)) {
            const { item, detail } = importDetail(key.slice(IMPORT_PREFIX.length));
            return withSchedule(comparisonProfile(detail, {
              source: 'imported', annotation: saved[key],
              importInfo: { id: item.id, sourceName: item.sourceName, importedAt: item.importedAt, exportedAt: item.exportedAt, originalId: item.run.id },
            }), detail);
          }
          const detail = runs.detail(key);
          return withSchedule(comparisonProfile(detail, { annotation: saved[key] }), detail);
        } catch { return null; }
      }).filter(Boolean);
      return { runs: profiles, ...deviationAnalysis(profiles) };
    },
    // Effort and memory setup that the provider does not record can be
    // declared by the person comparing; it is shown as declared, never as reported.
    annotate(key, body = {}) {
      const effort = body.effort == null || body.effort === '' ? null : String(body.effort);
      if (effort && !EFFORT_LEVELS.includes(effort)) throw new Error(`Effort must be one of ${EFFORT_LEVELS.join(', ')}.`);
      const note = body.note == null ? null : String(body.note).trim().slice(0, MAX_NOTE) || null;
      if (key.startsWith(IMPORT_PREFIX) ? !store.getImport(key.slice(IMPORT_PREFIX.length)) : !store.getRun(key)) throw new Error('Run not found.');
      const saved = annotations();
      if (effort || note) saved[key] = { effort, note };
      else delete saved[key];
      store.saveSetting(ANNOTATIONS_SETTING, saved);
      return saved[key] || null;
    },
  };
}

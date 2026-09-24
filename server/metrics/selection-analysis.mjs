import { activityFor } from './observability.mjs';

const finite = (value) => Number.isFinite(value) ? value : null;
const sumReported = (rows, key) => {
  const values = rows.map((row) => finite(row[key])).filter((value) => value !== null);
  return { value: values.length ? values.reduce((sum, value) => sum + value, 0) : null, reported: values.length, total: rows.length };
};
const add = (map, name, amount = 1) => map.set(name, (map.get(name) || 0) + amount);
const ranking = (map) => [...map].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

export function buildSelectionAnalysis(runs, store) {
  const sessions = [];
  const providers = new Map(), models = new Map(), tools = new Map(), commands = new Map(), files = new Map(), activity = new Map(), creditsByUnit = new Map(), copilotCreditsByUnit = new Map();
  const providerTokens = new Map(), modelTokens = new Map(), providerCost = new Map(), modelCost = new Map();
  const metrics = [];
  let errors = 0, warnings = 0, fileReads = 0, fileWrites = 0;
  for (const run of runs) {
    const usage = run.usage || {};
    const input = finite(usage.input), output = finite(usage.output);
    const total = input !== null && output !== null ? input + output : finite(usage.total);
    const startedAt = Date.parse(run.startedAt || ''), endedAt = Date.parse(run.endedAt || run.updatedAt || '');
    const row = { totalTokens: total, inputTokens: input, outputTokens: output, cachedTokens: finite(usage.cached), cacheWriteTokens: finite(usage.cacheWrite), reasoningTokens: finite(usage.reasoning), observedAgentTokens: finite(usage.observedTokens), contextTokens: finite(usage.contextTokens), cost: finite(usage.cost), activeDurationMs: finite(run.activeDurationMs), lastTurnDurationMs: finite(run.lastTurnDurationMs), conversationSpanMs: Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt > startedAt ? endedAt - startedAt : null };
    metrics.push(row);
    add(providers, run.provider || 'Unknown');
    add(models, run.model || 'Unknown');
    if (total !== null) { add(providerTokens, run.provider || 'Unknown', total); add(modelTokens, run.model || 'Unknown', total); }
    if (row.cost !== null) { add(providerCost, run.provider || 'Unknown', row.cost); add(modelCost, run.model || 'Unknown', row.cost); }
    if (Number.isFinite(usage.credits)) {
      const unit = usage.creditUnit || 'unspecified credits';
      add(creditsByUnit, unit, usage.credits);
      if (run.provider === 'copilot') {
        const entry = copilotCreditsByUnit.get(unit) || { unit, value: 0, reported: 0, mainAgentOnly: 0 };
        entry.value += usage.credits;
        entry.reported += 1;
        if (usage.creditCoverage === 'main-agent-only') entry.mainAgentOnly += 1;
        copilotCreditsByUnit.set(unit, entry);
      }
    }
    const events = store.eventsFor(run.id);
    const observed = activityFor(events);
    warnings += observed.warnings.length;
    errors += events.filter((event) => event.type === 'agent.error').length;
    for (const event of events) {
      const day = String(event.timestamp || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) add(activity, day);
      const tool = event.data?.tool;
      if (tool && !event.type.endsWith('completed')) add(tools, String(tool));
    }
    for (const command of observed.commands) add(commands, command.name, command.count);
    for (const file of observed.files) {
      fileReads += file.reads; fileWrites += file.writes;
      const existing = files.get(file.path) || { path: file.path, reads: 0, writes: 0 };
      existing.reads += file.reads; existing.writes += file.writes;
      files.set(file.path, existing);
    }
    sessions.push({ id: run.id, name: run.name, provider: run.provider, model: run.model, projectId: run.workProjectId, projectIds: run.workProjectIds || [], workItemId: run.workItemId, startedAt: run.startedAt, status: run.status, creditUnit: usage.creditUnit || null, creditCoverage: usage.creditCoverage || null, credits: finite(usage.credits), ...row, eventCount: events.length, toolCount: events.filter((event) => event.data?.tool && !event.type.endsWith('completed')).length, fileReadCount: observed.files.reduce((sum, file) => sum + file.reads, 0), fileWriteCount: observed.files.reduce((sum, file) => sum + file.writes, 0), warningCount: observed.warnings.length, errorCount: events.filter((event) => event.type === 'agent.error').length });
  }
  const totals = Object.fromEntries(Object.keys(metrics[0] || { totalTokens: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, observedAgentTokens: 0, contextTokens: 0, cost: 0, activeDurationMs: 0, lastTurnDurationMs: 0, conversationSpanMs: 0 }).map((key) => [key, sumReported(metrics, key)]));
  const copilotSessionCount = sessions.filter((run) => run.provider === 'copilot').length;
  const copilotCreditTotals = [...copilotCreditsByUnit.values()].map((entry) => ({ ...entry, value: Number(entry.value.toFixed(6)), total: copilotSessionCount }));
  if (copilotSessionCount && !copilotCreditTotals.length) copilotCreditTotals.push({ unit: null, value: null, reported: 0, mainAgentOnly: 0, total: copilotSessionCount });
  return { sessionCount: sessions.length, totals, sessions, providers: ranking(providers), models: ranking(models), providerTokens: ranking(providerTokens), modelTokens: ranking(modelTokens), providerCost: ranking(providerCost), modelCost: ranking(modelCost), creditsByUnit: ranking(creditsByUnit), copilotCreditTotals, tools: ranking(tools), commands: ranking(commands), files: [...files.values()].sort((a, b) => b.reads + b.writes - a.reads - a.writes), activity: ranking(activity).sort((a, b) => a.name.localeCompare(b.name)), fileReads, fileWrites, errors, warnings };
}

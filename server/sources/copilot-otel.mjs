import { readFile } from 'node:fs/promises';
import { mergedDurationMs } from '../core/timing.mjs';

const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const numeric = (value) => {
  const parsed = typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
  return finite(parsed) ? parsed : null;
};

function attributeValue(value) {
  if (value == null || typeof value !== 'object') return value;
  for (const key of ['stringValue', 'intValue', 'doubleValue', 'boolValue']) {
    if (value[key] != null) return attributeValue(value[key]);
  }
  if (value.value != null) return attributeValue(value.value);
  if (Array.isArray(value.arrayValue?.values)) return value.arrayValue.values.map(attributeValue);
  return value;
}

function attributesOf(value) {
  if (Array.isArray(value)) {
    return Object.fromEntries(value
      .filter((item) => typeof item?.key === 'string')
      .map((item) => [item.key, attributeValue(item.value)]));
  }
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, attributeValue(item)]));
}

function spansOf(record) {
  const spans = [];
  const seen = new Set();
  const visit = (value) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const attributes = attributesOf(value.attributes);
    if (value.name && (attributes['gen_ai.operation.name'] || /^(?:invoke_agent|chat|execute_tool)(?:\s|$)/.test(value.name))) {
      spans.push(value);
      return;
    }
    for (const key of ['span', 'spans', 'scopeSpans', 'scope_spans', 'resourceSpans', 'resource_spans', 'data']) visit(value[key]);
  };
  visit(record);
  return spans;
}

function milliseconds(value) {
  if (typeof value === 'string') {
    if (/^\d+$/.test(value)) {
      const raw = Number(value);
      return raw > 1e15 ? raw / 1e6 : raw > 1e12 ? raw / 1e3 : raw;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (Array.isArray(value) && value.length >= 2) return Number(value[0]) * 1000 + Number(value[1]) / 1e6;
  if (finite(value)) return value > 1e15 ? value / 1e6 : value > 1e12 ? value / 1e3 : value;
  return null;
}

function normalizedSpan(span) {
  const attributes = attributesOf(span.attributes);
  const operation = attributes['gen_ai.operation.name'] || String(span.name || '').split(' ')[0];
  if (operation !== 'invoke_agent') return null;
  const conversationId = attributes['gen_ai.conversation.id'];
  if (typeof conversationId !== 'string' || !conversationId) return null;
  const parentId = span.parentSpanId || span.parent_span_id || span.parentSpanContext?.spanId || null;
  const input = numeric(attributes['gen_ai.usage.input_tokens']);
  const output = numeric(attributes['gen_ai.usage.output_tokens']);
  const cacheRead = numeric(attributes['gen_ai.usage.cache_read.input_tokens']);
  const cacheWrite = numeric(attributes['gen_ai.usage.cache_creation.input_tokens']);
  const reasoning = numeric(attributes['gen_ai.usage.reasoning_tokens']);
  const nanoAiu = numeric(attributes['github.copilot.nano_aiu']);
  const isTopLevel = attributes['server.address'] != null || !parentId;
  return {
    conversationId,
    key: `${span.traceId || span.trace_id || ''}:${span.spanId || span.span_id || span.id || JSON.stringify([span.name, span.startTime, attributes])}`,
    input, output, cacheRead, cacheWrite, reasoning, nanoAiu, isTopLevel,
    model: attributes['gen_ai.request.model'] || attributes['gen_ai.response.model'] || '',
    agentName: attributes['gen_ai.agent.name'] || '',
    startedAt: milliseconds(span.startTimeUnixNano ?? span.start_time_unix_nano ?? span.startTime ?? span.timestamp),
    endedAt: milliseconds(span.endTimeUnixNano ?? span.end_time_unix_nano ?? span.endTime),
  };
}

export function collectCopilotOtel(records) {
  const sessions = new Map();
  for (const record of records) {
    for (const rawSpan of spansOf(record)) {
      const span = normalizedSpan(rawSpan);
      if (!span) continue;
      const session = sessions.get(span.conversationId) || { conversationId: span.conversationId, spans: new Map() };
      session.spans.set(span.key, span);
      sessions.set(span.conversationId, session);
    }
  }
  return [...sessions.values()].map((session) => summarizeSession(session)).filter(Boolean);
}

function summarizeSession(session) {
  const spans = [...session.spans.values()];
  const sum = (key, selected = spans) => {
    const values = selected.map((span) => span[key]).filter(finite);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };
  const topLevel = spans.filter((span) => span.isTopLevel);
  const subagents = spans.filter((span) => !span.isTopLevel);
  const input = sum('input');
  const output = sum('output');
  const cacheRead = sum('cacheRead');
  const cacheWrite = sum('cacheWrite');
  const subagentInput = sum('input', subagents);
  const subagentOutput = sum('output', subagents);
  const nanoAiu = sum('nanoAiu', topLevel);
  if (input == null && output == null && nanoAiu == null) return null;
  const starts = spans.map((span) => span.startedAt).filter(Number.isFinite);
  const ends = spans.map((span) => span.endedAt).filter(Number.isFinite);
  // Spans overlap while subagents run: merging them keeps the active time to
  // the wall-clock intervals where at least one span was executing.
  const activeDurationMs = mergedDurationMs(spans.map((span) => [span.startedAt, span.endedAt]));
  const model = topLevel.find((span) => span.model)?.model || spans.find((span) => span.model)?.model || '';
  const observedTokens = subagentInput != null || subagentOutput != null
    ? (subagentInput || 0) + (subagentOutput || 0)
    : null;
  return {
    conversationId: session.conversationId,
    model,
    startedAt: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
    endedAt: ends.length ? new Date(Math.max(...ends)).toISOString() : null,
    activeDurationMs,
    usage: {
      input,
      output,
      cached: cacheRead,
      cacheWrite,
      reasoning: sum('reasoning'),
      cost: null,
      credits: nanoAiu == null ? null : nanoAiu / 1_000_000_000,
      creditUnit: nanoAiu == null ? null : 'AI credits',
      creditCoverage: nanoAiu == null ? null : subagents.length ? 'main-agent-only' : 'session',
      observedTokens,
      observedTokenScope: observedTokens == null ? null : 'subagents',
      source: 'opentelemetry',
      costSource: null,
    },
  };
}

export async function readCopilotOtelFile(filename) {
  const content = await readFile(filename, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return '';
    throw error;
  });
  const records = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { /* A final record may still be in flight. */ }
  }
  return collectCopilotOtel(records);
}

const numberAfter = (text, labels) => {
  for (const label of labels) {
    const match = text.match(new RegExp(`${label}\\s*(?:used|usage|tokens?)?\\s*[:=]\\s*([\\d,.]+)`, 'i'));
    if (match) return Number(match[1].replace(/,/g, ''));
  }
  return null;
};

// `/usage` and `/context` are informational commands. This parser deliberately
// accepts only labelled values so decorative charts and quota percentages can
// never be mistaken for session token totals.
export function parseCopilotUsageText(rawText, command = '/usage') {
  const text = String(rawText || '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
  const credits = numberAfter(text, ['AI Credits?', 'Premium Requests?']);
  const input = numberAfter(text, ['Input Tokens?']);
  const output = numberAfter(text, ['Output Tokens?']);
  const cached = numberAfter(text, ['Cache(?:d| Read) Tokens?']);
  const total = numberAfter(text, ['Total Tokens?', 'Session Tokens?']);
  const contextMatch = text.match(/(?:context(?: window)?(?: usage)?|tokens? in use)\s*[:=]?\s*([\d,]+)\s*(?:\/|of)\s*([\d,]+)\s*(?:tokens?)?/i);
  const creditUnit = /premium requests?/i.test(text) ? 'premium requests' : credits == null ? null : 'AI credits';
  if ([credits, input, output, cached, total].every((value) => value == null) && !contextMatch) return null;
  return {
    input, output, total, cached, reasoning: null, cost: null,
    credits, creditUnit,
    contextTokens: contextMatch ? Number(contextMatch[1].replace(/,/g, '')) : null,
    contextWindowTokens: contextMatch ? Number(contextMatch[2].replace(/,/g, '')) : null,
    source: command,
    costSource: null,
  };
}

export function mergeCopilotUsage(otel, fallback) {
  if (!otel) return fallback;
  if (!fallback) return otel;
  const preferFallbackCredits = finite(fallback.credits)
    && (fallback.creditUnit === 'AI credits' || !finite(otel.credits));
  return {
    ...fallback,
    ...otel,
    total: finite(fallback.total) ? fallback.total : otel.total ?? null,
    credits: preferFallbackCredits ? fallback.credits : otel.credits,
    creditUnit: preferFallbackCredits ? fallback.creditUnit : otel.creditUnit,
    creditCoverage: preferFallbackCredits ? 'session' : otel.creditCoverage,
    contextTokens: fallback.contextTokens ?? otel.contextTokens ?? null,
    contextWindowTokens: fallback.contextWindowTokens ?? otel.contextWindowTokens ?? null,
    source: `${otel.source}+${fallback.source}`,
  };
}

import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { compact, duration } from '../../../shared/lib/metrics';
import { Segmented } from './CompareCharts';
import { RunHeading } from './MetricMatrix';
import { MODEL_COLORS, OTHER_MODEL_COLOR, formatValue, runLabel } from '../model/comparison';

const finite = Number.isFinite;
const OTHER = 'Other models';
const MEASURES = {
  credits: { label: 'Credits', get: (model) => model.credits, format: (value) => formatValue('credits', value) },
  tokens: { label: 'Tokens', get: (model) => finite(model.input) || finite(model.output) ? (model.input || 0) + (model.output || 0) : null, format: (value) => compact(Math.round(value)) },
  requests: { label: 'Requests', get: (model) => model.requests, format: (value) => compact(value) },
};

function StackTooltip({ active, payload, label, format }) {
  if (!active || !payload?.length) return null;
  const items = payload.filter((item) => finite(item.value) && item.value > 0);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return <div className="readable-tooltip"><strong>{label}</strong>{items.map((item) => <div key={item.dataKey}><span><i className="tooltip-swatch" style={{ background: item.color }} />{item.dataKey}</span><b>{format(item.value)} · {Math.round(item.value / total * 100)}%</b></div>)}</div>;
}

const cellText = (model, unit) => model ? [
  finite(model.requests) && `${compact(model.requests)} req`,
  (finite(model.input) || finite(model.output)) && `${compact(model.input)} in / ${compact(model.output)} out`,
  finite(model.credits) && formatValue('credits', model.credits, model.creditUnit || unit),
  finite(model.credits) && finite(model.requests) && model.requests > 0 && `${formatValue('credits', model.credits / model.requests)} per req`,
  finite(model.costUsd) && `$${model.costUsd.toFixed(3)} reported`,
].filter(Boolean) : null;

const NOT_LOGGED = 'Not reported by the provider log for this agent';
const missing = <small className="muted" title={NOT_LOGGED}>not logged</small>;
const tokensOf = (agent) => finite(agent.tokens) ? agent.tokens : finite(agent.input) || finite(agent.output) ? (agent.input || 0) + (agent.output || 0) : null;

// One row per agent; a measurement the log does not keep for an agent says
// so instead of looking like zero.
function AgentTable({ agents }) {
  const totalCredits = agents.reduce((sum, agent) => sum + (finite(agent.credits) ? agent.credits : 0), 0);
  const subagents = agents.filter((agent) => agent.source !== 'main-agent');
  return <>
    <div className="compare-table-scroll"><table className="compare-table compare-mini-table">
      <thead><tr><th scope="col">Agent</th><th scope="col">Model</th><th scope="col">Model calls</th><th scope="col">Tokens</th><th scope="col">Credits</th><th scope="col">Share</th><th scope="col">Time</th><th scope="col">Tools</th></tr></thead>
      <tbody>{agents.map((agent) => <tr key={agent.id}>
        <th scope="row">{agent.name || agent.id}{agent.cancelled && <em className="source-badge">Cancelled</em>}</th>
        <td><code>{agent.model || '—'}</code></td>
        <td>{finite(agent.requests) ? compact(agent.requests) : missing}</td>
        <td>{finite(tokensOf(agent)) ? compact(tokensOf(agent)) : missing}</td>
        <td>{finite(agent.credits) ? formatValue('credits', agent.credits) : missing}</td>
        <td>{finite(agent.credits) && totalCredits > 0 ? `${Math.round(agent.credits / totalCredits * 100)}%` : '—'}</td>
        <td title={finite(agent.apiDurationMs) ? `Model API time: ${duration(agent.apiDurationMs)}` : undefined}>{finite(agent.durationMs) ? <>{duration(agent.durationMs)}{agent.durationIncludesSubagents && <small className="muted" title="The provider does not log when its subagents worked, so this is the run's active time"> incl. subagents</small>}</> : finite(agent.apiDurationMs) ? <>{duration(agent.apiDurationMs)} <small className="muted">API</small></> : missing}</td>
        <td>{finite(agent.toolCalls) ? agent.toolCalls : missing}</td>
      </tr>)}</tbody>
    </table></div>
    <p className="unavailable-note compare-agent-note">{subagents.length} subagent{subagents.length === 1 ? '' : 's'}{totalCredits > 0 ? ` · ${Math.round(subagents.reduce((sum, agent) => sum + (finite(agent.credits) ? agent.credits : 0), 0) / totalCredits * 100)}% of the credits went to subagents` : ''}. Each agent combines what every source reported about it; time is its active time between its own events, and the main agent's leaves out the time its subagents were working. “not logged” means no source records that measurement for the agent — VS Code, for example, does not log a subagent's tokens.</p>
  </>;
}

export function ModelBreakdown({ rows, colors }) {
  const withModels = rows.filter((row) => row.models?.length);
  const available = Object.entries(MEASURES).filter(([, measure]) => withModels.some((row) => row.models.some((model) => finite(measure.get(model)))));
  const [measureId, setMeasureId] = useState(available[0]?.[0] || 'tokens');
  const measure = MEASURES[measureId] || MEASURES.tokens;
  const charted = withModels.filter((row) => row.models.some((model) => finite(measure.get(model))));
  const { data, models } = useMemo(() => {
    const totals = new Map();
    charted.forEach((row) => row.models.forEach((model) => totals.set(model.model, (totals.get(model.model) || 0) + (measure.get(model) || 0))));
    const ranked = [...totals].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).map(([name]) => name);
    const named = ranked.slice(0, MODEL_COLORS.length);
    const rest = new Set(ranked.slice(MODEL_COLORS.length));
    return {
      models: rest.size ? [...named, OTHER] : named,
      data: charted.map((row) => {
        const entry = { name: runLabel(row) };
        for (const model of row.models) {
          const value = measure.get(model);
          if (!finite(value)) continue;
          const key = rest.has(model.model) ? OTHER : model.model;
          entry[key] = (entry[key] || 0) + value;
        }
        return entry;
      }),
    };
  }, [charted.map((row) => row.key).join('|'), measureId]);
  const colorOf = (model, index) => model === OTHER ? OTHER_MODEL_COLOR : MODEL_COLORS[index];
  const allModels = [...new Set(withModels.flatMap((row) => row.models.map((model) => model.model)))];
  const routed = rows.filter((row) => row.providerDetails?.routing?.length || row.providerDetails?.modelChanges?.length);
  const agentRows = rows.filter((row) => row.agents?.length);

  if (!withModels.length) return <p className="empty-evidence">None of the compared runs reports usage per model. Copilot reports it when a session ends, Claude per message, Codex per response; runs imported from exports older than 1.1 do not carry it.</p>;
  return <div className="compare-tab-grid">
    <section className="panel-block compare-wide compare-chart">
      <header><div><span>Model mix</span><h2>{measure.label} by model</h2></div>{available.length > 1 && <Segmented label="Measure" value={measureId} options={available.map(([id, item]) => [id, item.label])} onChange={setMeasureId} />}</header>
      <div className="compare-legend">{models.map((model, index) => <span key={model}><i style={{ background: colorOf(model, index) }} />{model}</span>)}</div>
      <div className="compare-chart-body" style={{ height: data.length * 44 + 40 }}>
        <ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{ top: 4, right: 18, left: 4, bottom: 4 }} barCategoryGap={10}>
          <CartesianGrid stroke="#1d3141" horizontal={false} />
          <XAxis type="number" stroke="#7590a5" tickLine={false} tick={{ fontSize: 10, fill: '#8ea5b8' }} axisLine={{ stroke: '#314657' }} tickFormatter={measure.format} />
          <YAxis type="category" dataKey="name" width={150} stroke="#7590a5" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 10, fill: '#b8c9d6' }} tickFormatter={(value) => value.length > 22 ? `${value.slice(0, 21)}…` : value} />
          <Tooltip content={<StackTooltip format={measure.format} />} cursor={{ fill: '#16304133' }} isAnimationActive={false} />
          {models.map((model, index) => <Bar key={model} dataKey={model} stackId="models" fill={colorOf(model, index)} stroke="#0d202d" strokeWidth={2} maxBarSize={22} isAnimationActive={false} />)}
        </BarChart></ResponsiveContainer>
      </div>
      {charted.length < rows.length && <p className="unavailable-note compare-chart-note">{rows.length - charted.length} of {rows.length} runs do not report {measure.label.toLowerCase()} per model and are not drawn.</p>}
    </section>
    <section className="panel-block compare-wide">
      <header><div><span>Models</span><h2>Every model, per run</h2></div><small>Requests, tokens, credits and credits per request</small></header>
      <div className="compare-table-scroll"><table className="compare-table compare-count-table">
        <thead><tr><th scope="col">Model</th>{rows.map((row, index) => <th scope="col" key={row.key}><RunHeading row={row} color={colors[index]} /></th>)}</tr></thead>
        <tbody>{allModels.map((name) => <tr key={name}><th scope="row"><code title={name}>{name}</code></th>{rows.map((row) => {
          const lines = cellText(row.models?.find((model) => model.model === name), row.metrics.creditUnit);
          return <td key={row.key}>{lines ? lines.map((line, index) => index ? <small key={line}>{line}</small> : <strong key={line}>{line}</strong>) : <small className="muted">{row.models?.length ? 'not used' : 'not reported'}</small>}</td>;
        })}</tr>)}</tbody>
      </table></div>
    </section>
    {agentRows.length > 0 && <section className="panel-block compare-wide">
      <header><div><span>Agents</span><h2>Main agent and subagents</h2></div><small>Where each run delegated work</small></header>
      <div className="compare-run-lists compare-agent-lists">{agentRows.map((row) => <article key={row.key}>
        <RunHeading row={row} color={colors[rows.indexOf(row)]} />
        <AgentTable agents={row.agents} />
      </article>)}</div>
    </section>}
    {routed.length > 0 && <section className="panel-block compare-wide">
      <header><div><span>Copilot routing</span><h2>Auto model selection and model changes</h2></div></header>
      <div className="compare-run-lists">{routed.map((row) => {
        const routing = row.providerDetails.routing || [];
        const chosen = Object.entries(routing.reduce((counts, item) => ({ ...counts, [item.chosen || 'unreported']: (counts[item.chosen || 'unreported'] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
        return <article key={row.key}>
          <RunHeading row={row} color={colors[rows.indexOf(row)]} />
          {routing.length > 0 && <p>{routing.length} auto-mode decisions{routing.some((item) => item.fallback) ? ` · ${routing.filter((item) => item.fallback).length} fallbacks` : ''}: {chosen.map(([model, count]) => `${model} ×${count}`).join(' · ')}</p>}
          {row.providerDetails.modelChanges?.length > 0 && <ul>{row.providerDetails.modelChanges.map((change) => <li key={`${change.at}:${change.to}`}><time>{new Date(change.at).toLocaleString('en-GB')}</time><span>{change.from || '—'} → {change.to || '—'}{change.effort ? ` · effort ${change.effort}` : ''}{change.source ? ` · ${change.source}` : ''}</span></li>)}</ul>}
        </article>;
      })}</div>
    </section>}
  </div>;
}

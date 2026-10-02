import { Fragment, useState } from 'react';
import { AgentIcon, PROVIDER_NAMES } from '../../../shared/components/AgentIcon';
import { METRIC_GROUPS, formatDelta, metricCell, metricReference, metricValue, runLabel } from '../model/comparison';

export function RunHeading({ row, color, onInspect, outlier = false }) {
  return <div className="compare-run-heading">
    <i style={{ background: color }} aria-hidden="true" />
    <span className={`agent-icon provider-${row.run.provider}`} title={PROVIDER_NAMES[row.run.provider] || row.run.provider}><AgentIcon id={row.run.provider} /></span>
    <div>
      {row.source === 'local'
        ? <button type="button" className="compare-run-link" title={row.run.name} onClick={() => onInspect?.(row.run.id)}>{row.run.name}</button>
        : <strong title={row.run.name}>{row.run.name}</strong>}
      <small>{row.run.model || 'auto'}{row.source === 'imported' && <em className="source-badge">Imported</em>}{outlier && <em className="baseline-badge">Most deviant</em>}</small>
    </div>
  </div>;
}

// Every metric of every run beside the group median; the difference is relative
// to the median and the best value is marked only where lower or higher is
// unambiguously better.
export function MetricMatrix({ rows, colors, onInspect }) {
  const [showUnreported, setShowUnreported] = useState(false);
  const groups = METRIC_GROUPS.map((group) => ({
    ...group,
    rows: group.rows.filter((definition) => showUnreported || rows.some((row) => Number.isFinite(metricValue(definition, row)))),
  })).filter((group) => group.rows.length);
  const hidden = METRIC_GROUPS.reduce((total, group) => total + group.rows.length, 0) - groups.reduce((total, group) => total + group.rows.length, 0);
  return <section className="panel-block compare-metrics-block">
    <header>
      <div><span>Metrics</span><h2>Side by side</h2></div>
      <label className="compare-check"><input type="checkbox" checked={showUnreported} onChange={(event) => setShowUnreported(event.target.checked)} />Show unreported metrics{!showUnreported && hidden > 0 ? ` (${hidden})` : ''}</label>
    </header>
    <div className="compare-table-scroll">
      <table className="compare-table compare-metrics">
        <thead><tr><th scope="col">Metric</th><th scope="col" className="compare-median-col">Median</th>{rows.map((row, index) => <th scope="col" key={row.key}><RunHeading row={row} color={colors[index]} onInspect={onInspect} /></th>)}</tr></thead>
        <tbody>{groups.map((group) => <Fragment key={group.id}>
          <tr className="compare-group-row"><th colSpan={rows.length + 2} scope="colgroup">{group.label}</th></tr>
          {group.rows.map((definition) => <tr key={definition.id}>
            <th scope="row" title={definition.hint}>{definition.label}</th>
            <td className="compare-median-col">{definition.unit ? <small className="muted">per unit</small> : <strong>{definition.format(metricReference(definition, rows), rows[0])}</strong>}</td>
            {rows.map((row) => {
              const cell = metricCell(definition, row, rows);
              return <td key={row.key} className={cell.best ? 'best' : ''}>
                <strong>{cell.text}</strong>
                {cell.delta != null && <small className={`compare-delta ${cell.tone}`} title="Difference from the group median">{formatDelta(cell.delta)}</small>}
                {cell.best && <em className="best-tag">Best</em>}
              </td>;
            })}
          </tr>)}
        </Fragment>)}</tbody>
      </table>
    </div>
  </section>;
}

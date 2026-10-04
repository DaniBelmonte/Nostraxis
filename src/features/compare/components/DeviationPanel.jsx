import { DEVIATION_ABOVE, DEVIATION_BELOW, formatDelta, formatValue, runLabel } from '../model/comparison';

const deviationText = (cell) => cell.unbounded ? 'new vs 0' : cell.deviation == null ? '—' : formatDelta(cell.deviation) || '= median';
const tone = (cell) => cell.unbounded || cell.deviation > 0.005 ? 'above' : cell.deviation < -0.005 ? 'below' : 'flat';

function DeviationBar({ cell }) {
  const width = cell.unbounded ? 50 : Math.min(2, Math.abs(cell.deviation ?? 0)) / 2 * 50;
  const side = tone(cell);
  return <span className="deviation-bar" aria-hidden="true">
    <i className="deviation-bar-mid" />
    {side !== 'flat' && <i className={`deviation-bar-fill ${side}`} style={{ width: `${width}%`, background: side === 'above' ? DEVIATION_ABOVE : DEVIATION_BELOW }} />}
  </span>;
}

function HeadlineTiles({ metrics, rows, colors }) {
  const indexOf = (key) => rows.findIndex((row) => row.key === key);
  return <section className="deviation-tiles" aria-label="Headline deviations">{metrics.map((metric) => {
    const medians = [...new Map(metric.values.filter((cell) => cell.median != null).map((cell) => [cell.unit, cell.median]))];
    const cells = metric.values.filter((cell) => cell.value != null).sort((a, b) => (b.unbounded ? Infinity : Math.abs(b.deviation ?? 0)) - (a.unbounded ? Infinity : Math.abs(a.deviation ?? 0)));
    return <article key={metric.id} className="deviation-tile">
      <header><span>{metric.label}{metric.id === 'credits' && medians.length === 1 && medians[0][0] ? <em> · {medians[0][0]}</em> : null}</span><small>Median {medians.length ? medians.map(([unit, value]) => formatValue(metric.format, value, medians.length > 1 ? unit : null)).join(' · ') : '—'}</small></header>
      {cells.map((cell) => {
        const index = indexOf(cell.key);
        return <div key={cell.key} className="deviation-tile-row" title={`${runLabel(rows[index])}: ${formatValue(metric.format, cell.value, cell.unit)} · ${deviationText(cell)} vs median`}>
          <span className="deviation-run"><i style={{ background: colors[index] }} />{runLabel(rows[index])}</span>
          <DeviationBar cell={cell} />
          <strong>{formatValue(metric.format, cell.value)}</strong>
          <small className={`deviation-delta ${tone(cell)}`}>{cell.median == null ? 'no peer' : deviationText(cell)}</small>
        </div>;
      })}
    </article>;
  })}</section>;
}

export function DeviationPanel({ rows, colors, analysis }) {
  if (!analysis || rows.length < 2) return <p className="empty-evidence">Select at least two runs to measure deviations.</p>;
  return <div className="compare-tab-grid">
    <div className="compare-wide deviation-intro">
      <p>Each value is compared with the <strong>median of the {rows.length} runs</strong>{analysis.reference.note ? ` — ${analysis.reference.note.toLowerCase()}` : ''}. Blue is below the median, red above; arrows give the direction.</p>
    </div>
    <div className="compare-wide"><HeadlineTiles metrics={analysis.metrics.filter((metric) => metric.headline)} rows={rows} colors={colors} /></div>
  </div>;
}

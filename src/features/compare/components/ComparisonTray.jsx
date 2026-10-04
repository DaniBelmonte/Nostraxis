import { ArrowDown, Plus, X } from '@phosphor-icons/react';
import { AgentIcon, PROVIDER_NAMES } from '../../../shared/components/AgentIcon';
import { MAX_COMPARED_RUNS } from '../model/comparison';

const MAX_RUNS = MAX_COMPARED_RUNS;

export function ComparisonTray({ runs, colorFor, onRemove, onScrollToComparison }) {
  const slots = [...runs, ...Array(Math.max(0, MAX_RUNS - runs.length)).fill(null)];
  return <div className="comparison-tray">
    <div className="comparison-tray-head"><strong>Comparison</strong><small>({runs.length} runs)</small></div>
    <div className="comparison-tray-slots">
      {slots.map((run, index) => run
        ? <div className="comparison-chip" key={run.id} style={{ borderLeftColor: colorFor(run.id) }}>
            <span className={`agent-icon provider-${run.provider}`} title={PROVIDER_NAMES[run.provider] || run.provider}><AgentIcon id={run.provider} /></span>
            <span className="comparison-chip-name" title={run.name}>{run.name}</span>
            <small>{run.model || 'auto'}</small>
            <button type="button" aria-label={`Remove ${run.name} from comparison`} onClick={() => onRemove(run.id)}><X /></button>
          </div>
        : <div className="comparison-chip empty" key={`empty-${index}`}><Plus /><small>Add another run</small></div>)}
    </div>
    <button className="primary-button" type="button" disabled={runs.length < 2} onClick={onScrollToComparison}>View comparison <ArrowDown /></button>
  </div>;
}

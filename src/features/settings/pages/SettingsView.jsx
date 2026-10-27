import { useState } from 'react';
import { PageShell } from '../../workspace/pages/WorkspaceViews';
import { PricingPanel } from '../components/PricingPanel';

const TABS = [['sources', 'Sources & adapters'], ['pricing', 'Pricing'], ['metrics', 'Metrics']];

export function SettingsView({ data, reload }) {
  const [tab, setTab] = useState('sources');
  const tabs = <nav className="page-tabs" role="tablist" aria-label="Settings sections">{TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</nav>;
  return <PageShell eyebrow="Standalone runtime" title="Settings" description="Adapter status, pricing and observability contract for the independent project." tabs={tabs}>
    {tab === 'sources' && <>
      <section className="panel-block"><header><div><span>Team sessions</span><h2>Observed sources · {data.externalSessionCount || 0} imported</h2></div><small>Read-only · automatic sync every 3 seconds</small></header><div className="provider-grid">{(data.sessionSources || []).map((source) => <article key={`${source.provider}:${source.root}`}><div><span className={`status-dot ${source.available ? 'live' : 'warning'}`} /><h3>{source.label || source.provider}</h3></div><strong>{source.available ? `${source.count} recent ${source.format === 'hermes-sqlite' ? 'sessions' : 'logs'}` : 'Not detected'}</strong><p><code>{source.root}</code><br />{source.error ? `Error: ${source.error}` : 'Automatic sync every 3 seconds'}</p></article>)}</div></section>
      <section className="panel-block"><header><div><span>Provider adapters</span><h2>Local availability</h2></div></header><div className="provider-grid">{data.providers.map((provider) => <article key={provider.id}><div><span className={`status-dot ${provider.available ? 'live' : 'warning'}`} /><h3>{provider.name}</h3></div><strong>{provider.available ? provider.version || 'Available' : 'Not available'}</strong><p>{provider.error || `${provider.capabilities.managedRuns === false ? 'Observed history only' : 'Managed runs'} · tokens ${provider.capabilities.usage ? 'yes' : 'no'} · reasoning ${provider.capabilities.reasoning ? 'yes' : 'no'} · cost ${provider.capabilities.cost ? 'yes' : 'no'}`}</p></article>)}</div></section>
    </>}
    {tab === 'pricing' && <PricingPanel pricing={data.pricing} runs={data.runs} providerUsage={data.providerUsage} reload={reload} />}
    {tab === 'metrics' && <section className="panel-block"><header><div><span>Semantics</span><h2>Metrics</h2></div><small>Missing measurements stay unreported; nothing is inferred as zero.</small></header><div className="definition-list">{data.metricDefinitions.map((metric) => <div key={metric.id}><code>{metric.id}</code><strong>{metric.label}</strong><span>{metric.unit}</span><small>{metric.source}</small></div>)}</div></section>}
  </PageShell>;
}

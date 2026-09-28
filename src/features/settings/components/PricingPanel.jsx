import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Plus, WarningCircle, X } from '@phosphor-icons/react';
import { api } from '../../../shared/api/client';
import { PROVIDER_NAMES } from '../../../shared/components/AgentIcon';

const RATE_FIELDS = [['inputPerMillion', 'Input'], ['cachedInputPerMillion', 'Cached input'], ['outputPerMillion', 'Output']];
const PLANS = [
  ['aiCreditPlan', 'AI credits', 'GitHub AI credits plan', 'AI credit'],
  ['premiumRequestPlan', 'premium requests', 'Legacy premium requests plan', 'premium request'],
];
const text = (value) => Number.isFinite(value) ? String(value) : '';
const usdPerUnit = (value) => `$${value.toLocaleString('en-GB', { maximumFractionDigits: 6 })}`;
const BASES = [['credits', 'Subscription credits'], ['tokens', 'Model token prices']];
const draftFrom = (pricing) => ({
  copilotBasis: pricing?.copilotBasis || 'credits',
  ...Object.fromEntries(PLANS.map(([key]) => [key, { usd: text(pricing?.[key]?.usd), credits: text(pricing?.[key]?.credits) }])),
  models: Object.fromEntries(Object.entries(pricing?.models || {}).map(([model, rates]) => [model, Object.fromEntries(RATE_FIELDS.map(([field]) => [field, text(rates[field])]))])),
});

// Observed models come first so a price can be set without typing the id.
const modelRows = (runs, models) => {
  const observed = new Map();
  for (const run of runs || []) {
    if (!run.model) continue;
    const row = observed.get(run.model) || { model: run.model, providers: new Set(), sessions: 0, observed: true };
    row.providers.add(run.provider);
    row.sessions += 1;
    observed.set(run.model, row);
  }
  const rows = [...observed.values()].sort((a, b) => b.sessions - a.sessions || a.model.localeCompare(b.model));
  return [...rows, ...Object.keys(models).filter((model) => !observed.has(model)).sort().map((model) => ({ model, providers: new Set(), sessions: 0, observed: false }))];
};

function RateInput({ label, value, onChange, placeholder = 'Not set' }) {
  return <input type="number" min="0" step="any" inputMode="decimal" placeholder={placeholder} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />;
}

// The price per credit is derived, never typed: plan price / credits included.
function CreditPlan({ unit, title, single, value, quota, inactive, onChange }) {
  const usd = Number(value.usd);
  const credits = Number(value.credits);
  const derived = value.usd !== '' && value.credits !== '' && Number.isFinite(usd) && Number.isFinite(credits) && credits > 0 ? usd / credits : null;
  return <fieldset className={`pricing-plan ${inactive ? 'inactive' : ''}`}>
    <legend>{title}</legend>
    <label>Subscription price<small>USD for the plan</small><RateInput label={`${title} price in USD`} value={value.usd} onChange={(next) => onChange({ ...value, usd: next })} /></label>
    <label>Credits included<small>{`${unit} in the plan`}</small><RateInput label={`${unit} included in the plan`} value={value.credits} placeholder={Number.isFinite(quota) ? String(quota) : 'Not set'} onChange={(next) => onChange({ ...value, credits: next })} /></label>
    <p className="pricing-derived"><strong>{derived == null ? '—' : usdPerUnit(derived)}</strong><span>{derived == null ? `per ${single} · set both values to derive it` : `per ${single}`}</span></p>
    {Number.isFinite(quota) && String(quota) !== value.credits && <button type="button" className="secondary-button" onClick={() => onChange({ ...value, credits: String(quota) })}>Use account quota · {quota.toLocaleString('en-GB')}</button>}
  </fieldset>;
}

export function PricingPanel({ pricing, runs, providerUsage, reload }) {
  const saved = useMemo(() => draftFrom(pricing), [pricing]);
  const [draft, setDraft] = useState(saved);
  const [newModel, setNewModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ error: '', message: '' });
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useEffect(() => { if (!dirty) setDraft(saved); }, [saved]);
  const rows = modelRows(runs, draft.models);
  const environmentModels = pricing?.environmentModels || [];
  // The account entitlement GitHub reports is the credit total of the plan.
  const copilot = providerUsage?.providers?.find((provider) => provider.id === 'copilot');
  const quota = copilot?.windows?.find((window) => Number.isFinite(window.limit))?.limit;
  const quotaFor = (unit) => copilot?.creditUnit === unit ? quota : null;
  const setRate = (model, field, value) => setDraft((current) => ({ ...current, models: { ...current.models, [model]: { ...current.models[model], [field]: value } } }));
  const removeModel = (model) => setDraft((current) => { const models = { ...current.models }; delete models[model]; return { ...current, models }; });
  const addModel = () => {
    const model = newModel.trim();
    if (!model) return;
    setDraft((current) => ({ ...current, models: { [model]: current.models[model] || {}, ...current.models } }));
    setNewModel('');
  };
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setStatus({ error: '', message: '' });
    try {
      await api.savePricing(draft);
      await reload();
      setStatus({ error: '', message: `Saved at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · every session is re-priced` });
    } catch (reason) { setStatus({ error: reason.message, message: '' }); }
    finally { setBusy(false); }
  };
  // The save state stays visible: unsaved edits, a failure or the last save.
  const state = status.error ? ['error', <WarningCircle key="icon" />, status.error]
    : busy ? ['pending', null, 'Saving…']
    : dirty ? ['dirty', <WarningCircle key="icon" />, 'Unsaved changes · press Save prices to apply them']
    : status.message ? ['saved', <CheckCircle key="icon" weight="fill" />, status.message]
    : ['idle', null, environmentModels.length ? `${environmentModels.length} models priced by NOSTRAXIS_PRICING_JSON; a price saved here overrides it.` : 'Empty prices stay unreported; nothing is inferred as zero.'];
  return <section className="panel-block pricing-panel">
    <header><div><span>Pricing</span><h2>Cost equivalents · USD</h2></div><small>A cost reported by the provider always takes precedence.</small></header>
    <form onSubmit={submit}>
      <div className="pricing-credits">
        <div className="pricing-basis" role="radiogroup" aria-label="Copilot cost basis"><div><strong>Copilot sessions priced by</strong><small>One basis for every Copilot session; the other is never used as a fallback.</small></div><div className="group-mode-toggle">{BASES.map(([id, label]) => <button key={id} type="button" role="radio" aria-checked={draft.copilotBasis === id} className={draft.copilotBasis === id ? 'active' : ''} onClick={() => setDraft((current) => ({ ...current, copilotBasis: id }))}>{label}</button>)}</div></div>
        {PLANS.map(([key, unit, title, single]) => <CreditPlan key={key} unit={unit} title={title} single={single} value={draft[key]} quota={quotaFor(unit)} inactive={draft.copilotBasis !== 'credits'} onChange={(value) => setDraft((current) => ({ ...current, [key]: value }))} />)}
        <p>{draft.copilotBasis === 'credits'
          ? 'Copilot sessions are priced by the credits they report, each unit with its own plan; AI credits and premium requests are never mixed. A Copilot session without credits stays unreported.'
          : 'Copilot sessions are priced by the tokens of the model behind them, using the model prices below. The plans are kept but not applied.'}</p>
      </div>
      <div className="pricing-table" role="table" aria-label="Model prices per million tokens">
        <div className="pricing-row pricing-head" role="row"><span role="columnheader">Model</span>{RATE_FIELDS.map(([field, label]) => <span key={field} role="columnheader">{label} / 1M</span>)}<span role="columnheader"><span className="sr-only">Actions</span></span></div>
        {rows.map((row) => <div key={row.model} className="pricing-row" role="row">
          <span role="cell" className="pricing-model"><code title={row.model}>{row.model}</code><small>{row.observed ? `${[...row.providers].map((id) => PROVIDER_NAMES[id] || id).join(' · ')} · ${row.sessions} ${row.sessions === 1 ? 'session' : 'sessions'}` : environmentModels.includes(row.model) ? 'Overrides NOSTRAXIS_PRICING_JSON' : 'Not observed yet'}</small></span>
          {RATE_FIELDS.map(([field, label]) => <span key={field} role="cell" data-label={`${label} / 1M`}><RateInput label={`${row.model} ${label} USD per million tokens`} value={draft.models[row.model]?.[field] ?? ''} onChange={(value) => setRate(row.model, field, value)} /></span>)}
          <span role="cell">{draft.models[row.model] && <button type="button" className="icon-button" onClick={() => removeModel(row.model)} aria-label={`Clear ${row.model} prices`} title="Clear prices"><X /></button>}</span>
        </div>)}
        {!rows.length && <p className="table-empty">No models observed yet. Add a model id to price it before its first session.</p>}
      </div>
      <div className="pricing-add-row">
        <label className="pricing-add"><span className="sr-only">Model id</span><input value={newModel} onChange={(event) => setNewModel(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addModel(); } }} placeholder="Add model id, e.g. gpt-5" maxLength={200} /></label>
        <button type="button" className="secondary-button" onClick={addModel} disabled={!newModel.trim()}><Plus /> Add model</button>
      </div>
      <footer className={`pricing-footer ${state[0]}`}>
        <p className="pricing-save-state" role="status" aria-live="polite">{state[1]}<span>{state[2]}</span></p>
        <button type="button" className="secondary-button" onClick={() => { setDraft(saved); setStatus({ error: '', message: '' }); }} disabled={!dirty || busy}>Discard</button>
        <button type="submit" className="primary-button" disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save prices'}</button>
      </footer>
    </form>
  </section>;
}

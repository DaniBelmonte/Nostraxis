import { useEffect, useMemo, useRef, useState } from 'react';
import { GithubLogo, OpenAiLogo, X } from '@phosphor-icons/react';
import { api } from './api';

const providerOrder = ['codex', 'claude', 'copilot'];
const fallbackNames = { codex: 'Codex / ChatGPT', claude: 'Claude', copilot: 'GitHub Copilot' };
const statusLabels = {
  connected: 'Connected',
  disconnected: 'No session',
  'local-data': 'Local data',
  'cli-available': 'CLI available',
  unavailable: 'No data',
};

const number = (value) => Number.isFinite(value) ? new Intl.NumberFormat('en-GB').format(value) : 'N/A';
const decimal = (value) => Number.isFinite(value) ? value.toFixed(1) : 'N/A';
const percent = (value) => Number.isFinite(value) ? `${value.toFixed(1)} %` : 'N/A';
const date = (value) => {
  if (!value || !Number.isFinite(Date.parse(value))) return 'N/A';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
};
const remaining = (value, now) => {
  const milliseconds = Date.parse(value || '') - now;
  if (!Number.isFinite(milliseconds)) return 'N/A';
  if (milliseconds <= 0) return 'Now';
  const minutes = Math.ceil(milliseconds / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainder = minutes % 60;
  if (days) return `${days} d ${hours} h`;
  if (hours) return `${hours} h ${remainder} min`;
  return `${remainder} min`;
};
const dayValue = (value) => new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const currentMonthRange = () => {
  const today = new Date();
  return { from: dayValue(new Date(today.getFullYear(), today.getMonth(), 1)), to: dayValue(today) };
};

function ClaudeLogo() {
  return <svg className="claude-logo" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.8v18.4M4.1 7.4l15.8 9.2M4.1 16.6l15.8-9.2M2.8 12h18.4" />
  </svg>;
}

function ProviderLogo({ id }) {
  if (id === 'codex') return <OpenAiLogo weight="fill" />;
  if (id === 'claude') return <ClaudeLogo />;
  return <GithubLogo weight="fill" />;
}

function LimitWindow({ window, now }) {
  const hasTotals = Number.isFinite(window.used) && Number.isFinite(window.limit);
  return <section className="provider-limit">
    <div className="provider-limit-heading"><strong>{window.label}</strong><span>{hasTotals ? `${decimal(window.used)} / ${number(window.limit)} used` : `${percent(window.usedPercent)} used`}</span></div>
    <div className="provider-limit-bar" role="meter" aria-label={`${window.label}: usage used`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={window.usedPercent}>
      <i style={{ width: `${Math.min(100, Math.max(0, window.usedPercent))}%` }} />
    </div>
    <div className="provider-limit-meta"><span>{Number.isFinite(window.available) ? `${decimal(window.available)} available` : `${percent(window.availablePercent)} available`}</span><span>{remaining(window.resetsAt, now)}</span></div>
    <small>Reset: {date(window.resetsAt)}</small>
  </section>;
}

function CopilotRangeUsage({ usage, creditUnit, limit, range, onRangeChange }) {
  const hasUsage = Number.isFinite(usage?.creditsUsed);
  const hasPercent = Number.isFinite(usage?.usedPercent);
  return <section className="provider-range-usage" aria-label="Copilot usage by date range">
    <div className="provider-range-heading"><strong>Usage by date</strong><span>{hasUsage ? percent(usage.usedPercent) : 'N/A'}</span></div>
    <div className="provider-date-fields">
      <label>From<input type="date" value={range.from} max={range.to} onChange={(event) => onRangeChange({ ...range, from: event.target.value })} /></label>
      <label>To<input type="date" value={range.to} min={range.from} onChange={(event) => onRangeChange({ ...range, to: event.target.value })} /></label>
    </div>
    <div className="provider-range-value">{hasUsage
      ? <><strong>{decimal(usage.creditsUsed)} {creditUnit || 'credits'}</strong>{hasPercent && <span>{percent(usage.usedPercent)} of {number(limit)} monthly entitlement</span>}</>
      : 'No measured credit usage in this range'}</div>
    <small>{hasUsage && hasPercent ? 'Credits used in the selected dates versus the monthly plan limit.' : 'Based on every Copilot chat found in local history.'}</small>
  </section>;
}

function ProviderPopover({ provider, now, range, onRangeChange, onClose }) {
  const status = statusLabels[provider.connection] || 'No data';
  const creditsLabel = provider.creditUnit ? `Credits used · ${provider.creditUnit}` : 'Credits used';
  return <div id={`provider-usage-${provider.id}`} className="provider-usage-popover" role="dialog" aria-label={`${provider.name} usage`}>
    <header>
      <div><strong>{provider.name}</strong><small>{provider.version || 'Version N/A'}</small></div>
      <span className={`provider-status ${provider.connection}`}><i />{status}</span>
      <button className="provider-popover-close" type="button" onClick={onClose} aria-label="Close details"><X /></button>
    </header>
    <div className="provider-usage-body">
      {provider.windows?.length
        ? provider.windows.map((window) => <LimitWindow key={window.id} window={window} now={now} />)
        : <dl className="provider-na-limits"><dt>Usage used</dt><dd>N/A</dd><dt>Usage available</dt><dd>N/A</dd><dt>Next reset</dt><dd>N/A</dd></dl>}
      {provider.id === 'copilot' && <CopilotRangeUsage usage={provider.rangeUsage} creditUnit={provider.creditUnit} limit={provider.windows?.find((window) => Number.isFinite(window.limit))?.limit} range={range} onRangeChange={onRangeChange} />}
      <dl className="provider-facts">
        <dt>{provider.tokenScope ? `Tokens · ${provider.tokenScope}` : 'Tokens used'}</dt><dd>{number(provider.tokensUsed)}</dd>
        <dt>{creditsLabel}</dt><dd>{decimal(provider.creditsUsed)}</dd>
        {Number.isFinite(provider.creditBalance) && <><dt>Credit balance</dt><dd>{decimal(provider.creditBalance)}</dd></>}
        <dt>Model</dt><dd>{provider.model || 'N/A'}</dd>
        <dt>Plan</dt><dd>{provider.plan || 'N/A'}</dd>
        <dt>Source</dt><dd>{provider.source || 'N/A'}</dd>
        <dt>Updated</dt><dd>{provider.updatedAt ? date(provider.updatedAt) : 'N/A'}</dd>
      </dl>
    </div>
  </div>;
}

export function ProviderUsageDock({ initial }) {
  const [snapshot, setSnapshot] = useState(initial || null);
  const [now, setNow] = useState(Date.now());
  const [openProvider, setOpenProvider] = useState(null);
  const [range, setRange] = useState(currentMonthRange);
  const dockRef = useRef(null);
  useEffect(() => { if (initial) setSnapshot(initial); }, [initial]);
  useEffect(() => {
    let active = true;
    const refresh = () => api.providerUsage(range).then((value) => { if (active) setSnapshot(value); }).catch(() => {});
    refresh();
    const refreshTimer = setInterval(refresh, 30_000);
    const clockTimer = setInterval(() => setNow(Date.now()), 30_000);
    return () => { active = false; clearInterval(refreshTimer); clearInterval(clockTimer); };
  }, [range]);
  useEffect(() => {
    if (!openProvider) return undefined;
    const closeOutside = (event) => { if (!dockRef.current?.contains(event.target)) setOpenProvider(null); };
    const closeOnEscape = (event) => { if (event.key === 'Escape') setOpenProvider(null); };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeOnEscape); };
  }, [openProvider]);
  const providers = useMemo(() => {
    const available = new Map((snapshot?.providers || []).map((provider) => [provider.id, provider]));
    return providerOrder.map((id) => available.get(id) || {
      id, name: fallbackNames[id], connection: 'unavailable', windows: [], tokensUsed: null,
      creditsUsed: null, model: null, plan: null, updatedAt: null, source: null,
    });
  }, [snapshot]);

  return <aside className="provider-usage-dock" aria-label="AI assistant usage" ref={dockRef}>
    {providers.map((provider) => <div className={`provider-usage-item provider-${provider.id} ${openProvider === provider.id ? 'is-open' : ''}`} key={provider.id}>
      <button className="provider-logo-button" type="button" aria-label={`View ${provider.name} usage`} aria-controls={`provider-usage-${provider.id}`} aria-expanded={openProvider === provider.id} onClick={() => setOpenProvider((current) => current === provider.id ? null : provider.id)}>
        <ProviderLogo id={provider.id} />
        <i className={`provider-connection-dot ${provider.connection}`} />
      </button>
      {openProvider === provider.id && <ProviderPopover provider={provider} now={now} range={range} onRangeChange={setRange} onClose={() => setOpenProvider(null)} />}
    </div>)}
  </aside>;
}

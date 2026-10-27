import { useState } from 'react';
import { ArrowsClockwise, Plus } from '@phosphor-icons/react';
import { ProviderUsageDock } from '../../features/provider-usage';

export function TopBar({ section, online, error, providerUsage, pricing, onSync, onNewSession }) {
  const [syncing, setSyncing] = useState(false);
  const sync = async () => {
    setSyncing(true);
    try { await onSync(); } finally { setSyncing(false); }
  };
  return <header className="topbar">
    <div className="topbar-crumb"><span>Nostraxis</span><span aria-hidden="true">/</span><strong>{section}</strong></div>
    <div className="topbar-actions">
      <span className={`live-pill ${online ? '' : 'offline'}`} title={online ? 'Receiving live updates' : error}><i />{online ? 'Live' : 'Offline'}</span>
      <ProviderUsageDock initial={providerUsage} pricing={pricing} />
      <button type="button" className="icon-button topbar-sync" aria-label="Sync external sessions" title="Sync external sessions" disabled={syncing} onClick={sync}><ArrowsClockwise className={syncing ? 'spinning' : ''} /></button>
      <button type="button" className="primary-button" onClick={onNewSession}><Plus weight="bold" />New session</button>
    </div>
  </header>;
}

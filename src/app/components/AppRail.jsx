import { useEffect, useState } from 'react';
import {
  ActivityIcon as Activity, ArrowsOut, ChartBar, Flask, FolderOpen, SlidersHorizontal,
} from '@phosphor-icons/react';

const navItems = (experimentsEnabled) => [
  ['Sessions', Activity], ['Analytics', ChartBar], ['Compare', ArrowsOut],
  ...(experimentsEnabled ? [['R&D Lab', Flask]] : []),
  ['Repos', FolderOpen], ['Settings', SlidersHorizontal],
];

export function AppRail({ active, onChange, online, experimentsEnabled }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(interval);
  }, []);
  const currentTime = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(now);
  return <nav className="app-rail">
    <div className="wordmark"><strong>Nostra</strong><strong>xis</strong></div>
    <div className="rail-items">{navItems(experimentsEnabled).map(([label, Icon]) => <button key={label} aria-label={label} title={label} className={active === label ? 'active' : ''} onClick={() => onChange(label)}><Icon weight={active === label ? 'duotone' : 'regular'} /><span>{label}</span></button>)}</div>
    <div className="system-state"><span><i className={online ? '' : 'offline'} /> Current time</span><strong>{currentTime}</strong></div>
  </nav>;
}

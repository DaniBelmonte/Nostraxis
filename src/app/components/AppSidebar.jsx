import { useEffect, useState } from 'react';
import {
  ActivityIcon as Activity, ArrowsOut, ChartBar, Flask, FolderOpen, SidebarSimple, SlidersHorizontal,
} from '@phosphor-icons/react';

const STORAGE_KEY = 'nostraxis.sidebar.collapsed';
const readCollapsed = () => { try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; } };

const navGroups = ({ experimentsEnabled, sessions, repositories }) => [
  ['Observe', [['Sessions', Activity, sessions], ['Analytics', ChartBar], ['Compare', ArrowsOut]]],
  ['Workspace', [['Repos', FolderOpen, repositories], ...(experimentsEnabled ? [['R&D Lab', Flask, null, 'Beta']] : [])]],
  ['Admin', [['Settings', SlidersHorizontal]]],
];

export function AppSidebar({ active, onChange, online, experimentsEnabled, sessions, repositories }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0'); } catch { /* storage unavailable */ } }, [collapsed]);
  return <nav className={`app-sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Primary">
    <div className="sidebar-brand"><span className="sidebar-logo" aria-hidden="true">N</span><div><strong>Nostraxis</strong><small>Agent observability</small></div></div>
    {navGroups({ experimentsEnabled, sessions, repositories }).map(([group, items]) => <div key={group} className="sidebar-group">
      <span className="sidebar-label">{group}</span>
      {items.map(([label, Icon, count, tag]) => <button key={label} type="button" title={label} aria-current={active === label ? 'page' : undefined} className={active === label ? 'active' : ''} onClick={() => onChange(label)}>
        <Icon weight={active === label ? 'fill' : 'regular'} aria-hidden="true" /><span className="sidebar-text">{label}</span>
        {tag ? <em>{tag}</em> : Number.isFinite(count) && <small>{count}</small>}
      </button>)}
    </div>)}
    <div className="sidebar-foot">
      <span className="sidebar-status"><i className={online ? '' : 'offline'} />{online ? 'Local runtime online' : 'Runtime unreachable'}</span>
      <code className="sidebar-host">{window.location.host} · SQLite</code>
      <button type="button" className="sidebar-collapse" aria-expanded={!collapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(!collapsed)}>
        <SidebarSimple aria-hidden="true" /><span className="sidebar-text">Collapse sidebar</span>
      </button>
    </div>
  </nav>;
}

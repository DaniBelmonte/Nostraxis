import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Folder, House, X } from '@phosphor-icons/react';
import { api } from '../api/client';

export function FolderBrowserDialog({ initialPath = '', eyebrow = 'Workspace folder', description = 'Choose the workspace where your agent sessions were run. The original sessions stay in their history source.', onClose, onSelect }) {
  const [requestedPath, setRequestedPath] = useState(initialPath);
  const [pathInput, setPathInput] = useState(initialPath);
  const [listing, setListing] = useState(null);
  const [search, setSearch] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const closeButton = useRef(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    closeButton.current?.focus();
    return () => previousFocus?.focus?.();
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.browseFolders(requestedPath).then((result) => {
      if (!active) return;
      setListing(result);
      setPathInput(result.path);
      setSearch('');
    }).catch((reason) => {
      if (active) setError(reason.message === 'API route not found.' ? 'The local server is out of date. Restart Nostraxis and try again.' : reason.message);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [requestedPath]);

  const navigate = (folderPath) => {
    if (!folderPath || folderPath === requestedPath) return;
    setRequestedPath(folderPath);
  };
  const choose = async () => {
    if (!listing || selecting) return;
    setSelecting(true);
    setError('');
    try { await onSelect(listing.path); onClose(); }
    catch (reason) { setError(reason.message); }
    finally { setSelecting(false); }
  };
  const visibleFolders = listing?.folders.filter((folder) => (showHidden || !folder.name.startsWith('.')) && folder.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())) || [];

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="folder-browser" role="dialog" aria-modal="true" aria-labelledby="folder-browser-title" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
      <header><div><span>{eyebrow}</span><h2 id="folder-browser-title">Select a folder</h2></div><button ref={closeButton} type="button" aria-label="Close folder browser" onClick={onClose}><X /></button></header>
      <p className="folder-browser-intro">{description}</p>
      <div className="folder-browser-shortcuts">{listing?.shortcuts.map((shortcut) => <button type="button" key={shortcut.name} onClick={() => navigate(shortcut.path)}><House /> {shortcut.name}</button>)}</div>
      <form className="folder-browser-location" onSubmit={(event) => { event.preventDefault(); navigate(pathInput.trim()); }}><label htmlFor="folder-browser-path">Current folder</label><div><input id="folder-browser-path" value={pathInput} onChange={(event) => setPathInput(event.target.value)} spellCheck={false} /><button type="submit" className="secondary-button" disabled={loading || !pathInput.trim()}>Go</button></div></form>
      <div className="folder-browser-tools"><button type="button" className="secondary-button" disabled={!listing?.parent || loading} onClick={() => navigate(listing.parent)}><ArrowUp /> Parent</button><input aria-label="Filter folders" placeholder="Filter folders…" value={search} onChange={(event) => setSearch(event.target.value)} disabled={!listing || loading} /><label><input type="checkbox" checked={showHidden} onChange={(event) => setShowHidden(event.target.checked)} /> Hidden</label></div>
      <div className="folder-browser-list" aria-busy={loading}>{loading ? <p>Loading folders…</p> : visibleFolders.length ? visibleFolders.map((folder) => <button type="button" key={folder.path} onClick={() => navigate(folder.path)}><Folder /><span>{folder.name}</span></button>) : <p>{search ? 'No folders match this filter.' : 'No subfolders here.'}</p>}</div>
      {error && <p className="folder-browser-error" role="alert">{error}</p>}
      <footer><code title={listing?.path}>{listing?.path || 'No folder selected'}</code><button type="button" className="primary-button" disabled={!listing || loading || selecting || !!error} onClick={choose}>{selecting ? 'Adding…' : 'Select this folder'}</button></footer>
    </section>
  </div>;
}

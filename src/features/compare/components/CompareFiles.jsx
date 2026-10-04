import { useState } from 'react';
import { FolderOpen } from '@phosphor-icons/react';
import { relativeFilePath, runLabel } from '../model/comparison';

function buildFileTree(files, repositoryPath) {
  const root = { name: '', folders: new Map(), files: [], count: 0 };
  for (const file of files) {
    const parts = relativeFilePath(file.path, repositoryPath).split('/').filter(Boolean);
    const fileName = parts.pop() || file.path;
    let node = root;
    node.count++;
    for (const folder of parts) {
      if (!node.folders.has(folder)) node.folders.set(folder, { name: folder, folders: new Map(), files: [], count: 0 });
      node = node.folders.get(folder);
      node.count++;
    }
    node.files.push({ ...file, fileName });
  }
  return root;
}

function FileTreeNode({ node, depth = 0, expanded = false }) {
  const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => a.fileName.localeCompare(b.fileName));
  return <>{folders.map(folder => <details key={`${depth}:${folder.name}`} className="file-tree-folder" open={expanded || depth === 0 ? true : undefined}>
    <summary><FolderOpen /><span>{folder.name}</span><small>{folder.count}</small></summary>
    <div><FileTreeNode node={folder} depth={depth + 1} expanded={expanded} /></div>
  </details>)}{files.map(file => <div className={`file-tree-file ${file.sensitive ? 'sensitive' : ''}`} key={file.path} title={file.path}>
    <span>{file.fileName}</span><small>{file.reads ? `${file.reads}R` : ''}{file.reads && file.writes ? ' · ' : ''}{file.writes ? `${file.writes}W` : ''}{file.sensitive ? ' · sensitive' : ''}</small>
  </div>)}</>;
}

export function CompareFiles({ rows, colors, onInspect }) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('all');
  const normalizedQuery = query.trim().toLowerCase();
  const visible = file => (!normalizedQuery || file.path.toLowerCase().includes(normalizedQuery))
    && (mode === 'all' || mode === 'read' && file.reads > 0 || mode === 'write' && file.writes > 0 || mode === 'sensitive' && file.sensitive);
  return <section className="panel-block compare-files">
    <header><div><span>Explorer</span><h2>Observed files by run</h2></div><div className="compare-file-controls"><input aria-label="Search compared files" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search path or file…" /><div role="group" aria-label="Filter files">{[['all','All'],['read','Read'],['write','Modified'],['sensitive','Sensitive']].map(([id,label]) => <button key={id} type="button" className={mode === id ? 'active' : ''} aria-pressed={mode === id} onClick={() => setMode(id)}>{label}</button>)}</div></div></header>
    <div className="compare-file-grid">{rows.map((row, index) => {
      const files = (row.files || []).filter(visible);
      const reads = files.reduce((total, file) => total + file.reads, 0);
      const writes = files.reduce((total, file) => total + file.writes, 0);
      return <article key={row.key} style={{ borderTopColor: colors[index] }}><div className="compare-file-heading">{row.source === 'local' ? <button type="button" className="compare-run-link" onClick={() => onInspect?.(row.run.id)}>{runLabel(row)}</button> : <strong className="compare-run-link">{runLabel(row)}</strong>}<span>{files.length} of {row.files?.length || 0} files</span><small>{reads} reads · {writes} writes</small></div><div className="file-tree">{files.length ? <FileTreeNode node={buildFileTree(files, row.run.repositoryPath)} expanded={Boolean(normalizedQuery)} /> : <p>No files match this filter.</p>}</div></article>;
    })}</div>
  </section>;
}

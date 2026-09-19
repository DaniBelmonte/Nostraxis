import { useEffect, useState } from 'react';
import { FolderOpen } from '@phosphor-icons/react';
import { api } from '../../../shared/api/client';
import { compact, credits, duration, money, percent } from '../../../shared/lib/metrics';

function relativeFilePath(filePath, repositoryPath = '') {
  const normalized = String(filePath || '').replaceAll('\\', '/');
  const root = String(repositoryPath || '').replaceAll('\\', '/').replace(/\/$/, '');
  return root && normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized.replace(/^\.\//, '');
}

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

function CompareFiles({ rows }) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('all');
  const normalizedQuery = query.trim().toLowerCase();
  const visible = file => (!normalizedQuery || file.path.toLowerCase().includes(normalizedQuery))
    && (mode === 'all' || mode === 'read' && file.reads > 0 || mode === 'write' && file.writes > 0 || mode === 'sensitive' && file.sensitive);
  return <section className="compare-files panel-block">
    <header><div><span>Explorer</span><h2>Observed files</h2></div><div className="compare-file-controls"><input aria-label="Search compared files" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search path or file…" /><div role="group" aria-label="Filter files">{[['all','All'],['read','Read'],['write','Modified'],['sensitive','Sensitive']].map(([id,label]) => <button key={id} className={mode === id ? 'active' : ''} onClick={() => setMode(id)}>{label}</button>)}</div></div></header>
    <div className="compare-file-grid">{rows.map(row => {
      const files = (row.files || []).filter(visible);
      const reads = files.reduce((total, file) => total + file.reads, 0);
      const writes = files.reduce((total, file) => total + file.writes, 0);
      return <article key={row.run.id}><div className="compare-file-heading"><button className="compare-run-link" onClick={() => row.onInspect?.(row.run.id)}>{row.run.name}</button><span>{files.length} of {row.files?.length || 0} files</span><small>{reads} reads · {writes} writes</small></div><div className="file-tree">{files.length ? <FileTreeNode node={buildFileTree(files, row.run.repositoryPath)} expanded={Boolean(normalizedQuery)} /> : <p>No files match this filter.</p>}</div></article>;
    })}</div>
  </section>;
}

export function CompareDetail({ ids, onInspect }) {
  const [rows, setRows] = useState([]);
  useEffect(() => { if (ids.length) api.compare(ids).then(setRows).catch(() => {}); else setRows([]); }, [ids.join('|')]);
  return <section className="compare-detail">
    <header className="compare-detail-head">
      <div><span>Reproducible benchmark</span><h2>Comparing {rows.length || ids.length} runs</h2></div>
    </header>
    <section className="compare-matrix" style={{gridTemplateColumns:`136px repeat(${Math.max(1,rows.length)}, minmax(220px, 1fr))`}}>
      <div className="matrix-labels">
        <span>Run</span><span>Model</span><span>Tokens</span><span>Cost</span><span>Provider credits</span>
        <span>Duration</span><span>Cache hit</span><span>Reasoning</span><span>Evaluation</span>
        <span>Tools</span><span>Files</span><span>Context digest</span><span>Output</span>
      </div>
      {rows.map((row) => <article key={row.run.id}>
        <button className="compare-run-link" onClick={() => onInspect(row.run.id)}>{row.run.name}</button>
        <code>{row.run.provider} / {row.run.model || 'auto'}</code>
        <strong title={`Input: ${compact(row.metrics.inputTokens)} · Output: ${compact(row.metrics.outputTokens)} · Cache: ${compact(row.metrics.cachedTokens)}`}>{Number.isFinite(row.metrics.totalTokens) ? compact(row.metrics.totalTokens) : Number.isFinite(row.metrics.observedTokens) ? `${compact(row.metrics.observedTokens)} agents` : 'Not reported'} <small>in {compact(row.metrics.inputTokens)} / out {compact(row.metrics.outputTokens)}</small></strong>
        <strong>{money(row.metrics.costUsd)}</strong>
        <strong>{Number.isFinite(row.metrics.providerCredits) ? `${credits(row.metrics.providerCredits)} ${row.metrics.creditUnit || ''}` : 'Not reported'}</strong>
        <strong>{duration(row.metrics.durationMs)}</strong>
        <strong>{percent(row.metrics.cacheHit)}</strong>
        <strong>{compact(row.metrics.reasoningTokens)}</strong>
        <strong>{Number.isFinite(row.metrics.evaluationScore) ? row.metrics.evaluationScore.toFixed(2) : 'Not reported'}</strong>
        <p>{row.tools?.length ? row.tools.map((tool) => `${tool.name} ×${tool.count}`).join(' · ') : 'Not reported'}</p>
        <p>{row.files?.length ? `${row.files.length} files · ${row.files.reduce((total,file)=>total+file.reads,0)} reads · ${row.files.reduce((total,file)=>total+file.writes,0)} writes` : 'Not reported'}</p>
        <code>{row.contextDigest?.slice(0, 12) || 'Not available'}</code>
        <p>{row.output ? 'View full response below' : 'No response captured'}</p>
      </article>)}
    </section>
    <CompareFiles rows={rows.map(row => ({ ...row, onInspect }))} />
    <div className="compare-responses">{rows.map(row=><section key={row.run.id}><button className="compare-run-link" onClick={()=>onInspect(row.run.id)}>{row.run.name}</button><h3>Available final response</h3><pre>{row.output || 'Not available'}</pre></section>)}</div>
  </section>;
}

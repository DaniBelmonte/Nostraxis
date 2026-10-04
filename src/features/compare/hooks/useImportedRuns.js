import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api/client';

// Runs imported from JSONL exports of another Nostraxis. They are stored by
// the local server apart from local sessions and only appear in Compare.
export function useImportedRuns() {
  const [imports, setImports] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const reload = useCallback(() => api.imports().then(setImports).catch((reason) => setError(reason.message)), []);
  useEffect(() => { reload(); }, [reload]);

  const importFiles = async (files) => {
    setBusy(true); setError(null);
    const added = [], failed = [];
    for (const file of files) {
      try { added.push(await api.importRun(file.name, await file.text())); }
      catch (reason) { failed.push(`${file.name}: ${reason.message}`); }
    }
    if (failed.length) setError(failed.join(' '));
    await reload();
    setBusy(false);
    return added;
  };

  const remove = async (id) => {
    try { await api.deleteImport(id); await reload(); }
    catch (reason) { setError(reason.message); }
  };

  return { imports, busy, error, clearError: () => setError(null), importFiles, remove };
}

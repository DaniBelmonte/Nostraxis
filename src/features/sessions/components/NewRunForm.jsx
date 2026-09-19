import { useState } from 'react';
import { api } from '../../../shared/api/client';

export function NewRunForm({ data, onCreated, onError }) {
  const available = data.providers.find((provider) => provider.available)?.id || 'custom';
  const [form, setForm] = useState({
    repositoryId: data.repositories[0]?.id || '', provider: available, model: '',
    name: 'Developer task', prompt: 'Inspect the repository and identify the smallest safe optimization.',
    allowWrites: false, allowShell: true, executable: '',
  });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    try { onCreated(await api.createRun(form)); }
    catch (reason) { onError(reason.message); }
  };
  return <form className="modal-form" onSubmit={submit}>
    <label>Repository<select value={form.repositoryId} onChange={(event) => update('repositoryId', event.target.value)}>{data.repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label>
    <label>Provider<select value={form.provider} onChange={(event) => update('provider', event.target.value)}>{data.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}{provider.available ? '' : ' · not detected'}</option>)}</select></label>
    <label>Model<input value={form.model} onChange={(event) => update('model', event.target.value)} placeholder="empty = provider default" /></label>
    {form.provider === 'custom' && <label>JSONL executable<input value={form.executable} onChange={(event) => update('executable', event.target.value)} placeholder="/absolute/path/to/runner" /></label>}
    <label>Name<input value={form.name} onChange={(event) => update('name', event.target.value)} /></label>
    <label>Goal<textarea value={form.prompt} onChange={(event) => update('prompt', event.target.value)} /></label>
    <div className="permission-row"><label><input type="checkbox" checked={form.allowShell} onChange={(event) => update('allowShell', event.target.checked)} /> Commands</label><label><input type="checkbox" checked={form.allowWrites} onChange={(event) => update('allowWrites', event.target.checked)} /> Writes</label></div>
    <button className="primary-button" disabled={!form.repositoryId}>Create session</button>
  </form>;
}

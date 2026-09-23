import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { describeProvider } from './base.mjs';
import { codex } from './codex.mjs';
import { claude } from './claude.mjs';
import { copilot } from './copilot.mjs';
import { custom } from './custom.mjs';
import { hermes } from './hermes.mjs';

const exec = promisify(execFile);
export const adapters = { codex, claude, copilot, hermes, custom };
export const adapterFor = (id) => {
  if (!adapters[id]) throw new Error(`Unknown provider: ${id}`);
  return adapters[id];
};

async function findExecutable(id) {
  const configured = process.env[`NOSTRAXIS_${id.toUpperCase()}_BIN`];
  const candidates = configured ? [configured] : [
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map((entry) => path.join(entry, id)),
    path.join(os.homedir(), '.local', 'bin', id),
  ];
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return candidate; }
    catch { /* continue */ }
  }
  return null;
}

export async function detectProviders() {
  const results = [];
  for (const adapter of Object.values(adapters)) {
    if (adapter.id === 'custom') {
      results.push(describeProvider(adapter, { available: true, version: 'Open JSONL protocol' }));
      continue;
    }
    const executable = await findExecutable(adapter.id);
    try {
      const { stdout, stderr } = await exec(executable || adapter.id, ['--version'], { timeout: adapter.detectTimeoutMs || 5000, maxBuffer: 64_000 });
      results.push(describeProvider(adapter, { available: true, version: String(stdout || stderr).trim().split('\n')[0] }));
    } catch (error) {
      results.push(describeProvider(adapter, { available: false, error: executable ? String(error.message).slice(0, 240) : 'CLI not found in PATH' }));
    }
  }
  return results;
}

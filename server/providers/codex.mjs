import { normalizeProviderLine } from '../core/normalized-events.mjs';

export const codex = {
  id: 'codex',
  name: 'Codex',
  capabilities: { continuation: true, usage: true, reasoning: true },
  build({ prompt, model, sessionRef, allowWrites }) {
    const flags = ['--json', '--skip-git-repo-check', '--sandbox', allowWrites ? 'workspace-write' : 'read-only', ...(model ? ['--model', model] : [])];
    return {
      command: process.env.NOSTRAXIS_CODEX_BIN || 'codex',
      args: sessionRef ? ['exec', 'resume', sessionRef, ...flags, '-'] : ['exec', ...flags, '-'],
      stdin: prompt,
    };
  },
  parse: (line, channel) => normalizeProviderLine(line, 'codex', channel),
  sessionRef: (event) => event.data?.thread_id || event.data?.session_id || null,
};

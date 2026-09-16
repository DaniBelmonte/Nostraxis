import { normalizeProviderLine } from '../core/normalized-events.mjs';

export const copilot = {
  id: 'copilot',
  name: 'GitHub Copilot',
  capabilities: { continuation: true, usage: true, credits: true },
  build({ prompt, model, sessionRef, allowWrites, allowShell }) {
    return {
      command: process.env.NOSTRAXIS_COPILOT_BIN || 'copilot',
      args: ['-p', prompt, '--output-format', 'json', '--no-color', '--no-ask-user', '--no-auto-update', ...(sessionRef ? ['--session-id', sessionRef] : []), '--allow-tool=read', allowWrites ? '--allow-tool=write' : '--deny-tool=write', allowShell ? '--allow-tool=shell' : '--deny-tool=shell', ...(model ? ['--model', model] : [])],
    };
  },
  parse: (line, channel) => normalizeProviderLine(line, 'copilot', channel),
  sessionRef: (event) => event.data?.session_id || event.data?.data?.sessionId || null,
};

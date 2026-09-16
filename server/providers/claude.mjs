import { normalizeProviderLine } from '../core/normalized-events.mjs';

export const claude = {
  id: 'claude',
  name: 'Claude Code',
  capabilities: { continuation: true, usage: true, reasoning: true, cost: true },
  build({ prompt, model, sessionRef, allowWrites, allowShell }) {
    const tools = ['Read', 'Glob', 'Grep', ...(allowWrites ? ['Edit', 'Write'] : []), ...(allowShell ? ['Bash'] : [])].join(',');
    return {
      command: process.env.NOSTRAXIS_CLAUDE_BIN || 'claude',
      args: ['-p', '--verbose', '--output-format', 'stream-json', '--permission-mode', 'dontAsk', '--tools', tools, '--allowedTools', tools, ...(model ? ['--model', model] : []), ...(sessionRef ? ['--resume', sessionRef] : [])],
      stdin: prompt,
    };
  },
  parse: (line, channel) => normalizeProviderLine(line, 'claude', channel),
  sessionRef: (event) => event.data?.session_id || null,
};

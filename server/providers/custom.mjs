import { normalizeProviderLine } from '../core/normalized-events.mjs';

// The executable comes from the request body, so the provider is opt-in.
export const customProviderEnabled = () => process.env.NOSTRAXIS_CUSTOM_PROVIDER === '1';

export const custom = {
  id: 'custom',
  name: 'Custom JSONL',
  capabilities: { modelSelection: false, tools: false, usage: false },
  build({ prompt, executable, args = [] }) {
    if (!customProviderEnabled()) throw new Error('Custom provider is disabled. Set NOSTRAXIS_CUSTOM_PROVIDER=1 to enable it.');
    if (!String(executable || '').trim()) throw new Error('Custom provider requires an executable.');
    if (!Array.isArray(args) || !args.every((value) => typeof value === 'string')) throw new Error('Custom provider args must be strings.');
    return { command: executable, args: args.map((value) => value.replaceAll('{prompt}', prompt)), stdin: args.some((value) => value.includes('{prompt}')) ? undefined : prompt };
  },
  parse: (line, channel) => normalizeProviderLine(line, 'custom', channel),
  sessionRef: () => null,
};

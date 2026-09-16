export const defaultCapabilities = {
  streaming: true,
  continuation: false,
  modelSelection: true,
  tools: true,
  usage: false,
  reasoning: false,
  cost: false,
};

export function describeProvider(adapter, detected) {
  return {
    id: adapter.id,
    name: adapter.name,
    available: detected?.available === true,
    version: detected?.version || null,
    error: detected?.error || null,
    capabilities: { ...defaultCapabilities, ...adapter.capabilities },
  };
}

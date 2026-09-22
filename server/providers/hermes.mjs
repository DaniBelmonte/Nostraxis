export const hermes = {
  id: 'hermes',
  name: 'Hermes Agent',
  detectTimeoutMs: 15_000,
  capabilities: {
    managedRuns: false,
    history: true,
    continuation: true,
    modelSelection: true,
    tools: true,
    usage: true,
    reasoning: true,
    cost: true,
  },
  build() {
    throw new Error('Hermes managed runs are not enabled in this proof of concept. Import its local sessions instead.');
  },
  parse: () => ({ type: 'agent.log', text: '' }),
  sessionRef: () => null,
};

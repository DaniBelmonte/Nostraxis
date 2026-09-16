let input = '';
for await (const chunk of process.stdin) input += chunk;

const events = [
  { type: 'agent.thinking', text: `Received ${input.trim().length} prompt characters` },
  { type: 'agent.file_read', path: 'src/example.js', text: 'Read src/example.js' },
  { type: 'agent.command_started', command: 'npm test', text: 'npm test' },
  { type: 'agent.output', text: 'Optimization complete.' },
  { type: 'agent.usage', text: 'Usage', usage: { input_tokens: 120, output_tokens: 30, cached_input_tokens: 80 } },
];

for (const event of events) process.stdout.write(`${JSON.stringify(event)}\n`);

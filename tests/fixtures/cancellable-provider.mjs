const stubborn = process.argv.includes('--ignore-term');
process.on('SIGTERM', () => {
  if (stubborn) return;
  process.stdout.write(`${JSON.stringify({ type: 'agent.output', text: 'Partial result preserved.' })}\n`);
  setTimeout(() => process.exit(0), 30);
});
process.stdout.write(`${JSON.stringify({ type: 'agent.log', text: `ready:${process.pid}` })}\n`);
setInterval(() => {}, 1000);

#!/usr/bin/env node
import { appendFileSync } from 'node:fs';

const sessionId = 'managed-copilot-otel-session';
const timestamp = new Date().toISOString();
process.stdout.write(`${JSON.stringify({
  type: 'session.start',
  data: { sessionId, selectedModel: 'gpt-copilot-test', startTime: timestamp },
})}\n`);
process.stdout.write(`${JSON.stringify({ type: 'assistant.message', data: { content: 'Copilot fixture completed.' } })}\n`);

if (process.env.COPILOT_OTEL_FILE_EXPORTER_PATH) {
  appendFileSync(process.env.COPILOT_OTEL_FILE_EXPORTER_PATH, `${JSON.stringify({
    name: 'invoke_agent', traceId: 'fixture-trace', spanId: 'fixture-root',
    startTime: timestamp, endTime: new Date(Date.now() + 10).toISOString(),
    attributes: {
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.conversation.id': sessionId,
      'gen_ai.request.model': 'gpt-copilot-test',
      'gen_ai.usage.input_tokens': 700,
      'gen_ai.usage.output_tokens': 80,
      'gen_ai.usage.cache_read.input_tokens': 200,
      'github.copilot.nano_aiu': 1250000000,
      'server.address': 'api.githubcopilot.com',
    },
  })}\n`);
}

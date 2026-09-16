import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRunJsonl, runExportFilename } from '../server/exports/run-jsonl.mjs';

test('full-run JSONL keeps raw events and exposes comparison fields', () => {
  const output = buildRunJsonl({
    run: {
      id: 'run / one', provider: 'codex', model: 'gpt-test', status: 'completed',
      startedAt: '2026-09-16T10:00:00.000Z', endedAt: '2026-09-16T10:00:02.500Z',
      prompt: 'Compare this response.', response: 'Done.', usage: { input: 120, cost: 0.012 },
    },
    events: [{
      id: 7, timestamp: '2026-09-16T10:00:01.000Z', type: 'agent.output', provider: 'codex',
      data: { text: 'A model response', tokensDelta: 20, costDelta: 0.002, usage: { input: 120, output: 30, cost: 0.012 }, raw: { providerEvent: 'message' } },
    }],
  }, { exportedAt: '2026-09-16T10:01:00.000Z' });
  const [manifest, event] = output.trim().split('\n').map(JSON.parse);

  assert.equal(manifest.recordType, 'nostraxis.run-export');
  assert.equal(manifest.eventCount, 1);
  assert.equal(manifest.run.durationMs, 2500);
  assert.equal(event.recordType, 'nostraxis.run-event');
  assert.equal(event.event, 'A model response');
  assert.equal(event.inputTokensCumulative, 120);
  assert.equal(event.costUsdDelta, 0.002);
  assert.deepEqual(event.data.raw, { providerEvent: 'message' });
  assert.equal(runExportFilename(manifest.run), 'nostraxis-full-run-run___one.jsonl');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUsageChartPoints, paddedChartDomain } from '../src/shared/lib/metrics.js';

test('credit chart keeps the final provider unit and coalesces duplicate timestamps', () => {
  const detail = {
    run: { usage: { creditUnit: 'AI credits' } },
    events: [
      { id: 'premium-0', timestamp: '2026-09-09T10:00:00.000Z', data: { usage: { credits: 0, creditUnit: 'premium requests' } } },
      { id: 'credits-1', timestamp: '2026-09-09T10:00:00.000Z', data: { usage: { credits: 3.5, creditUnit: 'AI credits' } } },
      { id: 'premium-1', timestamp: '2026-09-09T10:01:00.000Z', data: { usage: { credits: 1, creditUnit: 'premium requests' } } },
      { id: 'credits-2', timestamp: '2026-09-09T10:01:00.000Z', data: { usage: { credits: 7.25, creditUnit: 'AI credits' } } },
    ],
  };

  const points = buildUsageChartPoints(detail);
  assert.deepEqual(points.map(({ at, credits, creditsDelta }) => ({ at, credits, creditsDelta })), [
    { at: Date.parse('2026-09-09T10:00:00.000Z'), credits: 3.5, creditsDelta: null },
    { at: Date.parse('2026-09-09T10:01:00.000Z'), credits: 7.25, creditsDelta: 3.75 },
  ]);
});

test('chart domain pads a flat series instead of pinning it to an edge', () => {
  const [minimum, maximum] = paddedChartDomain([34.1]);
  assert.ok(Math.abs(minimum - 30.008) < 1e-9);
  assert.ok(Math.abs(maximum - 38.192) < 1e-9);
});

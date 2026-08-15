import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaderboardChartConfig, treasuryChartConfig, stockChartConfig } from '../src/charts.js';

test('leaderboardChartConfig sorts descending and uses a single mark color with no legend', () => {
  const config = leaderboardChartConfig([
    { name: 'Alice', gold: 50 },
    { name: 'Bob', gold: 200 },
    { name: 'Cara', gold: 100 },
  ]);
  assert.equal(config.type, 'bar');
  assert.deepEqual(config.data.labels, ['Bob', 'Cara', 'Alice']);
  assert.deepEqual(config.data.datasets[0].data, [200, 100, 50]);
  assert.equal(config.data.datasets.length, 1);
  assert.equal(config.options.plugins.legend.display, false);
});

test('treasuryChartConfig keeps chronological order and does not force zero into frame', () => {
  const config = treasuryChartConfig([
    { label: 'Aug 1', balance: 500 },
    { label: 'Aug 2', balance: 620 },
  ]);
  assert.equal(config.type, 'line');
  assert.deepEqual(config.data.labels, ['Aug 1', 'Aug 2']);
  assert.deepEqual(config.data.datasets[0].data, [500, 620]);
  assert.equal(config.options.scales.y.beginAtZero, false);
});

test('stockChartConfig sorts descending by quantity', () => {
  const config = stockChartConfig([
    { name: 'Wheat', quantity: 10 },
    { name: 'Cabbage', quantity: 40 },
  ]);
  assert.deepEqual(config.data.labels, ['Cabbage', 'Wheat']);
  assert.deepEqual(config.data.datasets[0].data, [40, 10]);
  assert.equal(config.options.scales.y.beginAtZero, true);
});

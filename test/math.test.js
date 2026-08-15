import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitProportionally, planConsumption } from '../src/math.js';

test('splitProportionally divides a total proportionally to weight', () => {
  const result = splitProportionally(
    [
      { key: 'a', weight: 3 },
      { key: 'b', weight: 1 },
    ],
    100
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].sharePct, 0.75);
  assert.equal(result[0].amount, 75);
  assert.equal(result[1].sharePct, 0.25);
  assert.equal(result[1].amount, 25);
});

test('splitProportionally returns nothing when there is no weight to split', () => {
  assert.deepEqual(splitProportionally([], 100), []);
  assert.deepEqual(splitProportionally([{ key: 'a', weight: 0 }], 100), []);
});

test('planConsumption draws proportionally across lots when stock covers the request', () => {
  const lots = [
    { id: 1, memberId: 'a', quantity: 6 },
    { id: 2, memberId: 'b', quantity: 2 },
  ];
  const { takes, deficit } = planConsumption(lots, 4);
  assert.equal(deficit, 0);
  assert.equal(takes.length, 2);
  assert.equal(takes[0].quantity, 3); // 6/8 share of the 4 requested
  assert.equal(takes[1].quantity, 1); // 2/8 share of the 4 requested
});

test('planConsumption rounds drawn quantities so they cannot leave floating-point dust', () => {
  // A three-way split of 1 unit is 0.333... recurring in binary floating
  // point — summed naively this is 0.9999999999999999, not exactly 1.
  const lots = [
    { id: 1, memberId: 'a', quantity: 1 },
    { id: 2, memberId: 'b', quantity: 1 },
    { id: 3, memberId: 'c', quantity: 1 },
  ];
  const { takes } = planConsumption(lots, 1);
  const total = takes.reduce((sum, t) => sum + t.quantity, 0);
  assert.ok(Number.isInteger(total * 1e6), `expected no sub-1e-6 dust, got ${total}`);
});

test('planConsumption reports a deficit when the request exceeds available stock', () => {
  const lots = [{ id: 1, memberId: 'a', quantity: 5 }];
  const { takes, deficit } = planConsumption(lots, 8);
  assert.equal(deficit, 3);
  assert.equal(takes.length, 1);
  assert.equal(takes[0].quantity, 5); // everything available gets drawn
});

test('planConsumption treats an empty lot list as a full deficit', () => {
  const { takes, deficit } = planConsumption([], 5);
  assert.equal(takes.length, 0);
  assert.equal(deficit, 5);
});

test('planConsumption still consumes unattributed lots without crediting anyone', () => {
  const lots = [{ id: 1, memberId: null, quantity: 10 }];
  const { takes, deficit } = planConsumption(lots, 4);
  assert.equal(deficit, 0);
  assert.equal(takes.length, 1);
  assert.equal(takes[0].memberId, null);
  assert.equal(takes[0].quantity, 4);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidId } from '../src/ids.js';

test('isValidId accepts plain digit strings', () => {
  assert.equal(isValidId('1'), true);
  assert.equal(isValidId('42'), true);
});

test('isValidId rejects free text a user typed instead of picking a suggestion', () => {
  assert.equal(isValidId('Cabbage'), false);
  assert.equal(isValidId(''), false);
  assert.equal(isValidId('12abc'), false);
  assert.equal(isValidId('-1'), false);
  assert.equal(isValidId('1.5'), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDueDate, formatDate, isOverdue } from '../src/dates.js';

test('parseDueDate accepts a valid YYYY-MM-DD date', () => {
  const date = parseDueDate('2026-08-25');
  assert.ok(date instanceof Date);
  assert.equal(date.getUTCFullYear(), 2026);
  assert.equal(date.getUTCMonth(), 7); // 0-indexed
  assert.equal(date.getUTCDate(), 25);
});

test('parseDueDate sets the time to end of day UTC', () => {
  const date = parseDueDate('2026-08-25');
  assert.equal(date.getUTCHours(), 23);
  assert.equal(date.getUTCMinutes(), 59);
});

test('parseDueDate rejects malformed input', () => {
  assert.equal(parseDueDate('08/25/2026'), null);
  assert.equal(parseDueDate('next tuesday'), null);
  assert.equal(parseDueDate(''), null);
  assert.equal(parseDueDate('2026-8-25'), null); // must be zero-padded
});

test('parseDueDate rejects calendar dates that do not exist', () => {
  assert.equal(parseDueDate('2026-02-30'), null); // no Feb 30
  assert.equal(parseDueDate('2026-13-01'), null); // no month 13
});

test('formatDate renders a human-readable date', () => {
  const date = new Date('2026-08-25T23:59:59Z');
  assert.equal(formatDate(date), 'Aug 25, 2026');
});

test('isOverdue compares against the current time', () => {
  assert.equal(isOverdue(new Date('2000-01-01')), true);
  assert.equal(isOverdue(new Date('2999-01-01')), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { earliestDateInAstrakhan, todayInAstrakhan } from '../src/calendar-date';

test('календарь доставки переходит на следующий день после полуночи в Астрахани', () => {
  const beforeMidnight = new Date('2026-09-30T19:59:59Z');
  const afterMidnight = new Date('2026-09-30T20:00:00Z');
  assert.equal(todayInAstrakhan(beforeMidnight), '2026-09-30');
  assert.equal(todayInAstrakhan(afterMidnight), '2026-10-01');
  assert.equal(earliestDateInAstrakhan(2, afterMidnight), '2026-10-03');
});

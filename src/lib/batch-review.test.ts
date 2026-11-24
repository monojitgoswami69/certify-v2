import { expect, it } from 'vitest';
import { rankReviewRecords, relatedRecords, type ReviewRecord } from './batch-review';

const record = (number: number, name = 'Ada', email = 'ada@example.test'): ReviewRecord => ({ number, name, email, row: {} });

it('keeps shared names and addresses available and groups identical recipient identities for review', () => {
  const { notes, conflicts } = relatedRecords([
    record(2), record(4, 'ADA', 'different@example.test'), record(5, 'Grace'), record(7, 'ada', 'ADA@example.test'),
  ]);
  expect([...notes.keys()].sort()).toEqual([2, 4, 5, 7]);
  expect(conflicts).toEqual([[2, 7]]);
});

it('surfaces overflow, blank values and the most severe shrinkage first without reordering the roster', () => {
  const rows = [record(2), record(4), record(5), record(6), record(8), { ...record(11), blocked: 'Invalid email' }];
  const warnings = new Map([
    [2, { priority: 1.1, messages: ['Tight'] }],
    [4, { priority: 1.8, messages: ['Tight'] }],
    [5, { priority: 2, messages: ['Blank'] }],
    [6, { priority: 3, messages: ['Overflow'] }],
  ]);
  expect(rankReviewRecords(rows, warnings).map(({ number }) => number)).toEqual([11, 6, 5, 4, 2, 8]);
  expect(rows.map(({ number }) => number)).toEqual([2, 4, 5, 6, 8, 11]);
});

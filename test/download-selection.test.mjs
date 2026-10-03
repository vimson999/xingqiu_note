import assert from 'node:assert/strict';
import test from 'node:test';
import { isWithinUploadRange, selectBatchTasks } from '../src/utils/download-selection.mjs';

const items = [
  { name: 'older', status: 'pending', uploadTime: '2026-09-01 12:00', downloadCount: 40 },
  { name: 'newer', status: 'pending', uploadTime: '2026-09-02 12:00', downloadCount: 10 },
  { name: 'unknown', status: 'pending', downloadCount: 25 },
  { name: 'failed', status: 'failed', uploadTime: '2026-09-03 12:00', downloadCount: 50 }
];

test('an explicit empty selection never becomes an unrestricted download batch', () => {
  assert.deepEqual(selectBatchTasks(items, { filterNames: [], limit: 0 }), []);
  assert.equal(selectBatchTasks(items).length, 3);
});

test('sorts eligible tasks before limiting without changing the source list', () => {
  const before = structuredClone(items);
  assert.deepEqual(selectBatchTasks(items, { limit: 1 }).map(item => item.name), ['newer']);
  assert.deepEqual(selectBatchTasks(items, { limit: 1, sort: 'count_desc' }).map(item => item.name), ['older']);
  assert.deepEqual(selectBatchTasks(items, { limit: 1, sort: 'time_asc' }).map(item => item.name), ['older']);
  assert.deepEqual(items, before);
});

test('applies history, status, count threshold and explicit names before limiting', () => {
  assert.deepEqual(selectBatchTasks(items, {
    filterNames: ['older', 'newer', 'unknown'], downloadedNames: ['older'], minCount: 25
  }).map(item => item.name), ['unknown']);
  assert.deepEqual(selectBatchTasks(items, {
    statuses: ['failed'], limit: 0
  }).map(item => item.name), ['failed']);
});

test('unknown dates stay visible without a date filter but are excluded with a bound', () => {
  const start = new Date('2026-09-01T12:00').getTime();
  assert.equal(isWithinUploadRange(items[2], null, null), true);
  assert.equal(isWithinUploadRange(items[2], start, null), false);
  assert.equal(isWithinUploadRange(items[0], start, start), true);
  assert.equal(isWithinUploadRange(items[0], start + 1, null), false);
  assert.equal(isWithinUploadRange(items[0], null, start - 1), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBatchProgress,
  formatBatchProgress,
  updateBatchProgress
} from '../src/utils/batch-progress.mjs';

test('shows the active file task as 3 / 30 with success and failure counts', () => {
  const progress = updateBatchProgress(
    createBatchProgress({ kind: 'file', label: '文件批量下载', total: 30 }),
    {
      phase: 'running',
      current: 3,
      success: 2,
      failed: 0,
      currentName: '示例研报.pdf'
    }
  );

  assert.deepEqual(formatBatchProgress(progress), {
    summary: '下载中 3 / 30 · 成功 2 · 失败 0',
    currentName: '示例研报.pdf'
  });
});

test('keeps the final result after a completed batch', () => {
  const progress = updateBatchProgress(
    createBatchProgress({ kind: 'audio', label: '音频批量下载', total: 30 }),
    { phase: 'completed', current: 30, success: 28, failed: 2 }
  );

  assert.deepEqual(formatBatchProgress(progress), {
    summary: '下载完成 30 / 30 · 成功 28 · 失败 2',
    currentName: ''
  });
});

test('caps invalid progress values and marks stopped batches clearly', () => {
  const progress = updateBatchProgress(
    createBatchProgress({ kind: 'file', total: 5 }),
    { phase: 'stopped', current: 99, success: -1, failed: 1 }
  );

  assert.equal(progress.current, 5);
  assert.equal(progress.success, 0);
  assert.deepEqual(formatBatchProgress(progress), {
    summary: '已停止 5 / 5 · 成功 0 · 失败 1',
    currentName: ''
  });
});

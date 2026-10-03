import assert from 'node:assert/strict';
import test from 'node:test';

import { SETTINGS, resolveRemoteHistoryEndpoint } from '../src/config/settings.js';
import {
  applyRemoteHistory,
  buildRemoteHistorySigningText,
  getMp3VideoWorkflowDisplay,
  hmacSha256Hex,
  isValidRemoteHistoryEndpoint,
  mergeRemoteHistoryRecords,
  normalizeRemoteFilename,
  sha256Hex
} from '../src/utils/remote-history.mjs';

test('accepts HTTPS endpoints and only the configured local history endpoint', () => {
  assert.equal(isValidRemoteHistoryEndpoint('https://xiaoshanqing.tech/api/v1/zsxq/browser-import/history'), true);
  assert.equal(isValidRemoteHistoryEndpoint('http://127.0.0.1:5001/api/v1/zsxq/browser-import/history'), true);
  assert.equal(isValidRemoteHistoryEndpoint('http://127.0.0.1:5002/api/v1/zsxq/browser-import/history'), false);
  assert.equal(isValidRemoteHistoryEndpoint('http://example.com/api/v1/zsxq/browser-import/history'), false);
});

test('maps MP3 video workflow states to user-facing labels', () => {
  assert.deepEqual(getMp3VideoWorkflowDisplay(null), { label: '暂无状态', state: 'unavailable' });
  assert.deepEqual(getMp3VideoWorkflowDisplay({ submitted: false }), { label: '未投递', state: 'not-submitted' });
  assert.deepEqual(getMp3VideoWorkflowDisplay({ submitted: true, completed: true, status: 'completed' }), { label: '已完成', state: 'completed' });
  assert.deepEqual(getMp3VideoWorkflowDisplay({ submitted: true, completed: false, status: 'processing' }), { label: '处理中', state: 'processing' });
  assert.deepEqual(getMp3VideoWorkflowDisplay({ submitted: true, completed: false, status: 'failed' }), { label: '投递失败', state: 'failed' });
  assert.deepEqual(getMp3VideoWorkflowDisplay({ submitted: true, completed: false, status: 'canceled' }), { label: '已取消', state: 'canceled' });
});

test('normalizes Chrome duplicate suffixes before matching filenames', () => {
  assert.equal(
    normalizeRemoteFilename('  研报 (1).MP3  '),
    '研报.mp3'
  );
});

test('missing or invalid workflow submission flags remain unknown', () => {
  for (const workflow of [{}, [], { submitted: null }, { submitted: 'false' }]) {
    assert.equal(getMp3VideoWorkflowDisplay(workflow).state, 'unavailable');
  }
});

test('missing remote download counts preserve the local count while zero is authoritative', () => {
  for (const count of [null, undefined, '', ' ', false, [], -1, 'invalid', 0, '0', '16']) {
    const result = applyRemoteHistory([{ name: 'audio.mp3', downloadCount: 25 }], [{
      filename: 'audio.mp3', latest_download_count: count, success: true
    }]);
    const expected = count === 0 || count === '0' ? 0 : count === '16' ? 16 : 25;
    assert.equal(result.items[0].downloadCount, expected, `count=${JSON.stringify(count)}`);
  }
});

test('builds the server signing text in the documented order', () => {
  assert.equal(
    buildRemoteHistorySigningText({
      appId: 'app-id',
      timestamp: '1724551200',
      method: 'POST',
      path: '/api/v1/zsxq/browser-import/history',
      bodySha256: 'body-sha'
    }),
    'app-id\n1724551200\nPOST\n/api/v1/zsxq/browser-import/history\nbody-sha'
  );
});

test('generates standard SHA-256 and HMAC-SHA256 hex signatures', async () => {
  assert.equal(
    await sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
  assert.equal(
    await hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog'),
    'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8'
  );
});

test('uses the persisted dedupe key first and falls back to normalized filename only for bootstrap', () => {
  const result = applyRemoteHistory([
    { name: '本地旧名称.mp3', status: 'pending', remoteDedupeKey: 'metadata:known' },
    { name: '研究报告 (1).mp3', status: 'pending', downloadCount: 2 },
    { name: '未完成.mp3', status: 'pending' }
  ], [
    {
      dedupe_key: 'metadata:known',
      filename: '服务端名称已变化.mp3',
      normalized_filename: '服务端名称已变化.mp3',
      latest_download_count: 16,
      success: true
    },
    {
      dedupe_key: 'metadata:bootstrap',
      filename: '研究报告.mp3',
      normalized_filename: '研究报告.mp3',
      latest_download_count: 12,
      mp3_video_workflow: {
        submitted: true,
        job_id: 'workflow-job-1',
        status: 'processing',
        step: 'landscape_video_waiting',
        submitted_at: '2026-09-23T08:19:27.791004',
        completed: false
      },
      success: true
    },
    {
      dedupe_key: 'metadata:failed',
      filename: '未完成.mp3',
      success: false
    }
  ]);

  assert.equal(result.matchedCount, 2);
  assert.deepEqual(result.historyNames, ['本地旧名称.mp3', '研究报告 (1).mp3']);
  assert.deepEqual(result.items[0], {
    name: '本地旧名称.mp3',
    status: 'done',
    remoteDedupeKey: 'metadata:known',
    remoteDownloadedAt: null,
    remoteSourceUrl: null,
    downloadCount: 16
  });
  assert.equal(result.items[1].status, 'done');
  assert.equal(result.items[1].remoteDedupeKey, 'metadata:bootstrap');
  assert.equal(result.items[1].downloadCount, 12);
  assert.deepEqual(result.items[1].mp3VideoWorkflow, {
    submitted: true,
    job_id: 'workflow-job-1',
    status: 'processing',
    step: 'landscape_video_waiting',
    submitted_at: '2026-09-23T08:19:27.791004',
    completed: false
  });
  assert.equal(result.items[2].status, 'pending');
});

test('uses a successful legacy record without a dedupe key as a filename fallback', () => {
  const result = applyRemoteHistory([
    { name: '旧版音频 (2).mp3', status: 'pending' }
  ], [
    {
      dedupe_key: null,
      filename: '旧版音频.mp3',
      normalized_filename: null,
      latest_download_count: null,
      success: true
    }
  ]);

  assert.equal(result.matchedCount, 1);
  assert.equal(result.items[0].status, 'done');
  assert.equal(result.items[0].remoteDedupeKey, null);
});

test('keeps previously trusted records when an incremental response has no files', () => {
  const existing = [{
    dedupe_key: 'metadata:previous',
    filename: '之前下载.pdf',
    success: true
  }];

  assert.deepEqual(mergeRemoteHistoryRecords(existing, []), existing);
});

test('migrates a previously saved default endpoint without changing custom endpoints', () => {
  const currentEndpoint = SETTINGS.REMOTE_HISTORY.ENDPOINT;
  const legacyEndpoint = 'https://ji448ziqobpp.ngrok.xiaomiqiu123.top/api/v1/zsxq/browser-import/history';
  const productionEndpoint = 'https://xiaoshanqing.tech/api/v1/zsxq/browser-import/history';

  assert.equal(resolveRemoteHistoryEndpoint(currentEndpoint), currentEndpoint);
  assert.equal(resolveRemoteHistoryEndpoint(`${legacyEndpoint}/`), currentEndpoint);
  assert.equal(resolveRemoteHistoryEndpoint(`${productionEndpoint}/`), currentEndpoint);
  assert.equal(
    resolveRemoteHistoryEndpoint('https://custom.example/history'),
    'https://custom.example/history'
  );
});

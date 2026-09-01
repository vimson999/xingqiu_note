import assert from 'node:assert/strict';
import test from 'node:test';

import { SETTINGS, resolveRemoteHistoryEndpoint } from '../src/config/settings.js';
import {
  applyRemoteHistory,
  buildRemoteHistorySigningText,
  hmacSha256Hex,
  mergeRemoteHistoryRecords,
  normalizeRemoteFilename,
  sha256Hex
} from '../src/utils/remote-history.mjs';

test('normalizes Chrome duplicate suffixes before matching filenames', () => {
  assert.equal(
    normalizeRemoteFilename('  研报 (1).MP3  '),
    '研报.mp3'
  );
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

  assert.equal(resolveRemoteHistoryEndpoint(currentEndpoint), currentEndpoint);
  assert.equal(resolveRemoteHistoryEndpoint(`${legacyEndpoint}/`), currentEndpoint);
  assert.equal(
    resolveRemoteHistoryEndpoint('https://custom.example/history'),
    'https://custom.example/history'
  );
});

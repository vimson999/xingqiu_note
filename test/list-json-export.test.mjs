import assert from 'node:assert/strict';
import test from 'node:test';

const exportModule = import('../src/utils/list-json-export.mjs').catch(() => ({}));

test('builds a PDF JSON export for LLM analysis without browser-local download metadata', async () => {
  const { buildListJsonExport } = await exportModule;

  assert.equal(typeof buildListJsonExport, 'function');
  const result = buildListJsonExport({
    kind: 'pdf',
    exportedAt: '2026-08-31T09:40:00.000Z',
    downloadedNames: ['热点研报.pdf'],
    items: [{
      name: '热点研报.pdf',
      uploadTime: '2026-08-30 09:29',
      downloadCount: '32',
      status: 'pending',
      fileId: 'file-1',
      topicId: 'topic-1',
      groupName: '前沿信息收录',
      fileSize: 852341,
      duration: 0,
      downloadId: 99,
      downloadFilename: '/Users/test/Downloads/热点研报.pdf',
      lastError: 'SHOULD_NOT_EXPORT'
    }, {
      name: '待重试研报.pdf',
      uploadTime: '2026-08-29 10:00',
      downloadCount: 15,
      status: 'failed'
    }]
  });

  assert.deepEqual(result, {
    schema: 'zsxq-list-export/v1',
    kind: 'pdf',
    exportedAt: '2026-08-31T09:40:00.000Z',
    summary: {
      total: 2,
      downloaded: 1,
      pending: 0,
      failed: 1,
      processing: 0,
      totalDownloadCount: 47
    },
    items: [{
      name: '热点研报.pdf',
      uploadTime: '2026-08-30 09:29',
      downloadCount: 32,
      status: 'done',
      fileId: 'file-1',
      topicId: 'topic-1',
      groupName: '前沿信息收录',
      fileSize: 852341,
      duration: 0
    }, {
      name: '待重试研报.pdf',
      uploadTime: '2026-08-29 10:00',
      downloadCount: 15,
      status: 'failed',
      fileId: null,
      topicId: null,
      groupName: null,
      fileSize: null,
      duration: null
    }]
  });
});

test('builds an audio JSON export with duration and current local status', async () => {
  const { buildListJsonExport } = await exportModule;

  assert.equal(typeof buildListJsonExport, 'function');
  const result = buildListJsonExport({
    kind: 'audio',
    exportedAt: '2026-08-31T09:41:00.000Z',
    downloadedNames: [],
    items: [{
      name: '晨间音频.mp3',
      uploadTime: '2026-08-31 08:00',
      downloadCount: 28,
      status: 'processing',
      fileId: 'audio-1',
      topicId: 'topic-audio-1',
      groupName: '前沿信息收录',
      fileSize: 31457280,
      duration: 1254
    }]
  });

  assert.deepEqual(result.summary, {
    total: 1,
    downloaded: 0,
    pending: 0,
    failed: 0,
    processing: 1,
    totalDownloadCount: 28
  });
  assert.deepEqual(result.items[0], {
    name: '晨间音频.mp3',
    uploadTime: '2026-08-31 08:00',
    downloadCount: 28,
    status: 'processing',
    fileId: 'audio-1',
    topicId: 'topic-audio-1',
    groupName: '前沿信息收录',
    fileSize: 31457280,
    duration: 1254
  });
});

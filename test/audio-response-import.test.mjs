import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeImportedAudioItems,
  parseAudioSearchResponse
} from '../src/utils/audio-response-import.mjs';

test('parses a copied audio search response into importable list items', () => {
  const parsed = parseAudioSearchResponse(JSON.stringify({
    succeeded: true,
    resp_data: {
      index: 120,
      files: [{
        file: {
          file_id: 584112455255554,
          name: '行业晨报260828.mp3',
          hash: 'file-hash',
          size: 24760781,
          duration: 1547,
          download_count: 21,
          create_time: '2026-08-28T09:29:57.539+0800'
        },
        topic_id: 55521151481511814,
        topic_uid: '55521151481511814',
        group: { group_id: 28888112822211, name: '前沿信息收录' }
      }]
    }
  }));

  assert.equal(parsed.nextIndex, 120);
  assert.equal(parsed.sourceCount, 1);
  assert.equal(parsed.skippedCount, 0);
  assert.deepEqual(parsed.items, [{
    fileId: '584112455255554',
    name: '行业晨报260828.mp3',
    uploadTime: '2026-08-28 09:29',
    downloadCount: 21,
    fileHash: 'file-hash',
    fileSize: 24760781,
    duration: 1547,
    topicId: '55521151481511814',
    topicUid: '55521151481511814',
    groupId: '28888112822211',
    groupName: '前沿信息收录',
    source: 'api-import'
  }]);
});

test('rejects responses that are not a successful audio search payload', () => {
  assert.throws(
    () => parseAudioSearchResponse('{"succeeded":false,"resp_data":{"files":[]}}'),
    { message: 'AUDIO_IMPORT_RESPONSE_NOT_SUCCEEDED' }
  );
  assert.throws(
    () => parseAudioSearchResponse('{"succeeded":true,"resp_data":{}}'),
    { message: 'AUDIO_IMPORT_FILES_MISSING' }
  );
});

test('merges repeated imports without overwriting local download states', () => {
  const existing = [
    {
      fileId: 'existing-id',
      name: '旧标题.mp3',
      uploadTime: '2026-08-20 10:00',
      downloadCount: 1,
      status: 'done',
      downloadId: 42
    },
    {
      name: '历史条目.mp3',
      uploadTime: '2026-08-20 11:00',
      downloadCount: 2,
      status: 'failed',
      lastError: 'OLD_ERROR'
    }
  ];
  const imported = [
    {
      fileId: 'existing-id',
      name: '新标题.mp3',
      uploadTime: '2026-08-28 09:29',
      downloadCount: 31,
      source: 'api-import'
    },
    {
      fileId: 'legacy-match-id',
      name: '历史条目.mp3',
      uploadTime: '2026-08-28 09:28',
      downloadCount: 20,
      source: 'api-import'
    },
    {
      fileId: 'new-id',
      name: '新发现.mp3',
      uploadTime: '2026-08-28 09:27',
      downloadCount: 10,
      source: 'api-import'
    },
    {
      fileId: 'new-id',
      name: '新发现.mp3',
      uploadTime: '2026-08-28 09:27',
      downloadCount: 12,
      source: 'api-import'
    }
  ];

  const result = mergeImportedAudioItems(existing, imported, ['已下载历史.mp3']);

  assert.equal(result.addedCount, 1);
  assert.equal(result.updatedCount, 3);
  assert.equal(result.items.length, 3);
  assert.deepEqual(result.items[0], {
    fileId: 'existing-id',
    name: '新标题.mp3',
    uploadTime: '2026-08-28 09:29',
    downloadCount: 31,
    status: 'done',
    downloadId: 42,
    source: 'api-import'
  });
  assert.equal(result.items[1].fileId, 'legacy-match-id');
  assert.equal(result.items[1].status, 'failed');
  assert.equal(result.items[1].lastError, 'OLD_ERROR');
  assert.equal(result.items[1].downloadCount, 20);
  assert.equal(result.items[2].downloadCount, 12);
  assert.equal(result.items[2].status, 'pending');
});

test('marks a newly imported record as downloaded when local history already has it', () => {
  const result = mergeImportedAudioItems([], [{
    fileId: 'history-id',
    name: '已下载历史.mp3',
    uploadTime: '2026-08-28 09:27',
    downloadCount: 8,
    source: 'api-import'
  }], ['已下载历史.mp3']);

  assert.equal(result.items[0].status, 'done');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeImportedFileItems,
  parseFileSearchResponse
} from '../src/utils/file-response-import.mjs';

test('flattens copied topic results into PDF list items with exact topic IDs', () => {
  const parsed = parseFileSearchResponse(JSON.stringify({
    succeeded: true,
    resp_data: {
      topics: [{
        topic_id: 55521155128525514,
        topic_uid: '55521155128525514',
        group: { group_id: 28888112822211, name: '前沿信息收录' },
        create_time: '2026-08-29T11:27:14.535+0800',
        talk: {
          files: [{
            file_id: 181552824548112,
            name: '高盛-Autodesk Inc.：核心业务执行稳健-260828.pdf',
            hash: 'pdf-hash',
            size: 851719,
            duration: 0,
            download_count: 26,
            create_time: '2026-08-29T11:27:13.786+0800'
          }, {
            file_id: 181552824548822,
            name: '高盛-Dollar General：业绩超预期-260828.pdf',
            hash: 'pdf-hash-2',
            size: 857142,
            duration: 0,
            download_count: 23,
            create_time: '2026-08-29T11:27:13.892+0800'
          }]
        }
      }]
    }
  }));

  assert.equal(parsed.sourceTopicCount, 1);
  assert.equal(parsed.sourceFileCount, 2);
  assert.equal(parsed.skippedCount, 0);
  assert.deepEqual(parsed.items, [{
    fileId: '181552824548112',
    name: '高盛-Autodesk Inc.：核心业务执行稳健-260828.pdf',
    uploadTime: '2026-08-29 11:27',
    downloadCount: 26,
    fileHash: 'pdf-hash',
    fileSize: 851719,
    duration: 0,
    topicId: '55521155128525514',
    topicUid: '55521155128525514',
    groupId: '28888112822211',
    groupName: '前沿信息收录',
    source: 'api-import'
  }, {
    fileId: '181552824548822',
    name: '高盛-Dollar General：业绩超预期-260828.pdf',
    uploadTime: '2026-08-29 11:27',
    downloadCount: 23,
    fileHash: 'pdf-hash-2',
    fileSize: 857142,
    duration: 0,
    topicId: '55521155128525514',
    topicUid: '55521155128525514',
    groupId: '28888112822211',
    groupName: '前沿信息收录',
    source: 'api-import'
  }]);
});

test('rejects a response that does not contain successful topic results', () => {
  assert.throws(
    () => parseFileSearchResponse('{"succeeded":false,"resp_data":{"topics":[]}}'),
    { message: 'FILE_IMPORT_RESPONSE_NOT_SUCCEEDED' }
  );
  assert.throws(
    () => parseFileSearchResponse('{"succeeded":true,"resp_data":{}}'),
    { message: 'FILE_IMPORT_TOPICS_MISSING' }
  );
});

test('merges repeated PDF imports while preserving local statuses', () => {
  const existing = [
    {
      fileId: 'downloaded-id',
      name: '旧文件名.pdf',
      uploadTime: '2026-08-20 10:00',
      downloadCount: 1,
      status: 'done',
      downloadId: 77
    },
    {
      name: '旧扫描文件.pdf',
      uploadTime: '2026-08-20 11:00',
      downloadCount: 2,
      status: 'failed',
      lastError: 'OLD_ERROR'
    }
  ];
  const imported = [
    {
      fileId: 'downloaded-id',
      name: '新文件名.pdf',
      uploadTime: '2026-08-29 11:27',
      downloadCount: 30,
      source: 'api-import'
    },
    {
      fileId: 'legacy-id',
      name: '旧扫描文件.pdf',
      uploadTime: '2026-08-29 11:26',
      downloadCount: 25,
      source: 'api-import'
    },
    {
      fileId: 'new-id',
      name: '新发现.pdf',
      uploadTime: '2026-08-29 11:25',
      downloadCount: 10,
      source: 'api-import'
    },
    {
      fileId: 'new-id',
      name: '新发现.pdf',
      uploadTime: '2026-08-29 11:25',
      downloadCount: 12,
      source: 'api-import'
    }
  ];

  const result = mergeImportedFileItems(existing, imported, ['已下载历史.pdf']);

  assert.equal(result.addedCount, 1);
  assert.equal(result.updatedCount, 3);
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].name, '新文件名.pdf');
  assert.equal(result.items[0].status, 'done');
  assert.equal(result.items[0].downloadId, 77);
  assert.equal(result.items[1].fileId, 'legacy-id');
  assert.equal(result.items[1].status, 'failed');
  assert.equal(result.items[1].lastError, 'OLD_ERROR');
  assert.equal(result.items[2].downloadCount, 12);
  assert.equal(result.items[2].status, 'pending');
});

test('marks a new imported PDF as downloaded when its name is in local history', () => {
  const result = mergeImportedFileItems([], [{
    fileId: 'history-id',
    name: '已下载历史.pdf',
    uploadTime: '2026-08-29 11:25',
    downloadCount: 8,
    source: 'api-import'
  }], ['已下载历史.pdf']);

  assert.equal(result.items[0].status, 'done');
});

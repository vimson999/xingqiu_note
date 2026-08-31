import assert from 'node:assert/strict';
import test from 'node:test';

function createChromeEvent() {
  const listeners = new Set();
  return {
    listeners,
    addListener(listener) {
      listeners.add(listener);
    },
    removeListener(listener) {
      listeners.delete(listener);
    }
  };
}

function pickStorageValues(storage, keys) {
  if (typeof keys === 'string') return { [keys]: storage[keys] };
  if (Array.isArray(keys)) {
    return Object.fromEntries(keys.map(key => [key, storage[key]]));
  }
  return Object.fromEntries(Object.entries(keys || {}).map(([key, fallback]) => [
    key,
    storage[key] === undefined ? fallback : storage[key]
  ]));
}

function sendMessage(listener, message) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (response) => {
      if (settled) return;
      settled = true;
      resolve(response);
    };
    const keepsChannelOpen = listener(message, {}, finish);
    if (!keepsChannelOpen) finish({ success: false, error: 'NO_RESPONSE' });
  });
}

test('automatically merges a captured PDF response without replacing local download state', async () => {
  const storage = {
    pendingFiles: [{
      fileId: 'existing-file-id',
      name: '旧标题.pdf',
      uploadTime: '2026-08-29 09:00',
      downloadCount: 1,
      status: 'done',
      downloadId: 88
    }],
    downloadedHistory: ['旧标题.pdf'],
    logs: []
  };
  const onMessage = createChromeEvent();
  const onAlarm = createChromeEvent();
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: { lastError: undefined, onMessage },
    alarms: { onAlarm },
    storage: {
      local: {
        async get(keys) {
          return pickStorageValues(storage, keys);
        },
        async set(values) {
          Object.assign(storage, values);
        }
      }
    }
  };

  try {
    await import(`../src/background/main.js?file-auto-import-test=${Date.now()}`);
    const listener = [...onMessage.listeners][0];
    assert.ok(listener, 'background message listener should be registered');

    const response = await sendMessage(listener, {
      type: 'AUTO_IMPORT_FILE_RESPONSE',
      payload: {
        sourceUrl: 'https://api.zsxq.com/v2/hashtags/51184248544214/topics?count=20',
        rawResponse: JSON.stringify({
          succeeded: true,
          resp_data: {
            topics: [{
              topic_uid: '55521151481511814',
              group: { group_id: '28888112822211', name: '前沿信息收录' },
              create_time: '2026-08-30T09:30:00.000+0800',
              talk: {
                files: [{
                  file_id: 'existing-file-id',
                  name: '新标题.pdf',
                  download_count: 31,
                  create_time: '2026-08-30T09:29:57.539+0800'
                }, {
                  file_id: 'new-file-id',
                  name: '新发现.pdf',
                  download_count: 18,
                  create_time: '2026-08-30T09:28:57.539+0800'
                }]
              }
            }]
          }
        })
      }
    });

    assert.equal(response.success, true);
    assert.equal(response.addedCount, 1);
    assert.equal(response.updatedCount, 1);
    assert.equal(storage.pendingFiles.length, 2);
    assert.deepEqual(storage.pendingFiles[0], {
      fileId: 'existing-file-id',
      name: '新标题.pdf',
      uploadTime: '2026-08-30 09:29',
      downloadCount: 31,
      fileHash: null,
      fileSize: 0,
      duration: 0,
      topicId: '55521151481511814',
      topicUid: '55521151481511814',
      groupId: '28888112822211',
      groupName: '前沿信息收录',
      source: 'api-import',
      status: 'done',
      downloadId: 88
    });
    assert.equal(storage.pendingFiles[1].name, '新发现.pdf');
    assert.equal(storage.pendingFiles[1].status, 'pending');
  } finally {
    globalThis.chrome = originalChrome;
  }
});

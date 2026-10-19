import assert from 'node:assert/strict';
import test from 'node:test';

let instance = 0;
function event() {
  const listeners = new Set();
  return {
    listeners,
    addListener: listener => listeners.add(listener),
    removeListener: listener => listeners.delete(listener),
    emit: (...args) => [...listeners].forEach(listener => listener(...args))
  };
}

async function background(t, initial = {}, activeUrl = 'https://wx.zsxq.com/group/28888112822211') {
  const storage = structuredClone(initial);
  const messages = [];
  const writes = [];
  const onMessage = event();
  const onCreated = event();
  const timers = new Set();
  const original = { chrome: globalThis.chrome, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout };
  let queryCount = 0;
  globalThis.setTimeout = (callback, delay, ...args) => {
    const timer = original.setTimeout(callback, Math.min(delay, 5), ...args);
    timers.add(timer);
    return timer;
  };
  globalThis.chrome = {
    runtime: { onMessage },
    alarms: { onAlarm: event(), async clear() {}, create() {} },
    storage: { local: {
      async get(keys) {
        return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, storage[key]])));
      },
      async set(values) {
        writes.push(structuredClone(values));
        Object.assign(storage, structuredClone(values));
      }
    } },
    tabs: {
      async query() {
        queryCount++;
        return [{ id: queryCount === 1 ? 7 : 99, url: activeUrl }];
      },
      sendMessage(tabId, message, callback) {
        messages.push({ tabId, ...message });
        if (['TRIGGER_CLICK', 'TRIGGER_AUDIO_CLICK'].includes(message.type)) {
          onCreated.emit({ id: messages.length, filename: `/downloads/${message.payload.fileName}`, startTime: new Date().toISOString() });
        }
        callback?.({ success: true });
      }
    },
    downloads: { onCreated, search(_query, callback) { callback([]); } }
  };
  t.after(() => {
    for (const timer of timers) clearTimeout(timer);
    Object.assign(globalThis, original);
  });
  await import(`../src/background/main.js?reliability=${++instance}`);
  const listener = [...onMessage.listeners][0];
  return {
    storage, writes, messages,
    send(type, payload) {
      return new Promise((resolve, reject) => {
        const timer = original.setTimeout(() => reject(new Error(`${type} did not respond`)), 2000);
        listener({ type, payload }, {}, response => { clearTimeout(timer); resolve(response); });
      });
    },
    async runAudio(payload) {
      await new Promise((resolve, reject) => {
        const timer = original.setTimeout(() => reject(new Error('Audio batch did not finish')), 2000);
        listener({ type: 'START_BATCH_AUDIO_DOWNLOAD', payload }, {}, result => {
          clearTimeout(timer);
          if (!result?.success) reject(new Error(result?.error));
          else resolve();
        });
      });
    }
  };
}

test('background honors empty PDF and audio candidate lists without clicking', async t => {
  const app = await background(t, {
    pendingFiles: [{ name: 'report.pdf', status: 'pending', downloadCount: 50 }],
    pendingAudio: [{ name: 'audio.mp3', status: 'pending', downloadCount: 50, uploadTime: '2026-10-01 10:00' }]
  });
  await app.send('START_BATCH_DOWNLOAD', { filterNames: [], limit: 0 });
  await app.runAudio({ filterNames: [], limit: 0 });
  assert.deepEqual(app.messages, []);
  assert.equal(app.storage.batchDownloadProgress.total, 0);
  assert.equal(app.storage.pendingAudio[0].status, 'pending');
  assert.equal(app.storage.pendingFiles[0].status, 'pending');
});

test('PDF message sort determines the fixed queue before limiting', async t => {
  const app = await background(t, { pendingFiles: [
    { name: 'first.pdf', status: 'pending', downloadCount: 10 },
    { name: 'popular.pdf', status: 'pending', downloadCount: 50 },
    { name: 'other.pdf', status: 'pending', downloadCount: 20 }
  ] });
  await app.send('START_BATCH_DOWNLOAD', { limit: 2, sort: 'count_desc' });
  assert.deepEqual(app.storage.fileBatchState.taskNames, ['popular.pdf', 'other.pdf']);
  assert.equal(app.messages.find(message => message.type === 'TRIGGER_CLICK').payload.fileName, 'popular.pdf');
});

test('same-name files in another group are excluded from the queue and status updates', async t => {
  const groupId = '88885882121542';
  const app = await background(t, {
    downloadedHistory: ['shared.pdf'],
    pendingFiles: [
      { name: 'shared.pdf', status: 'done' },
      { name: 'shared.pdf', groupId, status: 'pending', downloadCount: 50 }
    ]
  }, `https://wx.zsxq.com/group/${groupId}`);
  await app.send('START_BATCH_DOWNLOAD', { limit: 1 });
  assert.equal(app.storage.pendingFiles[0].status, 'done');
  assert.equal(app.storage.pendingFiles[0].downloadId, undefined);
  assert.equal(app.storage.pendingFiles[1].status, 'done');
  assert.ok(app.storage.downloadedHistory.includes(`group:${groupId}:shared.pdf`));
  assert.equal(app.storage.batchDownloadProgress.success, 1);
});

test('audio batch includes unknown dates without date bounds and keeps the original tab', async t => {
  const app = await background(t, { pendingAudio: [
    { name: 'first.mp3', status: 'pending', downloadCount: 20 },
    { name: 'second.mp3', status: 'pending', downloadCount: 10 }
  ] });
  await app.runAudio({ limit: 2, sort: 'count_desc' });
  const clicks = app.messages.filter(message => message.type === 'TRIGGER_AUDIO_CLICK');
  assert.deepEqual(clicks.map(message => message.tabId), [7, 7]);
  assert.deepEqual(app.storage.downloadedAudioHistory, ['first.mp3', 'second.mp3']);
  assert.equal(app.storage.batchDownloadProgress.success, 2);
});

test('failed or incomplete history responses never overwrite lists or trusted history', async t => {
  const initial = {
    remoteHistoryConfig: {
      endpoint: 'https://history.example/api/v1/zsxq/browser-import/history',
      appId: 'test-app-id', appSecret: 'test-secret', groupId: 'group', pdfTabId: 'pdf', mp3TabId: 'mp3', days: 3
    },
    pendingFiles: [{ name: 'local.pdf', status: 'done', downloadCount: 35 }],
    downloadedHistory: ['local.pdf'],
    remotePdfDownloadHistory: [{ filename: 'local.pdf', success: true }]
  };
  const app = await background(t, initial);
  for (const body of [
    { status: 500, json: { message: 'database unavailable' } },
    { status: 200, json: { success: true, data: { kind: 'pdf', complete: false, files: [] } } },
    { status: 200, json: { success: true, data: { kind: 'mp3', complete: true, files: [] } } }
  ]) {
    globalThis.fetch = async () => Response.json(body.json, { status: body.status });
    const response = await app.send('SYNC_REMOTE_HISTORY', { kind: 'pdf' });
    assert.equal(response.success, false);
    if (body.status === 500) {
      assert.equal(response.error, 'REMOTE_HISTORY_HTTP_500');
      assert.match(response.message, /database unavailable/);
    }
    for (const key of ['pendingFiles', 'downloadedHistory', 'remotePdfDownloadHistory']) {
      assert.deepEqual(app.storage[key], initial[key]);
    }
    assert.equal(app.storage.lastRemotePdfHistorySync, undefined);
  }
  assert.ok(app.storage.logs.some(log => log.message.includes('database unavailable')));
});

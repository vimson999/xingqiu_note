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
    },
    emit(...args) {
      for (const listener of [...listeners]) listener(...args);
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

test('marks audio done when Chrome creates a temporary-named download like the PDF flow', async () => {
  const expectedName = '人口通缩遇上AI通胀260827.mp3';
  const storage = {
    pendingAudio: [{ name: expectedName, status: 'pending', downloadCount: 10 }],
    downloadedAudioHistory: [],
    logs: []
  };
  const onMessage = createChromeEvent();
  const onAlarm = createChromeEvent();
  const onDownloadCreated = createChromeEvent();
  const originalSetTimeout = globalThis.setTimeout;
  const originalChrome = globalThis.chrome;

  globalThis.setTimeout = (callback, delay, ...args) => (
    originalSetTimeout(callback, Math.min(Number(delay) || 0, 10), ...args)
  );
  globalThis.chrome = {
    runtime: {
      lastError: undefined,
      onMessage
    },
    alarms: {
      onAlarm,
      async clear() {},
      create() {}
    },
    storage: {
      local: {
        async get(keys) {
          return pickStorageValues(storage, keys);
        },
        async set(values) {
          Object.assign(storage, values);
        }
      }
    },
    tabs: {
      async query() {
        return [{ id: 7, url: 'https://wx.zsxq.com/search/mp3' }];
      },
      sendMessage(_tabId, message, callback) {
        if (message.type === 'TRIGGER_AUDIO_CLICK') {
          onDownloadCreated.emit({
            id: 5227,
            url: 'https://files.zsxq.com/audio/5227',
            finalUrl: 'https://files.zsxq.com/audio/5227',
            filename: '/Users/test/Downloads/未确认 5227.crdownload',
            incognito: false,
            danger: 'safe',
            mime: 'audio/mpeg',
            startTime: new Date().toISOString(),
            state: 'in_progress',
            paused: false,
            canResume: false,
            bytesReceived: 0,
            totalBytes: 31_900_000,
            fileSize: 31_900_000,
            exists: true
          });
          callback({ success: true });
          return;
        }
        callback({ success: true });
      }
    },
    downloads: {
      onCreated: onDownloadCreated,
      search(_query, callback) {
        callback([]);
      }
    }
  };

  try {
    await import(`../src/background/main.js?audio-status-test=${Date.now()}`);
    const listener = [...onMessage.listeners][0];
    const response = await new Promise((resolve, reject) => {
      if (!listener) {
        reject(new Error('Background message listener was not registered'));
        return;
      }
      const timeout = originalSetTimeout(() => reject(new Error('Audio task did not finish')), 500);
      listener(
        { type: 'START_SINGLE_AUDIO_DOWNLOAD', payload: { fileName: expectedName } },
        {},
        value => {
          clearTimeout(timeout);
          resolve(value);
        }
      );
    });

    assert.deepEqual(response, { success: true });
    assert.equal(storage.pendingAudio[0].status, 'done');
    assert.equal(storage.pendingAudio[0].downloadId, 5227);
    assert.deepEqual(storage.downloadedAudioHistory, [expectedName]);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.chrome = originalChrome;
  }
});

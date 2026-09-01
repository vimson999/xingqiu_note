import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const BRIDGE_SOURCE_URL = new URL('../src/content/audio-network-capture-bridge.js', import.meta.url);

async function loadBridge(sendMessage) {
  let messageListener = null;
  const fakeWindow = {
    location: {
      origin: 'https://wx.zsxq.com'
    },
    addEventListener(type, listener) {
      if (type === 'message') messageListener = listener;
    }
  };
  const source = await readFile(BRIDGE_SOURCE_URL, 'utf8');

  vm.runInNewContext(source, {
    URL,
    window: fakeWindow,
    chrome: {
      runtime: {
        sendMessage,
        lastError: undefined
      }
    }
  });

  return { fakeWindow, messageListener };
}

test('ignores captured responses when an old bridge context is invalidated after reload', async () => {
  let sendAttempts = 0;
  const { fakeWindow, messageListener } = await loadBridge(() => {
    sendAttempts += 1;
    throw new Error('Extension context invalidated');
  });

  assert.equal(typeof messageListener, 'function');
  assert.doesNotThrow(() => {
    messageListener({
      source: fakeWindow,
      origin: fakeWindow.location.origin,
      data: {
        source: 'ZSXQ_ASSISTANT_SEARCH_CAPTURE',
        type: 'SEARCH_RESPONSE',
        captureKind: 'audio',
        sourceUrl: 'https://api.zsxq.com/v2/search/files?keyword=mp3&count=20',
        rawResponse: '{"succeeded":true,"resp_data":{"files":[]}}'
      }
    });
  });
  assert.equal(sendAttempts, 1);
});
